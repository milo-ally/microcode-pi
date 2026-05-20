import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core'
import { writeFile, mkdir, readFile } from 'fs/promises'
import { dirname, isAbsolute, resolve } from 'path'
import { Type, type Static } from 'typebox'
import type { PermissionBehavior } from '../../permissions/types.ts'

export const TOOL_DEFAULT_PERMISSION: PermissionBehavior = 'ask'

const writeSchema = Type.Object({
  file_path: Type.String({ description: 'Path to the file to write (relative or absolute)' }),
  content: Type.String({ description: 'Content to write to the file' }),
})

export type FileWriteToolInput = Static<typeof writeSchema>

export interface FileWriteToolDetails {
  path: string
  bytesWritten: number
  oldContent?: string
  newContent?: string
}

export function createFileWriteTool(cwd: string): AgentTool<typeof writeSchema, FileWriteToolDetails> {
  return {
    name: 'write',
    label: 'Write',
    description:
      'Write content to a file. Creates the file if it does not exist, overwrites if it does. Creates parent directories as needed.',
    parameters: writeSchema,
    async execute(
      _toolCallId: string,
      params: FileWriteToolInput,
    ): Promise<AgentToolResult<FileWriteToolDetails>> {
      const filePath = isAbsolute(params.file_path)
        ? params.file_path
        : resolve(cwd, params.file_path)

      // Read existing content before overwriting (for diff display)
      let oldContent: string | undefined
      try {
        oldContent = await readFile(filePath, 'utf-8')
      } catch {
        // File doesn't exist yet — new file
      }

      const dir = dirname(filePath)
      await mkdir(dir, { recursive: true })

      await writeFile(filePath, params.content, 'utf-8')

      return {
        content: [
          {
            type: 'text',
            text: `File written successfully: ${filePath} (${params.content.length} bytes)`,
          },
        ],
        details: {
          path: filePath,
          bytesWritten: params.content.length,
          oldContent,
          newContent: params.content,
        },
      }
    },
  }
}
