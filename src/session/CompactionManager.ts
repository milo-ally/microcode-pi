import {
  generateSummary,
  shouldCompact,
  DEFAULT_COMPACTION_SETTINGS,
  type CompactionSettings,
  type AgentMessage,
  type Model,
} from '@earendil-works/pi-agent-core'
import { estimateMessagesTokens } from './TokenEstimator.ts'
import { getCompactUserSummaryMessage } from './compactPrompt.ts'
import { TOOL_NAME as BASH_TOOL_NAME } from '../tools/BashTool/BashTool.ts'
import { TOOL_NAME as READ_TOOL_NAME } from '../tools/FileReadTool/FileReadTool.ts'
import { TOOL_NAME as WRITE_TOOL_NAME } from '../tools/FileWriteTool/FileWriteTool.ts'
import { TOOL_NAME as EDIT_TOOL_NAME } from '../tools/FileEditTool/FileEditTool.ts'
import { TOOL_NAME as VISION_TOOL_NAME } from '../tools/VisionTool/VisionTool.ts'

export interface CompactionProgress {
  phase: 'microcompact' | 'compacting' | 'done'
  message: string
  tokensBefore?: number
  tokensAfter?: number
}

const CLEARED_MESSAGE = '[Old tool result content cleared]'

// Tool names whose results are eligible for microcompact (must match registered names in tools/*/index.ts)
const COMPACTABLE_TOOL_NAMES = new Set([
  BASH_TOOL_NAME,
  READ_TOOL_NAME,
  WRITE_TOOL_NAME,
  EDIT_TOOL_NAME,
  VISION_TOOL_NAME,
])

// Keep the last N tool results of each type
const KEEP_RECENT_TOOLS = 3

/**
 * Manages context compression in three layers:
 * 1. Microcompact: Clear old tool results (cheap, no LLM call)
 * 2. Auto-compact: LLM-powered summary when context window fills
 * 3. Manual /compact: User-triggered compaction
 */
export class CompactionManager {
  private model: Model<any>
  private apiKey: string
  private settings: CompactionSettings
  private onProgress?: (progress: CompactionProgress) => void
  private compacting = false
  private systemPromptTokens = 0

  constructor(options: {
    model: Model<any>
    apiKey: string
    settings?: Partial<CompactionSettings>
    onProgress?: (progress: CompactionProgress) => void
  }) {
    this.model = options.model
    this.apiKey = options.apiKey
    this.settings = { ...DEFAULT_COMPACTION_SETTINGS, ...options.settings }
    this.onProgress = options.onProgress
  }

  /**
   * Update system prompt token estimate (called when prompt changes).
   */
  setSystemPrompt(prompt: string): void {
    this.systemPromptTokens = Math.ceil(prompt.length / 4)
  }

  /**
   * Check if compaction is needed based on current token usage.
   * Returns false if context was already compacted (first message is a summary).
   */
  isCompactionNeeded(messages: AgentMessage[]): boolean {
    if (this.isAlreadyCompacted(messages)) return false
    const messageTokens = estimateMessagesTokens(messages)
    const tokens = messageTokens + this.systemPromptTokens
    return shouldCompact(tokens, this.model.contextWindow, this.settings)
  }

  /**
   * Detect if the context was already compacted (starts with a summary message).
   */
  private isAlreadyCompacted(messages: AgentMessage[]): boolean {
    if (messages.length === 0) return false
    const first = messages[0]
    if (first.role !== 'user') return false
    const text = typeof first.content === 'string'
      ? first.content
      : Array.isArray(first.content)
        ? first.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('')
        : ''
    return text.includes('The conversation history before this point was compacted into the following summary')
  }

  /**
   * Get context usage stats for display.
   * Uses local character-based estimation for reliability (not dependent on API usage data).
   */
  getContextUsage(messages: AgentMessage[]): {
    tokens: number
    contextWindow: number
    percentUsed: number
    percentRemaining: number
  } {
    const messageTokens = estimateMessagesTokens(messages)
    const tokens = messageTokens + this.systemPromptTokens
    const contextWindow = this.model.contextWindow
    const percentUsed = Math.round((tokens / contextWindow) * 100)
    return {
      tokens,
      contextWindow,
      percentUsed,
      percentRemaining: Math.max(0, 100 - percentUsed),
    }
  }

