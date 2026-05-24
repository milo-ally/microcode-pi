import { Agent, type AgentMessage, type AgentTool, type ThinkingLevel } from '@earendil-works/pi-agent-core'
import { type Api, type Message, type Model, streamSimple} from '@earendil-works/pi-ai'
import { getModelConfig, resolveApiKey } from './models/index.ts'
import { createCodingTools, createToolSearchTool, getDeferredToolNames, TOOL_SEARCH_TOOL_NAME } from './tools/index.ts'
import { getSystemPrompt } from './constants/prompts.ts'
import { getAllDeferredToolDefinitions } from './tools/registry.ts'
import type { McpServerState } from './mcp/types.ts'
import { CompactionManager, type CompactionProgress } from './session/CompactionManager.ts'
import type { PermissionManager } from './permissions/index.ts'
import { loadSkills, type Skill } from './skill/skill.ts'

export interface CreateMicrocodeAgentOptions {
  cwd?: string
  modelId?: string
  thinkingLevel?: ThinkingLevel
  mcpServers?: McpServerState[]
  onCompactionProgress?: (progress: CompactionProgress) => void
  permissionManager?: PermissionManager
  skillPaths?: string[]
}

export function createMicrocodeAgent(options: CreateMicrocodeAgentOptions = {}) {

  // Get the working directory path
  const cwd = options.cwd ?? process.cwd()

  // All model capabilities + API key resolved from registry.ts (Where ModelConfig is defined, getModelConfig function returns ModelConfig object)
  // ModelConfig includes: model(id, provider, name, api, baseUrl, compat, reasoning, thinkingLevelMap, input, cost, contextWindow, maxTokens), apiKey
  const modelConfig = getModelConfig(options.modelId)

  // Load skills
  const skillsResult = loadSkills({
    cwd,
    skillPaths: options.skillPaths ?? [],
    includeDefaults: true,
  })

  // Track tools discovered via ToolSearchTool for injection into the next turn
  const discoveredToolNames = new Set<string>()
  let pendingDiscoveredTools: AgentTool<any, any>[] = []

  // Create core tools (excluding deferred tools)
  const coreTools = createCodingTools({
    cwd,
    getSkills: () => skillsResult.skills,
  })

  // Create ToolSearchTool with callbacks
  const toolSearchTool = createToolSearchTool({
    getDeferredTools: getAllDeferredToolDefinitions,
    onToolsDiscovered: (names: string[]) => {
      for (const name of names) {
        if (!discoveredToolNames.has(name)) {
          discoveredToolNames.add(name)
          // Create the actual tool instance from the registry definition
          const def = getAllDeferredToolDefinitions().find(d => d.name === name)
          if (def) {
            pendingDiscoveredTools.push(def.createTool(cwd))
          }
        }
      }
    },
  })

  // Build initial tools: core tools + ToolSearchTool
  const initialTools: AgentTool<any, any>[] = [...coreTools, toolSearchTool]

  // Get deferred tool names for the system prompt
  const deferredToolNames = getDeferredToolNames()

  // Build system prompt with deferred tools section
  const systemPromptSections = getSystemPrompt({
    cwd,
    modelId: modelConfig.model.id,
    mcpServers: options.mcpServers,
    skills: skillsResult.skills,
    deferredToolNames: deferredToolNames.length > 0 ? deferredToolNames : undefined,
  })

  // Create compaction manager
  const compactionManager = new CompactionManager({
    model: modelConfig.model,
    apiKey: modelConfig.apiKey,
    onProgress: options.onCompactionProgress,
  })

  // Create agent
  const agent: Agent = new Agent({
    initialState: {
      systemPrompt: systemPromptSections.join('\n\n'),
      model: modelConfig.model,
      tools: initialTools,
    },
    beforeToolCall: options.permissionManager
      ? async (ctx, _signal) => {
          return options.permissionManager!.checkPermissionWithPrompt(ctx)
        }
      : undefined,
    afterToolCall: async (ctx) => {
      // After ToolSearchTool executes, inject discovered tools into agent state
      if (ctx.toolCall.name === TOOL_SEARCH_TOOL_NAME && pendingDiscoveredTools.length > 0) {
        const newTools = pendingDiscoveredTools
        pendingDiscoveredTools = []
        // Update both agent.state.tools AND context.tools so the next API call sees them
        agent.state.tools = [...agent.state.tools, ...newTools]
        ctx.context.tools = [...(ctx.context.tools ?? []), ...newTools]
      }
      return undefined
    },
    streamFn: async (model, context, opts) => {
      // Dynamic resolution: env vars may have been set after startup
      const apiKey = resolveApiKey(model) || modelConfig.apiKey
      if (!apiKey) {
        const provider = (model.provider as string).toUpperCase().replace(/-/g, '_')
        throw new Error(
          `No API key configured for model "${model.id}".\n` +
          `Set one of: ${provider}_API_KEY, API_KEY, OPENAI_API_KEY`,
        )
      }
      return streamSimple(model, context, {
        ...opts,
        apiKey,
      })
    },
    convertToLlm: createConvertToLlm(() => agent.state.model),
    transformContext: async (messages, _signal) => {

      // Layer 1: Microcompact old tool results
      const { messages: microcompacted } = compactionManager.microcompact(messages)

      // Layer 2: Auto-compact if context window is full
      if (compactionManager.isCompactionNeeded(microcompacted)) {
        try {
          return await compactionManager.autoCompact(microcompacted)
        } catch {
          return microcompacted // If auto-compact fails, continue with microcompacted messages
        }
      }
      return microcompacted
    },
  })

  // Set thinking level if provided
  if (options.thinkingLevel) {
    agent.state.thinkingLevel = options.thinkingLevel
  }

  // Attach compactionManager to agent for external access
  ;(agent as any).__compactionManager = compactionManager

  // Attach skills to agent for external access
  ;(agent as any).__skills = skillsResult.skills
  ;(agent as any).__skillDiagnostics = skillsResult.diagnostics

  // Wire up getTool resolver on PermissionManager so it can look up tools
  // by name (used by ask_user_question to store answers on the tool object)
  if (options.permissionManager) {
    options.permissionManager.setGetTool((name: string) =>
      agent.state.tools.find((t: any) => t.name === name),
    )
  }

  return agent
}

