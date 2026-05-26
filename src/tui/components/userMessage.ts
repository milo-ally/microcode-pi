import { Box, Container, Markdown, Text } from '@earendil-works/pi-tui'
import { theme, getMarkdownTheme } from '../theme.ts'
import type { ImageContent } from '@earendil-works/pi-ai'

/**
 * Component that renders a user message with grey background (matching pi-coding-agent).
 */
export class UserMessage extends Container {
  private contentBox: Box

  constructor(text: string, images?: ImageContent[]) {
    super()
    this.contentBox = new Box(1, 1, (content: string) => theme.bg('userMessageBg', content))
    this.contentBox.addChild(
      new Markdown(text, 0, 0, getMarkdownTheme(), {
        color: (content: string) => theme.fg('text', content),
      }),
    )
    if (images && images.length > 0) {
      for (const img of images) {
        this.contentBox.addChild(
          new Text(theme.dim(`  [Image: ${img.mimeType}]`), 1, 0),
        )
      }
    }
    this.addChild(this.contentBox)
  }
}
