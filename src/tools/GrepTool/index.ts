import { registerTool } from '../registry.ts'
import { createGrepTool, TOOL_NAME, TOOL_DEFAULT_PERMISSION } from './GrepTool.ts'
import { GrepToolUI } from './UI.tsx'

registerTool({
  name: TOOL_NAME,
  defaultPermission: TOOL_DEFAULT_PERMISSION,
  createTool: createGrepTool,
  ui: GrepToolUI,
  description:
    'Search file contents with regex using ripgrep. Supports full regex syntax, output modes (content/files_with_matches/count), file type filtering, context lines, and pagination (head_limit/offset). Use in preference to running grep/rg from Bash.',
  formatDescription: (input) => {
    if (typeof input.pattern === 'string') {
      const mode = input.output_mode ? ` [${input.output_mode}]` : ''
      return `grep /${input.pattern}/${mode}`
    }
    return '(unknown pattern)'
  },
  extractMatchContent: (input) =>
    typeof input.pattern === 'string' ? input.pattern : undefined,
})