/**
 * Get the CompactionManager attached to an agent.
 */
export function getCompactionManager(agent: Agent): CompactionManager | undefined {
  return (agent as any).__compactionManager
}

/**
 * Get the skills attached to an agent.
 */
export function getSkills(agent: Agent): Skill[] {
  return (agent as any).__skills ?? []
}

/**
 * Get the skill diagnostics attached to an agent.
 */
export function getSkillDiagnostics(agent: Agent): string[] {
  return (agent as any).__skillDiagnostics ?? []
}

/**
 * Create convertToLlm function, handle cross-API compatibility for thinking blocks.
 *
 * All capability judgments are based on model.compat (defined in registry.ts):
 * - requiresReasoningContentOnAssistantMessages: true → extract thinking text to reasoning_content field
 * - This field is read by OpenAI provider and included in API requests
 *
 * Use factory function + getModel closure, support automatic adaptation after /model switch.
 */
export function createConvertToLlm(getModel: () => Model<Api>) {
  return (messages: AgentMessage[]): Message[] => {
    // model includes: id, provider, name, api, baseUrl, compat, reasoning, thinkingLevelMap, input, cost, contextWindow, maxTokens
    const model = getModel() 
    const compat = model.compat as any
    const requiresReasoningContent = compat?.requiresReasoningContentOnAssistantMessages && model.reasoning

    return messages.flatMap((msg) => {
      switch (msg.role) {
        case 'user':
        case 'toolResult':
          return [msg as Message]

        case 'assistant':
          {
            // OpenAI protocol: extract thinking blocks into reasoning_content field.
            // Anthropic protocol: pass thinking blocks through as-is (DeepSeek's
            // Anthropic-compatible API requires them to be returned).
            if (model.api === 'openai-completions') {
              const thinkingText = msg.content
                .filter((c: any) => c.type === 'thinking')
                .map((c: any) => c.thinking)
                .join('\n')

              const filtered = msg.content.filter((c: any) => c.type !== 'thinking')
              const result: any = { ...msg, content: filtered }

              if (requiresReasoningContent) {
                result.reasoning_content = thinkingText || ''
              }
              return [result as Message]
            }

            // anthropic-messages (and other protocols): preserve thinking blocks
            return [msg as Message]
          }

        case 'bashExecution':
          return [{
            role: 'user' as const,
            content: `Command: ${msg.command}\nOutput: ${msg.output}`,
            timestamp: msg.timestamp,
          }] as Message[]

        case 'compactionSummary':
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
}
