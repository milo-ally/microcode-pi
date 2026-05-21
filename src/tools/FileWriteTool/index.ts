import { registerTool } from '../registry.ts'
import { createFileWriteTool, TOOL_DEFAULT_PERMISSION } from './FileWriteTool.ts'
import { FileWriteToolUI } from './UI.tsx'

registerTool({
  name: 'write',
  defaultPermission: TOOL_DEFAULT_PERMISSION,
  createTool: createFileWriteTool,
  ui: FileWriteToolUI,
  formatDescription: (input) =>
    typeof input.file_path === 'string' ? `write ${input.file_path}` : '(unknown file)',
  extractMatchContent: (input) =>
    typeof input.file_path === 'string' ? input.file_path : undefined,
})
