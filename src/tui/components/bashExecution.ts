import { Container, Loader, Spacer, Text, type TUI } from '@earendil-works/pi-tui'
import { execSync } from 'child_process'
import chalk from 'chalk'
import { theme } from '../theme.ts'

/**
 * Component for displaying bash command execution with streaming output.
 */
export class BashExecutionComponent extends Container {
  private command: string
  private outputLines: string[] = []
  private status: 'running' | 'complete' | 'cancelled' | 'error' = 'running'
  private exitCode: number | undefined = undefined
  private loader: Loader
  private contentContainer: Container
  private excludeFromContext: boolean

  constructor(command: string, ui: TUI, excludeFromContext = false) {
    super()
    this.command = command
    this.excludeFromContext = excludeFromContext

    // Use dim border for excluded-from-context commands (!! prefix)
    const colorKey = excludeFromContext ? 'dim' : 'accent'
    const borderColor = (str: string) => theme.fg(colorKey, str)

    // Add spacer
    this.addChild(new Spacer(1))

    // Command header
    const header = new Text(theme.fg(colorKey, theme.bold(`$ ${command}`)), 1, 0)
    this.addChild(header)

    // Content container (holds dynamic content)
    this.contentContainer = new Container()
    this.addChild(this.contentContainer)

    // Loader
    this.loader = new Loader(
      ui,
      (spinner) => theme.fg(colorKey, spinner),
      (text) => theme.fg('dim', text),
      'Running... (Esc to cancel)',
    )
    this.contentContainer.addChild(this.loader)
  }

  appendOutput(chunk: string): void {
    // Normalize line endings
    const clean = chunk.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

    // Append to output lines
    const newLines = clean.split('\n')
    if (this.outputLines.length > 0 && newLines.length > 0) {
      // Append first chunk to last line (incomplete line continuation)
      this.outputLines[this.outputLines.length - 1] += newLines[0]
      this.outputLines.push(...newLines.slice(1))
    } else {
      this.outputLines.push(...newLines)
    }

    this.updateDisplay()
  }

  setComplete(exitCode: number | undefined, cancelled: boolean): void {
    this.status = cancelled ? 'cancelled' : exitCode === 0 ? 'complete' : 'error'
    this.exitCode = exitCode

    // Remove loader
    this.contentContainer.clear()

    // Add exit status
    const colorKey = this.status === 'error' ? 'error' : this.status === 'cancelled' ? 'warning' : 'success'
    let statusText = ''
    if (cancelled) {
      statusText = theme.fg('warning', 'Cancelled')
    } else if (exitCode === 0) {
      statusText = theme.fg('success', `Exit code: ${exitCode}`)
    } else {
      statusText = theme.fg('error', `Exit code: ${exitCode}`)
    }
    this.contentContainer.addChild(new Text(statusText, 1, 0))

    this.updateDisplay()
  }

  private updateDisplay(): void {
    // Show output lines
    for (const line of this.outputLines) {
      if (line.trim()) {
        this.contentContainer.addChild(new Text(line, 1, 0))
      }
    }
  }
}
