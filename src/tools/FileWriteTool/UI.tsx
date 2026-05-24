/** @jsx h */
/** @jsxFrag Fragment */
import { h, Fragment } from '../../tui/jsxFactory.ts'
import { Box, Container, Text, type Component } from '@earendil-works/pi-tui'
import chalk from 'chalk'
import { theme } from '../../tui/theme.ts'
import {
  generateDiff,
  renderDiffPreview,
  renderFullDiff,
  renderChangeSummary,
  renderNewFilePreview,
  type DiffResult,
} from '../../utils/diffUtils.ts'

interface ToolResult {
  content: Array<{ type: string; text?: string }>
  isError: boolean
}

interface FileWriteDetails {
  path?: string
  bytesWritten?: number
  oldContent?: string
  newContent?: string
}

const COLLAPSED_MAX_HUNKS = 2
const COLLAPSED_PREVIEW_LINES = 12
const NEW_FILE_PREVIEW_LINES = 8

export class FileWriteToolUI extends Container {
  private args: any
  private expanded = false
  private executionStarted = false
  private result?: ToolResult
  private details?: FileWriteDetails
  private diffResult?: DiffResult
  private contentBox: Box

  constructor(toolCallId: string, args: any) {
    super()
    this.args = args
    this.contentBox = new Box(1, 1, (text: string) => theme.bg('toolPendingBg', text))
    this.addChild(this.contentBox)
    this.rebuild()
  }

  setExpanded(expanded: boolean): void {
    this.expanded = expanded
    this.rebuild()
  }

  markExecutionStarted(): void {
    this.executionStarted = true
    this.rebuild()
  }

  updateResult(result: ToolResult, isPartial = false): void {
    this.result = result
    if (!isPartial) {
      this.executionStarted = false
    }
    this.rebuild()
  }

  updateDetails(details: FileWriteDetails): void {
    this.details = details
    if (details.oldContent !== undefined && details.newContent !== undefined) {
      const filePath = details.path || this.args?.file_path || 'file'
      this.diffResult = generateDiff(details.oldContent, details.newContent, filePath)
    } else {
      this.diffResult = undefined
    }
    this.rebuild()
  }

  private rebuild(): void {
    const bgFn = this.result
      ? this.result.isError
        ? (text: string) => theme.bg('toolErrorBg', text)
        : (text: string) => theme.bg('toolSuccessBg', text)
      : (text: string) => theme.bg('toolPendingBg', text)
    this.contentBox.setBgFn(bgFn)

    const icon = this.result
      ? this.result.isError
        ? theme.fg('error', '✗')
        : theme.fg('success', '✓')
      : this.executionStarted
        ? theme.fg('warning', '⚙')
        : theme.dim('○')

    const filePath = this.details?.path || this.args?.file_path || ''
    const shortPath = filePath.split('/').slice(-2).join('/')
    const header = `${icon} ${chalk.bold('write')} ${theme.fg('accent', shortPath)}`

    this.contentBox.clear()

    if (!this.result) {
      this.contentBox.addChild(new Text(`${header} ${theme.dim('running…')}`))
      return
    }

    if (this.diffResult) {
      // Existing file updated — show diff
      const { additions, removals } = this.diffResult
      const summary = renderChangeSummary(additions, removals)
      const lines: string[] = [header, `  ${summary}`]

      const diffLines = this.expanded
        ? renderFullDiff(this.diffResult.patch, 80)
        : renderDiffPreview(this.diffResult.patch, 80, COLLAPSED_MAX_HUNKS, COLLAPSED_PREVIEW_LINES)

      for (const line of diffLines) {
        lines.push(`  ${line}`)
      }

      if (!this.expanded && this.diffResult.patch.hunks.length > COLLAPSED_MAX_HUNKS) {
        lines.push(theme.dim('  (expand to see full diff)'))
      }

      this.contentBox.addChild(new Text(lines.join('\n')))
    } else if (this.details?.newContent) {
      // New file — show syntax preview
      const content = this.details.newContent
      const lineCount = content.split('\n').length
      const summary = theme.fg('muted', `${lineCount} line${lineCount === 1 ? '' : 's'}`)
      const lines: string[] = [header, `  ${summary}`]

      const previewLines = renderNewFilePreview(content, this.expanded ? 50 : NEW_FILE_PREVIEW_LINES)
      for (const line of previewLines) {
        lines.push(`  ${line}`)
      }

      this.contentBox.addChild(new Text(lines.join('\n')))
    } else {
      // Fallback
      const output = this.getOutputPreview()
      this.contentBox.addChild(new Text(`${header}\n  ${theme.fg('muted', output)}`))
    }
  }

  private getOutputPreview(): string {
    if (!this.result?.content) return ''
    return this.result.content
      .filter((c) => c.type === 'text')
      .map((c) => (c.text ?? '').slice(0, 200).replace(/\n/g, ' '))
      .join(' ')
  }
}
