import { Box, Container, Markdown, Text } from '@earendil-works/pi-tui'
import { theme, getMarkdownTheme } from '../theme.ts'

/**
 * Component that renders a user message with grey background (matching pi-coding-agent).
 */
export class UserMessage extends Container {
  private contentBox: Box

  constructor(text: string) {
    super()
    this.contentBox = new Box(1, 1, (content: string) => theme.bg('userMessageBg', content))
    this.contentBox.addChild(
      new Markdown(text, 0, 0, getMarkdownTheme(), {
        color: (content: string) => theme.fg('text', content),
      }),
    )
    this.addChild(this.contentBox)
  }
}
