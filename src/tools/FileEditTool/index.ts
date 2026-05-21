import { registerTool } from '../registry.ts'
import { createFileEditTool, TOOL_DEFAULT_PERMISSION } from './FileEditTool.ts'
import { FileEditToolUI } from './UI.tsx'

registerTool({
  name: 'edit',
  defaultPermission: TOOL_DEFAULT_PERMISSION,
  createTool: createFileEditTool,
  ui: FileEditToolUI,
  formatDescription: (input) =>
    typeof input.file_path === 'string' ? `edit ${input.file_path}` : '(unknown file)',
  extractMatchContent: (input) =>
    typeof input.file_path === 'string' ? input.file_path : undefined,
})
