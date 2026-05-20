import { Box, type Component, Container, Spacer, Text } from '@earendil-works/pi-tui'
import chalk from 'chalk'
import { theme } from '../theme.ts'

interface ToolResult {
  content: Array<{ type: string; text?: string }>
  isError: boolean
}

/**
 * Component that renders a tool execution with grey/green/red background (matching pi-coding-agent).
 */
export class ToolExecutionComponent extends Container {
  private toolName: string
  private toolCallId: string
  private args: any
  private expanded = false
  private executionStarted = false
  private result?: ToolResult
  private contentBox: Box

  constructor(toolName: string, toolCallId: string, args: any) {
    super()
    this.toolName = toolName
    this.toolCallId = toolCallId
    this.args = args

    this.contentBox = new Box(1, 1, (text: string) => theme.bg('toolPendingBg', text))
    this.addChild(new Spacer(1))
    this.addChild(this.contentBox)
    this.updateDisplay()
  }

  setExpanded(expanded: boolean): void {
    this.expanded = expanded
    this.updateDisplay()
  }

  markExecutionStarted(): void {
    this.executionStarted = true
    this.updateDisplay()
  }

  updateArgs(args: any): void {
    this.args = args
    this.updateDisplay()
  }

  updateResult(result: ToolResult, isPartial = false): void {
    this.result = result
    this.executionStarted = false
    this.updateDisplay()
  }

  private updateDisplay(): void {
    // Update background color based on state
    const bgFn = this.result
      ? this.result.isError
        ? (text: string) => theme.bg('toolErrorBg', text)
        : (text: string) => theme.bg('toolSuccessBg', text)
      : (text: string) => theme.bg('toolPendingBg', text)

    this.contentBox.setBgFn(bgFn)

    const icon = this.result
      ? this.result.isError
        ? chalk.hex('#cc6666')('✗')
        : chalk.hex('#b5bd68')('✓')
      : this.executionStarted
        ? chalk.hex('#ffff00')('⚙')
        : chalk.hex('#666666')('○')

    const argsStr = this.formatArgs(this.args)
    const header = `${icon} ${chalk.bold(this.toolName)}${argsStr ? chalk.hex('#666666')(`(${argsStr})`) : ''}`

    let content: string
    if (this.result) {
      const output = this.getOutputText()
      const preview = this.expanded
        ? output
        : output.slice(0, 300).replace(/\n/g, ' ')
      content = `${header}\n${chalk.hex('#808080')(preview)}`
    } else {
      content = `${header} ${chalk.hex('#666666')('running...')}`
    }

    // Replace content in box
    this.contentBox.clear()
    this.contentBox.addChild(new Text(content, 0, 0))
  }

  private getOutputText(): string {
    if (!this.result?.content) return ''
    return this.result.content
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('\n')
  }

  private formatArgs(args: any): string {
    if (!args) return ''
    const entries = Object.entries(args)
    if (entries.length === 0) return ''
    return entries
      .map(([key, value]) => {
        const val = typeof value === 'string' ? `"${value.slice(0, 50)}"` : String(value)
        return `${key}=${val}`
      })
      .join(', ')
  }
}
