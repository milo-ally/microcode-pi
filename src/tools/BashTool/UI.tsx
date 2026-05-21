/** @jsx h */
/** @jsxFrag Fragment */
import { h, Fragment } from '../../tui/jsxFactory.ts'
import { Box, Container, Text, type Component } from '@earendil-works/pi-tui'
import chalk from 'chalk'
import { theme } from '../../tui/theme.ts'

import type { ToolUIComponent, ToolResult } from '../registry.ts'

interface BashDetails {
  stdout: string
  stderr: string
  exitCode: number | null
}

const COLLAPSED_OUTPUT_LINES = 12
const COMMAND_PREVIEW_LEN = 80

export class BashToolUI extends Container implements ToolUIComponent {
  private args: any
  private expanded = false
  private executionStarted = false
  private result?: ToolResult
  private details?: BashDetails
  private contentBox: Box

  constructor(toolCallId: string, args: any) {
    super()
    this.args = args
    this.contentBox = new Box(1, 0, (text: string) => theme.bg('toolPendingBg', text))
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

  updateDetails(details: Record<string, unknown>): void {
    this.details = details as unknown as BashDetails
    this.rebuild()
  }

  private rebuild(): void {
    const bgFn = this.result && !this.executionStarted
      ? this.result.isError
        ? (text: string) => theme.bg('toolErrorBg', text)
        : (text: string) => theme.bg('toolSuccessBg', text)
      : (text: string) => theme.bg('toolPendingBg', text)
    this.contentBox.setBgFn(bgFn)

    const icon = this.result && !this.executionStarted
      ? this.result.isError
        ? chalk.hex('#cc6666')('✗')
        : chalk.hex('#b5bd68')('✓')
      : this.executionStarted
        ? chalk.hex('#ffff00')('⚙')
        : chalk.hex('#666666')('○')

    const cmd = this.args?.command ?? ''
    const shortCmd = cmd.length > COMMAND_PREVIEW_LEN
      ? cmd.slice(0, COMMAND_PREVIEW_LEN) + '...'
      : cmd
    const description = this.args?.description
    const header = description
      ? `${icon} ${chalk.bold('bash')} ${chalk.hex('#666666')(description)}`
      : `${icon} ${chalk.bold('bash')} ${chalk.hex('#808080')('$')} ${chalk.hex('#d4d4d4')(shortCmd)}`

    this.contentBox.clear()

    if (!this.result) {
      this.contentBox.addChild(new Text(`${header} ${chalk.hex('#666666')('running...')}`))
      return
    }

    const output = this.getOutput()
    const lines = output.split('\n')

    if (lines.length === 0 || (lines.length === 1 && !lines[0])) {
      const exitLine = this.renderExitCode()
      this.contentBox.addChild(new Text(exitLine ? `${header}\n${exitLine}` : header))
      return
    }

    const needsCollapse = lines.length > COLLAPSED_OUTPUT_LINES && !this.expanded
    const displayLines = needsCollapse ? lines.slice(0, COLLAPSED_OUTPUT_LINES) : lines
    const outputText = displayLines.join('\n')

    const exitLine = this.renderExitCode()
    const toggleHint = lines.length > COLLAPSED_OUTPUT_LINES
      ? chalk.hex('#505050')(this.expanded ? ' [collapse]' : ` [expand, ${lines.length} lines]`)
      : ''

    let content = header
    if (toggleHint) content += toggleHint
    content += `\n${outputText}`
    if (exitLine) content += `\n${exitLine}`

    this.contentBox.addChild(new Text(content))
  }

  private renderExitCode(): string {
    if (!this.details || this.executionStarted) return ''
    const { exitCode } = this.details
    if (exitCode === null || exitCode === undefined) return ''
    if (exitCode === 0) {
      return chalk.hex('#505050')(`exit: ${exitCode}`)
    }
    return chalk.hex('#cc6666')(`exit: ${exitCode}`)
  }

  private getOutput(): string {
    if (this.details) {
      const { stdout, stderr } = this.details
      return (stdout + stderr).trimEnd()
    }
    if (!this.result?.content) return ''
    return this.result.content
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('')
      .trimEnd()
  }
}
