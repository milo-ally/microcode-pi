import { Container, Markdown, type MarkdownTheme, Spacer, Text } from '@earendil-works/pi-tui'
import type { AssistantMessage } from '@earendil-works/pi-ai'
import { getMarkdownTheme } from '../theme.ts'

/**
 * Component that renders an assistant message with Markdown formatting.
 * Supports streaming updates via updateContent().
 */
export class AssistantMessageComponent extends Container {
  private contentContainer: Container
  private markdownTheme: MarkdownTheme
  private lastText = ''

  constructor(markdownTheme: MarkdownTheme = getMarkdownTheme()) {
    super()
    this.markdownTheme = markdownTheme
    this.contentContainer = new Container()
    this.addChild(this.contentContainer)
  }

  updateContent(message: AssistantMessage): void {
    const textParts = message.content
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
    const text = textParts.join('')

    if (text === this.lastText) return
    this.lastText = text

    this.contentContainer.clear()
    if (text.trim()) {
      this.contentContainer.addChild(new Markdown(text.trim(), 1, 0, this.markdownTheme))
    }
  }

  getText(): string {
    return this.lastText
  }
}
