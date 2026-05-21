import { registerTool } from '../registry.ts'
import { createBashTool, TOOL_DEFAULT_PERMISSION } from './BashTool.ts'
import { BashToolUI } from './UI.tsx'

registerTool({
  name: 'bash',
  defaultPermission: TOOL_DEFAULT_PERMISSION,
  createTool: createBashTool,
  ui: BashToolUI,
  formatDescription: (input) =>
    typeof input.command === 'string' ? input.command : '(unknown command)',
  extractMatchContent: (input) =>
    typeof input.command === 'string' ? input.command : undefined,
})
