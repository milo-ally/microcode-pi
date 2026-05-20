import type { AgentTool } from '@earendil-works/pi-agent-core'
import { createBashTool } from './BashTool/BashTool.ts'
import { createFileReadTool } from './FileReadTool/FileReadTool.ts'
import { createFileWriteTool } from './FileWriteTool/FileWriteTool.ts'
import { createFileEditTool } from './FileEditTool/FileEditTool.ts'

export { createBashTool } from './BashTool/BashTool.ts'
export { createFileReadTool } from './FileReadTool/FileReadTool.ts'
export { createFileWriteTool } from './FileWriteTool/FileWriteTool.ts'
export { createFileEditTool } from './FileEditTool/FileEditTool.ts'
export { createMcpTool, createMcpTools } from './MCPTool/MCPTool.ts'
export { createListMcpResourcesTool } from './ListMcpResourcesTool/ListMcpResourcesTool.ts'
export { createReadMcpResourceTool } from './ReadMcpResourceTool/ReadMcpResourceTool.ts'

export function createCodingTools(cwd: string): AgentTool<any, any>[] {
  return [
    createBashTool(cwd),
    createFileReadTool(cwd),
    createFileWriteTool(cwd),
    createFileEditTool(cwd),
  ]
}
