import { Container, Markdown, type MarkdownTheme, Text } from '@earendil-works/pi-tui'
import type { AssistantMessage } from '@earendil-works/pi-ai'
import { getMarkdownTheme } from '../theme.ts'
import { ThinkingBlock } from './thinkingBlock.ts'

type BlockComponent = { type: 'text'; component: Markdown } | { type: 'thinking'; component: ThinkingBlock }

/**
 * Component that renders an assistant message with Markdown formatting and thinking blocks.
 * Supports streaming updates via updateContent().
 */
export class AssistantMessageComponent extends Container {
  private blockComponents: BlockComponent[] = []
  private markdownTheme: MarkdownTheme
  private lastText = ''
  private lastThinking = ''
  private lastBlockSignature = ''

  constructor(markdownTheme: MarkdownTheme = getMarkdownTheme()) {
    super()
    this.markdownTheme = markdownTheme
  }

  updateContent(message: AssistantMessage): void {
    const blocks = message.content
    const textBlocks = blocks.filter((c) => c.type === 'text')
    const thinkingBlocks = blocks.filter((c) => c.type === 'thinking')
    const text = textBlocks.map((c) => c.text).join('')
    const thinking = thinkingBlocks.map((c) => c.thinking).join('')

    // Build a signature that captures block types and whether text blocks have content.
    // This ensures we rebuild when a text block transitions from empty to non-empty
    // (e.g. when thinking finishes and the answer starts streaming).
    const signature = blocks
      .map((b) => b.type === 'text' ? `text:${b.text.length > 0 ? '1' : '0'}` : b.type)
      .join(',')

    if (signature !== this.lastBlockSignature) {
      this.lastBlockSignature = signature
      this.clear()
      this.blockComponents = []

      for (const block of blocks) {
        if (block.type === 'text') {
          const md = new Markdown(block.text.trim() || ' ', 1, 0, this.markdownTheme)
          this.addChild(md)
          this.blockComponents.push({ type: 'text', component: md })
        } else if (block.type === 'thinking') {
          const tb = new ThinkingBlock()
          tb.update(block.thinking)
          this.addChild(tb)
          this.blockComponents.push({ type: 'thinking', component: tb })
        }
      }

      this.lastText = text
      this.lastThinking = thinking
      return
    }

    // Signature unchanged — update the last block's content for streaming
    if (text !== this.lastText || thinking !== this.lastThinking) {
      const lastBlock = blocks[blocks.length - 1]
      const lastComponent = this.blockComponents[this.blockComponents.length - 1]

      if (lastBlock && lastComponent) {
        if (lastBlock.type === 'text' && lastComponent.type === 'text' && text !== this.lastText) {
          const newMd = new Markdown(lastBlock.text.trim() || ' ', 1, 0, this.markdownTheme)
          this.removeChild(lastComponent.component)
          this.addChild(newMd)
          this.blockComponents[this.blockComponents.length - 1] = { type: 'text', component: newMd }
        } else if (lastBlock.type === 'thinking' && lastComponent.type === 'thinking' && thinking !== this.lastThinking) {
          lastComponent.component.update(lastBlock.thinking)
        }
      }

      this.lastText = text
      this.lastThinking = thinking
    }
  }

  getText(): string {
    return this.lastText
  }
}
