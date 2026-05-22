/** @jsx h */
/** @jsxFrag Fragment */
import { h, Fragment } from '../../tui/jsxFactory.ts'
import { Box, Container, Text, type Component } from '@earendil-works/pi-tui'
import chalk from 'chalk'
import { theme } from '../../tui/theme.ts'

interface ToolResult {
  content: Array<{ type: string; text?: string }>
  isError: boolean
}

interface FileReadDetails {
  path?: string
  totalLines?: number
  returnedLines?: number
  truncated?: boolean
}

export class FileReadToolUI extends Container {
  private args: any
  private expanded = false
  private executionStarted = false
  private result?: ToolResult
  private details?: FileReadDetails
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

  updateDetails(details: FileReadDetails): void {
    this.details = details
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
    const header = `${icon} ${chalk.bold('read')} ${theme.fg('accent', shortPath)}`

    this.contentBox.clear()

    if (!this.result) {
      this.contentBox.addChild(new Text(`${header} ${theme.dim('running…')}`))
      return
    }

    const totalLines = this.details?.totalLines
    const returnedLines = this.details?.returnedLines
    const truncated = this.details?.truncated

    if (totalLines !== undefined && returnedLines !== undefined) {
      const lineInfo = truncated
        ? `${returnedLines}/${totalLines} lines ${theme.dim('(truncated)')}`
        : `${returnedLines} lines`
      const summary = theme.fg('muted', lineInfo)
      this.contentBox.addChild(new Text(`${header}  ${summary}`))
    } else {
      const output = this.result.content
        ?.filter((c) => c.type === 'text')
        .map((c) => (c.text ?? '').slice(0, 200).replace(/\n/g, ' '))
        .join(' ') ?? ''
      this.contentBox.addChild(new Text(`${header}\n  ${theme.fg('muted', output)}`))
    }
  }
}
