import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core'
import { readFile, writeFile } from 'fs/promises'
import { isAbsolute, resolve } from 'path'
import { Type, type Static } from 'typebox'

const editSchema = Type.Object({
  file_path: Type.String({ description: 'Path to the file to edit (relative or absolute)' }),
  old_string: Type.String({ description: 'The exact string to find and replace' }),
  new_string: Type.String({ description: 'The string to replace old_string with' }),
  replace_all: Type.Optional(
    Type.Boolean({ description: 'Replace all occurrences (default false)' }),
  ),
})

export type FileEditToolInput = Static<typeof editSchema>

export interface FileEditToolDetails {
  path: string
  replacements: number
  oldContent?: string
  newContent?: string
}

export function createFileEditTool(cwd: string): AgentTool<typeof editSchema, FileEditToolDetails> {
  return {
    name: 'edit',
    label: 'Edit',
    description:
      'Edit a file by replacing an exact string match. The old_string must be unique in the file unless replace_all is true.',
    parameters: editSchema,
    async execute(
      _toolCallId: string,
      params: FileEditToolInput,
    ): Promise<AgentToolResult<FileEditToolDetails>> {
      const filePath = isAbsolute(params.file_path)
        ? params.file_path
        : resolve(cwd, params.file_path)

      const content = await readFile(filePath, 'utf-8')

      if (params.old_string === params.new_string) {
        throw new Error('old_string and new_string are identical')
      }

      const replaceAll = params.replace_all ?? false

      if (replaceAll) {
        const count = content.split(params.old_string).length - 1
        if (count === 0) {
          throw new Error(`old_string not found in ${filePath}`)
        }
        const newContent = content.replaceAll(params.old_string, params.new_string)
        await writeFile(filePath, newContent, 'utf-8')
        return {
          content: [
            {
              type: 'text',
              text: `Replaced ${count} occurrence(s) in ${filePath}`,
            },
          ],
          details: { path: filePath, replacements: count, oldContent: content, newContent },
        }
      }

      const count = content.split(params.old_string).length - 1
      if (count === 0) {
        throw new Error(
          `old_string not found in ${filePath}. Make sure the string matches exactly, including whitespace and indentation.`,
        )
      }
      if (count > 1) {
        throw new Error(
          `old_string is not unique in ${filePath} (${count} matches found). Provide more context to make it unique, or use replace_all.`,
        )
      }

      const newContent = content.replace(params.old_string, params.new_string)
      await writeFile(filePath, newContent, 'utf-8')

      return {
        content: [
          {
            type: 'text',
            text: `Replaced 1 occurrence in ${filePath}`,
          },
        ],
        details: { path: filePath, replacements: 1, oldContent: content, newContent },
      }
    },
  }
}
