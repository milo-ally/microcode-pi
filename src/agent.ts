import { Agent, type AgentMessage } from '@earendil-works/pi-agent-core'
import { type Message, streamSimple } from '@earendil-works/pi-ai'
import { resolveConfig, getApiKeyForProvider } from './config.ts'
import { createCodingTools } from './tools/index.ts'
import { getSystemPrompt } from './constants/prompts.ts'
import type { McpServerState } from './mcp/types.ts'
import { CompactionManager, type CompactionProgress } from './session/CompactionManager.ts'

export interface CreateMicrocodeAgentOptions {
  cwd?: string
  mcpServers?: McpServerState[]
  onCompactionProgress?: (progress: CompactionProgress) => void
}

export function createMicrocodeAgent(options: CreateMicrocodeAgentOptions = {}) {
  const cwd = options.cwd ?? process.cwd()
  const config = resolveConfig()

  const systemPromptSections = getSystemPrompt({
    cwd,
    modelId: config.model.id,
    mcpServers: options.mcpServers,
  })

  const compactionManager = new CompactionManager({
    model: config.model,
    apiKey: config.apiKey,
    onProgress: options.onCompactionProgress,
  })

  const agent = new Agent({
    initialState: {
      systemPrompt: systemPromptSections.join('\n\n'),
      model: config.model,
      tools: createCodingTools(cwd),
    },
    streamFn: async (model, context, opts) => {
      const apiKey = getApiKeyForProvider(model.provider) ?? config.apiKey
      return streamSimple(model, context, {
        ...opts,
        apiKey,
      })
    },
    convertToLlm,
    transformContext: async (messages, signal) => {
      // Layer 1: Microcompact old tool results
      const { messages: microcompacted } = compactionManager.microcompact(messages)

      // Layer 2: Auto-compact if context window is full
      if (compactionManager.isCompactionNeeded(microcompacted)) {
        try {
          return await compactionManager.autoCompact(microcompacted)
        } catch {
          // If auto-compact fails, continue with microcompacted messages
          return microcompacted
        }
      }

      return microcompacted
    },
  })

  // Attach compactionManager to agent for external access
  ;(agent as any).__compactionManager = compactionManager

  return agent
}

/**
 * Get the CompactionManager attached to an agent.
 */
export function getCompactionManager(agent: Agent): CompactionManager | undefined {
  return (agent as any).__compactionManager
}

export function convertToLlm(messages: AgentMessage[]): Message[] {
  return messages.flatMap((msg) => {
    switch (msg.role) {
      case 'user':
      case 'assistant':
      case 'toolResult':
        return [msg as Message]
      case 'bashExecution':
        // Convert bash execution to user message with output
        return [{
          role: 'user' as const,
          content: `Command: ${msg.command}\nOutput: ${msg.output}`,
          timestamp: msg.timestamp,
        }] as Message[]
      case 'compactionSummary':
        // Convert compaction summary to user message
        return [{
          role: 'user' as const,
          content: `[Previous conversation summary]\n${msg.summary}`,
          timestamp: msg.timestamp,
        }] as Message[]
      case 'branchSummary':
        return [{
          role: 'user' as const,
          content: `[Branch summary]\n${msg.summary}`,
          timestamp: msg.timestamp,
        }] as Message[]
      case 'custom':
        // Convert custom messages to user messages
        if (typeof msg.content === 'string') {
          return [{
            role: 'user' as const,
            content: msg.content,
            timestamp: msg.timestamp,
          }] as Message[]
        }
        return []
      default:
        return []
    }
  })
}
