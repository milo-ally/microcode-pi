import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core'
import { readFile, access } from 'fs/promises'
import { constants } from 'fs'
import { isAbsolute, resolve } from 'path'
import { Type, type Static } from 'typebox'
import type { PermissionBehavior } from '../../permissions/types.ts'

export const TOOL_NAME = 'read'
export const TOOL_DEFAULT_PERMISSION: PermissionBehavior = 'allow'

const readSchema = Type.Object({
  file_path: Type.String({ description: 'Path to the file to read (relative or absolute)' }),
  offset: Type.Optional(
    Type.Number({ description: 'Line number to start reading from (1-indexed)' }),
  ),
  limit: Type.Optional(
    Type.Number({ description: 'Maximum number of lines to read (default 2000)' }),
  ),
})

export type FileReadToolInput = Static<typeof readSchema>

export interface FileReadToolDetails {
  path: string
  totalLines: number
  returnedLines: number
  truncated: boolean
}

const DEFAULT_LIMIT = 2000

function addLineNumbers(content: string, startLine: number): string {
  const lines = content.split('\n')
  const maxLineNum = startLine + lines.length - 1
  const padding = String(maxLineNum).length
  return lines
    .map((line, i) => {
      const lineNum = String(startLine + i).padStart(padding, ' ')
      return `${lineNum}\t${line}`
    })
    .join('\n')
}

export function createFileReadTool(cwd: string): AgentTool<typeof readSchema, FileReadToolDetails> {
  return {
    name: TOOL_NAME,
    label: 'Read',
    description:
      'Read the contents of a text file. Returns file content with line numbers. Use offset and limit for large files. Do NOT use for images, binaries, or non-text files — use the vision tool for images instead.',
    parameters: readSchema,
    async execute(
      _toolCallId: string,
      params: FileReadToolInput,
    ): Promise<AgentToolResult<FileReadToolDetails>> {
      const filePath = isAbsolute(params.file_path)
        ? params.file_path
        : resolve(cwd, params.file_path)

      await access(filePath, constants.R_OK)

      // Read raw buffer to detect binary files — the read tool is for text only.
      const buf = await readFile(filePath)
      const isBinary = buf.slice(0, 512).includes(0)
      if (isBinary) {
        const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
        const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext)
        const tip = isImage
          ? ' Use the vision tool to analyze image files.'
          : ''
        throw new Error(
          `Cannot read binary file: ${filePath}.${tip}`,
        )
      }

      const content = buf.toString('utf-8')
      const allLines = content.split('\n')
      const totalLines = allLines.length

      const offset = Math.max(1, params.offset ?? 1)
      const limit = params.limit ?? DEFAULT_LIMIT

      const startIdx = offset - 1
      const endIdx = Math.min(startIdx + limit, totalLines)
      const selectedLines = allLines.slice(startIdx, endIdx)
      const truncated = endIdx < totalLines

      const numberedContent = addLineNumbers(selectedLines.join('\n'), offset)

      let result = numberedContent
      if (truncated) {
        result += `\n\n... (${totalLines - endIdx} more lines, ${totalLines} total. Use offset=${endIdx + 1} to continue)`
      }

      return {
        content: [{ type: 'text', text: result }],
        details: {
          path: filePath,
          totalLines,
          returnedLines: selectedLines.length,
          truncated,
        },
      }
    },
  }
}
