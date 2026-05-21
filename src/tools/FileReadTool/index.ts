import { registerTool } from '../registry.ts'
import { createFileReadTool, TOOL_DEFAULT_PERMISSION } from './FileReadTool.ts'
import { FileReadToolUI } from './UI.tsx'

registerTool({
  name: 'read',
  defaultPermission: TOOL_DEFAULT_PERMISSION,
  createTool: createFileReadTool,
  ui: FileReadToolUI,
  formatDescription: (input) =>
    typeof input.file_path === 'string' ? `read ${input.file_path}` : '(unknown file)',
  extractMatchContent: (input) =>
    typeof input.file_path === 'string' ? input.file_path : undefined,
})
