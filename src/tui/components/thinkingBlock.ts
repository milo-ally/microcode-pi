import { Box, Container, Spacer, Text } from '@earendil-works/pi-tui'
import chalk from 'chalk'
import { theme } from '../theme.ts'

/**
 * Component that renders a thinking block with a subtle background.
 * Always displays the full thinking content.
 */
export class ThinkingBlock extends Container {
  private contentBox: Box
  private thinking = ''

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

  private updateDisplay(): void {
    this.contentBox.clear()

    const header = chalk.hex('#808080').bold('Thinking...')
    if (!this.thinking) {
      this.contentBox.addChild(new Text(header, 0, 0))
      return
    }

    const content = `${header}\n${chalk.hex('#666666')(this.thinking)}`
    this.contentBox.addChild(new Text(content, 0, 0))
  }
}