  /**
   * Layer 1: Microcompact — clear old tool results in-place.
   * No LLM call, cheap and fast.
   */
  microcompact(messages: AgentMessage[]): {
    messages: AgentMessage[]
    cleared: number
  } {
    // Collect tool result message indices grouped by tool name
    const toolResultIndices = new Map<string, number[]>()
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]
      if (msg.role === 'toolResult') {
        const toolName = msg.toolName ?? 'unknown'
        if (COMPACTABLE_TOOL_NAMES.has(toolName)) {
          const indices = toolResultIndices.get(toolName) ?? []
          indices.push(i)
          toolResultIndices.set(toolName, indices)
        }
      }
    }

    // Determine which indices to clear (keep last N per tool type)
    const clearIndices = new Set<number>()
    for (const [, indices] of toolResultIndices) {
      const toClear = indices.slice(0, Math.max(0, indices.length - KEEP_RECENT_TOOLS))
      for (const idx of toClear) {
        clearIndices.add(idx)
      }
    }

    if (clearIndices.size === 0) {
      return { messages, cleared: 0 }
    }

    // Create new messages array with cleared tool results
    const newMessages = messages.map((msg, i) => {
      if (!clearIndices.has(i)) return msg
      if (msg.role !== 'toolResult') return msg

      // Replace content with cleared marker
      return {
        ...msg,
        content: [{ type: 'text' as const, text: CLEARED_MESSAGE }],
      }
    })

    return { messages: newMessages, cleared: clearIndices.size }
  }

  /**
   * Layer 2: Auto-compact — generate LLM summary when context is full.
   * Returns the new message array with old messages replaced by summary.
   */
  async autoCompact(messages: AgentMessage[]): Promise<AgentMessage[]> {
    if (this.compacting) return messages
    if (!this.isCompactionNeeded(messages)) return messages

    return this.runCompaction(messages, undefined, true)
  }

  /**
   * Layer 3: Manual /compact — user-triggered compaction.
   */
  async manualCompact(
    messages: AgentMessage[],
    customInstructions?: string,
  ): Promise<AgentMessage[]> {
    if (this.compacting) {
      throw new Error('Compaction already in progress')
    }

    return this.runCompaction(messages, customInstructions, false)
  }

  /**
   * Core compaction logic shared by auto and manual paths.
   * Uses generateSummary() directly since we work with flat message arrays,
   * not session entries. The compact() function requires a CompactionPreparation
   * from session entries.
   */
  private async runCompaction(
    messages: AgentMessage[],
    customInstructions: string | undefined,
    isAuto: boolean,
  ): Promise<AgentMessage[]> {
    this.compacting = true
    const tokensBefore = estimateMessagesTokens(messages)

    try {
      this.onProgress?.({
        phase: 'compacting',
        message: isAuto ? 'Auto-compacting context...' : 'Compacting conversation...',
        tokensBefore,
      })

      const result = await generateSummary(
        messages,
        this.model,
        this.settings.reserveTokens,
        this.apiKey,
        undefined, // headers
        undefined, // signal
        customInstructions,
      )

      if (!result.ok) {
        throw new Error(`Summarization failed: ${result.error.message}`)
      }

      const summary = result.value
      if (!summary || summary.trim().length === 0) {
        throw new Error('Summarization returned empty summary')
      }

      // Build the summary message
      const summaryUserMessage: AgentMessage = {
        role: 'user',
        content: getCompactUserSummaryMessage(summary),
        timestamp: Date.now(),
      }

      // Keep the last few messages after the summary.
      // Use a small minimum to avoid keeping everything in short conversations.
      const keepCount = Math.min(messages.length, Math.max(2, Math.floor(messages.length * 0.2)))
      const recentMessages = messages.slice(-keepCount)

      const newMessages = [summaryUserMessage, ...recentMessages]
      const tokensAfter = estimateMessagesTokens(newMessages)

      this.onProgress?.({
        phase: 'done',
        message: `Compacted: ${tokensBefore} → ${tokensAfter} tokens`,
        tokensBefore,
        tokensAfter,
      })

      return newMessages
    } catch (error) {
      this.onProgress?.({
        phase: 'done',
        message: `Compaction failed: ${error instanceof Error ? error.message : String(error)}`,
      })
      throw error
    } finally {
      this.compacting = false
    }
  }

  /**
   * Check if currently compacting.
   */
  isCompacting(): boolean {
    return this.compacting
  }

  /**
   * Update model (e.g., after /model switch).
   */
  setModel(model: Model<any>): void {
    this.model = model
  }

  /**
   * Update API key.
   */
  setApiKey(apiKey: string): void {
    this.apiKey = apiKey
  }
}
