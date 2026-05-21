import { Box, Container, Spacer, Text } from '@earendil-works/pi-tui'
import chalk from 'chalk'
import { theme } from '../theme.ts'

const COLLAPSE_THRESHOLD = 300

/**
 * Component that renders a thinking block with collapsible content.
 * Uses a subtle background to distinguish from regular messages.
 */
export class ThinkingBlock extends Container {
  private contentBox: Box
  private thinking = ''
  private expanded = false

  constructor() {
    super()
    this.contentBox = new Box(1, 0, (text: string) => theme.bg('thinkingBg', text))
    this.addChild(new Spacer(1))
    this.addChild(this.contentBox)
    this.updateDisplay()
  }

  update(thinking: string): void {
    if (thinking === this.thinking) return
    this.thinking = thinking
    this.updateDisplay()
  }

  setExpanded(expanded: boolean): void {
    this.expanded = expanded
    this.updateDisplay()
  }

  private updateDisplay(): void {
    this.contentBox.clear()

    const header = chalk.hex('#808080').bold('Thinking...')
    if (!this.thinking) {
      this.contentBox.addChild(new Text(header, 0, 0))
      return
    }

    const needsCollapse = this.thinking.length > COLLAPSE_THRESHOLD
    const displayText = needsCollapse && !this.expanded
      ? this.thinking.slice(0, COLLAPSE_THRESHOLD) + '...'
      : this.thinking

    const toggleHint = needsCollapse
      ? chalk.hex('#505050')(this.expanded ? ' [collapse]' : ' [expand]')
      : ''

    const content = `${header}${toggleHint}\n${chalk.hex('#666666')(displayText)}`
    this.contentBox.addChild(new Text(content, 0, 0))
  }
}
