/** @jsx h */
/** @jsxFrag Fragment */
import { h, Fragment } from '../../tui/jsxFactory.ts'
import { Box, Container, Text } from '@earendil-works/pi-tui'
import chalk from 'chalk'
import { theme } from '../../tui/theme.ts'

interface ToolResult {
  content: Array<{ type: string; text?: string }>
  isError: boolean
}

interface GrepDetails {
  mode?: 'content' | 'files_with_matches' | 'count'
  numFiles?: number
  numMatches?: number
  numLines?: number
  truncated?: boolean
}

const modeLabels: Record<string, string> = {
  content: 'content',
  files_with_matches: 'files',
  count: 'count',
}

export class GrepToolUI extends Container {
  private args: any
  private expanded = false
  private executionStarted = false
  private result?: ToolResult
  private details?: GrepDetails
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

  updateDetails(details: GrepDetails): void {
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

    const pattern = this.args?.pattern || '...'
    const shortPattern = pattern.length > 40 ? pattern.slice(0, 40) + '...' : pattern
    const mode = this.args?.output_mode || 'content'
    const modeTag = theme.dim(`[${modeLabels[mode] ?? mode}]`)

    this.contentBox.clear()

    if (!this.result) {
      this.contentBox.addChild(
        new Text(
          `${icon} ${chalk.bold('Grep')} ${theme.fg('accent', '/' + shortPattern + '/')} ${modeTag} ${theme.dim('running…')}`,
        ),
      )
      return
    }

    if (this.result.isError) {
      const errText = this.result.content
        ?.filter((c) => c.type === 'text')
        .map((c) => (c.text ?? '').slice(0, 200))
        .join(' ') ?? ''
      this.contentBox.addChild(
        new Text(
          `${icon} ${chalk.bold('Grep')} ${theme.fg('accent', '/' + shortPattern + '/')}  ${theme.fg('error', errText)}`,
        ),
      )
      return
    }

    const numFiles = this.details?.numFiles
    const numMatches = this.details?.numMatches
    const truncated = this.details?.truncated

    const parts: string[] = []
    if (numFiles !== undefined && numFiles > 0) parts.push(`${numFiles} file${numFiles !== 1 ? 's' : ''}`)
    if (numMatches !== undefined && numMatches > 0) parts.push(`${numMatches} match${numMatches !== 1 ? 'es' : ''}`)
    if (truncated) parts.push(theme.dim('truncated'))

    this.contentBox.addChild(
      new Text(
        `${icon} ${chalk.bold('Grep')} ${theme.fg('accent', '/' + shortPattern + '/')} ${modeTag}  ${theme.fg('muted', parts.join(', '))}`,
      ),
    )
  }
}
