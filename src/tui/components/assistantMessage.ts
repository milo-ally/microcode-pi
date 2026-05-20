import { Box, Container, Markdown, type MarkdownTheme, Text } from '@earendil-works/pi-tui'
import type { AssistantMessage } from '@earendil-works/pi-ai'
import { getMarkdownTheme } from '../theme.ts'

/**
 * Component that renders an assistant message with Markdown formatting.
 * Supports streaming updates via updateContent().
 */
export class AssistantMessageComponent extends Container {
  private contentBox: Box
  private markdownTheme: MarkdownTheme
  private lastText = ''

  constructor(markdownTheme: MarkdownTheme = getMarkdownTheme()) {
    super()
    this.markdownTheme = markdownTheme
    this.contentBox = new Box(1, 0)
    this.addChild(this.contentBox)
  }

  updateContent(message: AssistantMessage): void {
    const textParts = message.content
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
    const text = textParts.join('')

    if (text === this.lastText) return
    this.lastText = text

    this.contentBox.clear()
    if (text.trim()) {
      this.contentBox.addChild(new Markdown(text, 0, 0, this.markdownTheme))
    }
  }

  getText(): string {
    return this.lastText
  }
}
