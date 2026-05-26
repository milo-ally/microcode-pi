import type { AgentTool } from '@earendil-works/pi-agent-core'
import type { PermissionBehavior } from '../permissions/types.ts'
import { getAllToolDefinitions, getAllDeferredToolDefinitions, getCoreToolDefinitions, getToolDefaultPermissions, registerTool } from './registry.ts'
import { createSkillToolWithAgent, TOOL_DEFAULT_PERMISSION as skillDefault } from './SkillTool/SkillTool.ts'
import { createToolSearchTool, TOOL_SEARCH_TOOL_NAME, type ToolSearchToolOptions } from './ToolSearchTool/ToolSearchTool.ts'

// Import tool registrations (side effects — each calls registerTool())
import './BashTool/index.ts'
import './FileEditTool/index.ts'
import './FileWriteTool/index.ts'
import './FileReadTool/index.ts'
import './ToolSearchTool/index.ts'
import './AskUserQuestionTool/index.ts'
import './GrepTool/index.ts'
import './GlobTool/index.ts'
import './VisionTool/index.ts'

// Re-exports for backward compatibility
export { createBashTool, TOOL_DEFAULT_PERMISSION as BASH_DEFAULT_PERMISSION } from './BashTool/BashTool.ts'
export { createFileReadTool, TOOL_DEFAULT_PERMISSION as FILE_READ_DEFAULT_PERMISSION } from './FileReadTool/FileReadTool.ts'
export { createFileWriteTool, TOOL_DEFAULT_PERMISSION as FILE_WRITE_DEFAULT_PERMISSION } from './FileWriteTool/FileWriteTool.ts'
export { createFileEditTool, TOOL_DEFAULT_PERMISSION as FILE_EDIT_DEFAULT_PERMISSION } from './FileEditTool/FileEditTool.ts'
export { createMcpTool, createMcpTools, registerMcpToolsAsDeferred } from './MCPTool/MCPTool.ts'
export { createListMcpResourcesTool } from './ListMcpResourcesTool/ListMcpResourcesTool.ts'
export { createReadMcpResourceTool } from './ReadMcpResourceTool/ReadMcpResourceTool.ts'
export { createSkillToolWithAgent, TOOL_DEFAULT_PERMISSION as SKILL_DEFAULT_PERMISSION } from './SkillTool/SkillTool.ts'
export { createToolSearchTool, TOOL_SEARCH_TOOL_NAME } from './ToolSearchTool/ToolSearchTool.ts'
export type { ToolSearchToolOptions } from './ToolSearchTool/ToolSearchTool.ts'
export { createAskUserQuestionTool, ASK_USER_QUESTION_TOOL_NAME } from './AskUserQuestionTool/AskUserQuestionTool.ts'
export { createGrepTool, TOOL_NAME as GREP_TOOL_NAME, TOOL_DEFAULT_PERMISSION as GREP_DEFAULT_PERMISSION } from './GrepTool/GrepTool.ts'
export { createGlobTool, TOOL_NAME as GLOB_TOOL_NAME, TOOL_DEFAULT_PERMISSION as GLOB_DEFAULT_PERMISSION } from './GlobTool/GlobTool.ts'
export { createVisionTool, TOOL_NAME as VISION_TOOL_NAME, TOOL_DEFAULT_PERMISSION as VISION_DEFAULT_PERMISSION } from './VisionTool/VisionTool.ts'

/** Get the names of all deferred tool definitions (for system prompt listing). */
export function getDeferredToolNames(): string[] {
  return getAllDeferredToolDefinitions().map(def => def.name)
}

/** Default permission behavior for each built-in tool (tool name → behavior). */
export const TOOL_DEFAULT_PERMISSIONS: Record<string, PermissionBehavior> = {
  ...getToolDefaultPermissions(),
  skill: skillDefault,
}

// ============================================================================
// Tool creation
// ============================================================================

export interface CreateCodingToolsOptions {
  cwd: string
  getSkills?: () => any[]
  /** If true, include deferred tools in the output. Default: false. */
  includeDeferred?: boolean
  /** If false, the vision tool is excluded. Default: true. */
  modelSupportsImages?: boolean
}

export function createCodingTools(options: CreateCodingToolsOptions): AgentTool<any, any>[] {
  const { cwd, getSkills, includeDeferred = false, modelSupportsImages = true } = options

  const tools: AgentTool<any, any>[] = []

  // Create tools from registry (excluding skill, which needs special handling)
  const defs = includeDeferred ? getAllToolDefinitions() : getCoreToolDefinitions()
  for (const def of defs) {
    if (def.name === 'skill') continue
    // Skip ToolSearchTool placeholder — it's created separately in agent.ts
    if (def.name === TOOL_SEARCH_TOOL_NAME) continue
    // Skip vision tool if model doesn't support images
    if (def.name === 'vision' && !modelSupportsImages) continue
    tools.push(def.createTool(cwd))
  }

  // SkillTool needs getSkills at creation time
  if (getSkills) {
    registerTool({
      name: 'skill',
      defaultPermission: skillDefault,
      createTool: () => createSkillToolWithAgent({ getSkills }),
      formatDescription: (input) =>
        typeof input.skill === 'string' ? `skill ${input.skill}` : '(unknown skill)',
      extractMatchContent: (input) =>
        typeof input.skill === 'string' ? input.skill : undefined,
    })
    tools.push(createSkillToolWithAgent({ getSkills }))
  }

  return tools
}
