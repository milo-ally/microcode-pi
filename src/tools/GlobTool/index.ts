import { registerTool } from '../registry.ts'
import { createGlobTool, TOOL_NAME, TOOL_DEFAULT_PERMISSION } from './GlobTool.ts'
import { GlobToolUI } from './UI.tsx'

registerTool({
  name: TOOL_NAME,
  defaultPermission: TOOL_DEFAULT_PERMISSION,
  createTool: createGlobTool,
  ui: GlobToolUI,
  description:
    'Find files by glob pattern using ripgrep. Returns matching file paths sorted by modification time. Supports standard glob patterns like "**/*.ts" or "src/**/*.spec.ts".',
  formatDescription: (input) =>
    typeof input.pattern === 'string' ? `glob ${input.pattern}` : '(unknown pattern)',
  extractMatchContent: (input) =>
    typeof input.pattern === 'string' ? input.pattern : undefined,
})
