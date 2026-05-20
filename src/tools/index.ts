import type { AgentTool } from '@earendil-works/pi-agent-core'
import type { PermissionBehavior } from '../permissions/types.ts'
import { createBashTool, TOOL_DEFAULT_PERMISSION as bashDefault } from './BashTool/BashTool.ts'
import { createFileReadTool, TOOL_DEFAULT_PERMISSION as fileReadDefault } from './FileReadTool/FileReadTool.ts'
import { createFileWriteTool, TOOL_DEFAULT_PERMISSION as fileWriteDefault } from './FileWriteTool/FileWriteTool.ts'
import { createFileEditTool, TOOL_DEFAULT_PERMISSION as fileEditDefault } from './FileEditTool/FileEditTool.ts'
import {
  createSkillToolWithAgent,
  TOOL_DEFAULT_PERMISSION as skillDefault,
} from './SkillTool/SkillTool.ts'

export { createBashTool, TOOL_DEFAULT_PERMISSION as BASH_DEFAULT_PERMISSION } from './BashTool/BashTool.ts'
export { createFileReadTool, TOOL_DEFAULT_PERMISSION as FILE_READ_DEFAULT_PERMISSION } from './FileReadTool/FileReadTool.ts'
export { createFileWriteTool, TOOL_DEFAULT_PERMISSION as FILE_WRITE_DEFAULT_PERMISSION } from './FileWriteTool/FileWriteTool.ts'
export { createFileEditTool, TOOL_DEFAULT_PERMISSION as FILE_EDIT_DEFAULT_PERMISSION } from './FileEditTool/FileEditTool.ts'
export { createMcpTool, createMcpTools } from './MCPTool/MCPTool.ts'
export { createListMcpResourcesTool } from './ListMcpResourcesTool/ListMcpResourcesTool.ts'
export { createReadMcpResourceTool } from './ReadMcpResourceTool/ReadMcpResourceTool.ts'
export { createSkillToolWithAgent, TOOL_DEFAULT_PERMISSION as SKILL_DEFAULT_PERMISSION } from './SkillTool/SkillTool.ts'

/** Default permission behavior for each built-in tool (tool name → behavior). */
export const TOOL_DEFAULT_PERMISSIONS: Record<string, PermissionBehavior> = {
  bash: bashDefault,
  read: fileReadDefault,
  write: fileWriteDefault,
  edit: fileEditDefault,
  skill: skillDefault,
}

export interface CreateCodingToolsOptions {
  cwd: string
  getSkills?: () => any[]
}

export function createCodingTools(options: CreateCodingToolsOptions): AgentTool<any, any>[] {
  const { cwd, getSkills } = options

  const tools: AgentTool<any, any>[] = [
    createBashTool(cwd),
    createFileReadTool(cwd),
    createFileWriteTool(cwd),
    createFileEditTool(cwd),
  ]

  // Add SkillTool if getSkills is provided
  if (getSkills) {
    tools.push(createSkillToolWithAgent({ getSkills }))
  }

  return tools
}
