import type { Agent, AgentEvent, AgentMessage } from '@earendil-works/pi-agent-core'
import { generateSummary, DEFAULT_COMPACTION_SETTINGS } from '@earendil-works/pi-agent-core'
import type { AssistantMessage } from '@earendil-works/pi-ai'
import {
  TUI,
  ProcessTerminal,
  Container,
  Text,
  Spacer,
  Loader,
  type Component,
  type AutocompleteProvider,
  type SlashCommand,
} from '@earendil-works/pi-tui'
import chalk from 'chalk'
import { resolveConfig, createModelForId, type ResolvedConfig } from '../config.ts'
import { getSystemPrompt } from '../constants/prompts.ts'
import { theme, getEditorTheme, getMarkdownTheme } from './theme.ts'
import { MicrocodeEditor } from './components/microcodeEditor.ts'
import { FooterComponent } from './components/footer.ts'
import { AssistantMessageComponent } from './components/assistantMessage.ts'
import { ToolExecutionComponent } from './components/toolExecution.ts'
import { FileEditToolUI } from '../tools/FileEditTool/UI.tsx'
import { FileWriteToolUI } from '../tools/FileWriteTool/UI.tsx'
import { FileReadToolUI } from '../tools/FileReadTool/UI.tsx'
import { UserMessage } from './components/userMessage.ts'
import type { McpClientManager } from '../mcp/client.ts'
import type { McpServerState } from '../mcp/types.ts'
import { SessionManager } from '../session/SessionManager.ts'
import { getCompactionManager } from '../agent.ts'

declare const MACRO: {
  VERSION: string
}

const APP_NAME = 'Microcode'

const BUILTIN_SLASH_COMMANDS: SlashCommand[] = [
  { name: 'clear', description: 'Clear the conversation history' },
  { name: 'compact', description: 'Compress conversation context (usage: /compact [instructions])', argumentHint: '[instructions]' },
  { name: 'model', description: 'Show or switch model (usage: /model [model-id])', argumentHint: '[model-id]' },
  { name: 'mcp', description: 'Show MCP server status and tools (usage: /mcp [enable|disable|reconnect] [server-name])', argumentHint: '[action] [server]' },
  { name: 'session', description: 'Show session info or list sessions', argumentHint: '[list]' },
  { name: 'exit', description: 'Exit Microcode' },
  { name: 'help', description: 'Show help and available commands' },
]

export class App {
  private ui: TUI
  private headerContainer: Container
  private chatContainer: Container
  private statusContainer: Container
  private editorContainer: Container
  private agent: Agent
  private editor!: MicrocodeEditor
  private footer: FooterComponent
  private isInitialized = false
  private streamingComponent?: AssistantMessageComponent
  private streamingMessage?: AssistantMessage
  private pendingTools = new Map<string, ToolExecutionComponent | FileEditToolUI | FileWriteToolUI | FileReadToolUI>()
  private loadingAnimation?: Loader
  private lastSigintTime = 0
  private config: ResolvedConfig
  private mcpClient?: McpClientManager
  private sessionManager: SessionManager
  private compacting = false
  onExit?: () => void | Promise<void>

  constructor(agent: Agent, mcpClient?: McpClientManager, sessionManager?: SessionManager) {
    this.agent = agent
    this.mcpClient = mcpClient
    this.sessionManager = sessionManager ?? new SessionManager()
    this.config = resolveConfig()
    this.ui = new TUI(new ProcessTerminal())
    this.headerContainer = new Container()
    this.chatContainer = new Container()
    this.statusContainer = new Container()
    this.editorContainer = new Container()
    this.footer = new FooterComponent(
      agent,
      this.config.model.id,
      this.config.provider,
      process.cwd(),
    )

    // Initialize system prompt token count for context usage display
    const compactionManager = getCompactionManager(agent)
    if (compactionManager && agent.state.systemPrompt) {
      compactionManager.setSystemPrompt(agent.state.systemPrompt)
    }
  }

  getSessionManager(): SessionManager {
    return this.sessionManager
  }

  async run(): Promise<void> {
    this.init()
    this.setupAgentSubscription()

    // Main interactive loop
    while (true) {
      const userInput = await this.getUserInput()
      if (!userInput.trim()) continue

      // Handle slash commands locally
      if (userInput.startsWith('/')) {
        const handled = this.handleSlashCommand(userInput.trim())
        if (handled) continue
      }

      // Add user message to chat (with grey background)
      this.chatContainer.addChild(new UserMessage(userInput))
      this.chatContainer.addChild(new Spacer(1))
      this.ui.requestRender()

      try {
        await this.agent.prompt(userInput)
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
        this.chatContainer.addChild(
          new Text(chalk.hex('#cc6666')(`Error: ${errorMessage}`), 1, 0),
        )
        this.chatContainer.addChild(new Spacer(1))
        this.ui.requestRender()
      }
    }
  }

  private init(): void {
    if (this.isInitialized) return

    // Header: logo + compact keybinding hints (matching pi-coding-agent style)
    const logo = theme.bold(theme.fg('accent', APP_NAME)) + theme.dim(` v${MACRO.VERSION}`)
    const compactInstructions = [
      theme.dim('escape') + theme.dim(' interrupt'),
      theme.dim('ctrl+c/ctrl+d') + theme.dim(' exit'),
      theme.dim('/') + theme.dim(' commands'),
    ].join(theme.dim(' · '))
    const onboarding = theme.dim(
      `${APP_NAME} can explain its own features and help you write, edit, and understand code. Ask it anything.`,
    )

    this.headerContainer.addChild(new Spacer(1))
    this.headerContainer.addChild(new Text(`${logo}  ${compactInstructions}`, 1, 0))
    this.headerContainer.addChild(new Text(onboarding, 1, 0))
    this.headerContainer.addChild(new Spacer(1))

    // Editor with border
    this.editor = new MicrocodeEditor(this.ui, getEditorTheme(), { paddingX: 1 })

    // Set up slash command autocomplete
    this.setupSlashCommands()

    this.editor.onSubmit = (text: string) => {
      this.handleEditorSubmit(text)
    }

    // App-level key handlers on the Editor (pi-coding-agent pattern)
    this.editor.onEscape = () => {
      const now = Date.now()
      if (now - this.lastSigintTime < 500) {
        this.exit()
      }
      this.lastSigintTime = now
      this.editor.setText('')
    }
    this.editor.onCtrlC = () => {
      if (this.isAgentBusy()) {
        this.agent.abort()
      } else {
        this.exit()
      }
    }
    this.editor.onCtrlD = () => {
      this.exit()
    }

    this.editorContainer.addChild(this.editor)

    // Assemble UI layout (matching pi-coding-agent order)
    this.ui.addChild(this.headerContainer)
    this.ui.addChild(this.chatContainer)
    this.ui.addChild(this.statusContainer)
    this.ui.addChild(this.editorContainer)
    this.ui.addChild(this.footer)

    this.ui.setFocus(this.editor)
    this.ui.start()
    this.isInitialized = true
  }

  private setupSlashCommands(): void {
    const provider: AutocompleteProvider = {
      getSuggestions: async (
        lines: string[],
        cursorLine: number,
        cursorCol: number,
        _options: { signal: AbortSignal; force?: boolean },
      ) => {
        const currentLine = lines[cursorLine] ?? ''
        const textBeforeCursor = currentLine.slice(0, cursorCol)

        if (!textBeforeCursor.startsWith('/')) return null

        const query = textBeforeCursor.slice(1).toLowerCase()
        const matches = BUILTIN_SLASH_COMMANDS.filter((cmd) => cmd.name.startsWith(query))

        if (matches.length === 0) return null

        return {
          items: matches.map((cmd) => ({
            value: `/${cmd.name}`,
            label: `/${cmd.name}${cmd.argumentHint ? ` ${cmd.argumentHint}` : ''}`,
            description: cmd.description ?? '',
          })),
          prefix: textBeforeCursor,
        }
      },

      applyCompletion: (
        lines: string[],
        cursorLine: number,
        _cursorCol: number,
        item: { value: string; label: string; description?: string },
        _prefix: string,
      ) => {
        const newLines = [...lines]
        newLines[cursorLine] = item.value + ' '
        return {
          lines: newLines,
          cursorLine,
          cursorCol: item.value.length + 1,
        }
      },
    }

    this.editor.setAutocompleteProvider(provider)
  }

  private handleSlashCommand(input: string): boolean {
    this.editor.addToHistory(input)
    const parts = input.split(/\s+/)
    const command = parts[0]?.toLowerCase()
    const args = parts.slice(1).join(' ')

    switch (command) {
      case '/clear':
        this.chatContainer.clear()
        this.showStatus('Conversation cleared.')
        return true

      case '/compact':
        this.handleCompactCommand(args)
        return true

      case '/model':
        this.handleModelCommand(args || undefined)
        return true

      case '/mcp':
        this.handleMcpCommand(args)
        return true

      case '/session':
        this.handleSessionCommand(args)
        return true

      case '/exit':
        this.exit()
        return true

      case '/help':
        this.showHelp()
        return true

      default:
        this.showError(`Unknown command: ${command}. Type /help for available commands.`)
        return true
    }
  }

  private async handleCompactCommand(args: string): Promise<void> {
    if (this.compacting) {
      this.showError('Compaction already in progress.')
      return
    }

    const customInstructions = args.trim() || undefined
    this.compacting = true

    const progressText = new Text(
      theme.fg('accent', '⟳ Compacting conversation context...'),
      1,
      0,
    )
    this.chatContainer.addChild(progressText)
    this.ui.requestRender()

    try {
      const session = this.sessionManager.getSession()
      if (!session) throw new Error('No active session')

      // Get session branch entries
      const entries = await session.getBranch() as any[]

      // Find the first actual message entry (skip session header, etc.)
      const firstMsgEntry = entries.find(e => e.type === 'message')
      if (!firstMsgEntry) throw new Error('No messages to compact')

      // Extract messages to summarize (skip compaction entries, keep messages)
      const messagesToSummarize: AgentMessage[] = []
      for (const entry of entries) {
        if (entry.type === 'message') {
          const msg = entry.message
          if (msg.role !== 'compactionSummary') {
            messagesToSummarize.push(msg)
          }
        }
      }
      if (messagesToSummarize.length === 0) throw new Error('No messages to compact')

      // Calculate tokens before compaction
      const tokensBefore = messagesToSummarize.reduce((sum, m) => {
        const content = typeof m.content === 'string' ? m.content
          : Array.isArray(m.content) ? m.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('')
          : ''
        return sum + Math.ceil(content.length / 4)
      }, 0)

      // Generate summary via LLM
      const summaryResult = await generateSummary(
        messagesToSummarize,
        this.agent.state.model,
        DEFAULT_COMPACTION_SETTINGS.reserveTokens,
        this.config.apiKey,
        undefined,
        undefined,
        customInstructions,
      )
      if (!summaryResult.ok) {
        throw new Error(`Summarization failed: ${summaryResult.error.message}`)
      }
      const summary = summaryResult.value
      if (!summary || summary.trim().length === 0) {
        throw new Error('Summarization returned empty summary')
      }

      // Record compaction in session tree with correct firstKeptEntryId
      // Keep recent messages — find the entry that starts the recent window
      const msgEntries = entries.filter((e: any) => e.type === 'message')
      const keepMsgCount = Math.max(1, Math.floor(msgEntries.length * 0.3))
      const firstKeptMsgEntry = msgEntries[msgEntries.length - keepMsgCount] ?? firstMsgEntry
      const firstKeptEntryId = firstKeptMsgEntry.id
      await session.appendCompaction(summary, firstKeptEntryId, tokensBefore)

      // Build new agent messages: compaction summary + recent messages only
      const summaryText = `The conversation history before this point was compacted into the following summary:\n\n<summary>\n${summary}\n</summary>`
      const summaryMsg: AgentMessage = {
        role: 'user',
        content: [{ type: 'text', text: summaryText }],
        timestamp: Date.now(),
      }
      const recentMessages = msgEntries.slice(-keepMsgCount).map((e: any) => e.message as AgentMessage)
      const newMessages: AgentMessage[] = [summaryMsg, ...recentMessages]

      // Update agent messages in-place
      const agentMsgs = this.agent.state.messages as AgentMessage[]
      agentMsgs.length = 0
      for (const msg of newMessages) {
        agentMsgs.push(msg)
      }

      // Set saved count to new length so next saveMessages only writes genuinely new messages
      this.sessionManager.setSavedMessageCount(newMessages.length)

      // Update footer
      this.updateContextUsage()
      this.footer.invalidate()
      const compactionManager = getCompactionManager(this.agent)
      if (compactionManager) {
        const usage = compactionManager.getContextUsage(agentMsgs)
        progressText.setText(
          theme.dim(`Compacted. Context: ${usage.percentUsed}% used (${Math.round(usage.tokens / 1000)}k/${Math.round(usage.contextWindow / 1000)}k)`),
        )
      } else {
        progressText.setText(theme.dim('Compacted.'))
      }
      this.chatContainer.addChild(new Spacer(1))
    } catch (error) {
      progressText.setText(
        chalk.hex('#cc6666')(`Compaction failed: ${error instanceof Error ? error.message : String(error)}`),
      )
      this.chatContainer.addChild(new Spacer(1))
    } finally {
      this.compacting = false
      this.ui.requestRender()
    }
  }

  private async handleSessionCommand(args: string): Promise<void> {
    const parts = args.trim().split(/\s+/)
    const action = parts[0]?.toLowerCase()

    if (action === 'list' || !action) {
      const sessions = await this.sessionManager.list()
      if (sessions.length === 0) {
        this.chatContainer.addChild(
          new Text(theme.dim('No saved sessions found.'), 1, 0),
        )
      } else {
        this.chatContainer.addChild(
          new Text(theme.fg('accent', 'Recent sessions:'), 1, 0),
        )
        this.chatContainer.addChild(new Spacer(1))
        for (const session of sessions.slice(0, 10)) {
          const date = new Date(session.createdAt).toLocaleString()
          const cwd = session.cwd
          const isCurrent = session.id === this.sessionManager.getSessionId()
          const prefix = isCurrent ? theme.fg('accent', ' → ') : '   '
          this.chatContainer.addChild(
            new Text(`${prefix}${theme.bold(session.id.slice(0, 8))} ${theme.dim(date)} ${theme.dim(cwd)}`, 1, 0),
          )
        }
      }
      this.chatContainer.addChild(new Spacer(1))
      this.ui.requestRender()
      return
    }

    this.showError('Usage: /session [list]')
  }

  private handleModelCommand(searchTerm?: string): void {
    if (!searchTerm) {
      // Show current model info
      this.chatContainer.addChild(
        new Text(`${theme.fg('accent', 'Current model:')} ${this.config.model.id}`, 1, 0),
      )
      this.chatContainer.addChild(
        new Text(`${theme.fg('accent', 'Provider:')} ${this.config.provider}`, 1, 0),
      )
      this.chatContainer.addChild(
        new Text(theme.dim('Usage: /model <model-id> to switch models'), 1, 0),
      )
      this.chatContainer.addChild(
        new Text(theme.dim('Example: /model claude-sonnet-4-20250514'), 1, 0),
      )
      this.chatContainer.addChild(new Spacer(1))
      this.ui.requestRender()
      return
    }

    // Try to switch model
    try {
      const { model, apiKey, provider } = createModelForId(searchTerm)
      this.agent.state.model = model
      this.config = { model, apiKey, provider: provider as ResolvedConfig['provider'] }

      // Update compaction manager with new model and API key
      const compactionManager = getCompactionManager(this.agent)
      if (compactionManager) {
        compactionManager.setModel(model)
        compactionManager.setApiKey(apiKey)
      }

      // Rebuild system prompt with new model ID (preserve MCP info)
      this.rebuildSystemPrompt(this.mcpClient?.getServerStates())

      // Rebuild footer with new model info
      this.rebuildFooter()

      this.showStatus(`Model switched to: ${model.id}`)
    } catch (error) {
      this.showError(error instanceof Error ? error.message : String(error))
    }
  }

  private handleMcpCommand(args: string): void {
    if (!this.mcpClient) {
      this.showError('No MCP client available.')
      return
    }

    const parts = args.trim().split(/\s+/)
    const action = parts[0]?.toLowerCase()
    const serverName = parts[1]

    // /mcp with no args — show status
    if (!action) {
      const states = this.mcpClient.getServerStates()
      if (states.length === 0) {
        this.chatContainer.addChild(
          new Text(theme.dim('No MCP servers configured.'), 1, 0),
        )
        this.chatContainer.addChild(
          new Text(theme.dim('Add servers to ~/.microcode/mcp.json or .microcode/mcp.json'), 1, 0),
        )
        this.chatContainer.addChild(new Spacer(1))
        this.ui.requestRender()
        return
      }

      this.chatContainer.addChild(
        new Text(theme.fg('accent', 'MCP Servers:'), 1, 0),
      )
      this.chatContainer.addChild(new Spacer(1))

      for (const state of states) {
        const statusIcon = state.status === 'connected' ? '✓'
          : state.status === 'failed' ? '✗'
          : state.status === 'disabled' ? '○'
          : '◌'
        const statusColor = state.status === 'connected' ? 'green'
          : state.status === 'failed' ? 'red'
          : 'gray'

        const statusLine = `${statusIcon} ${theme.bold(state.name)} ${theme.dim(`(${state.status})`)}`
        this.chatContainer.addChild(new Text(statusLine, 1, 0))

        if (state.status === 'connected' && state.tools.length > 0) {
          const toolNames = state.tools.map(t => t.name).join(', ')
          this.chatContainer.addChild(
            new Text(`  ${theme.dim('Tools:')} ${toolNames}`, 1, 0),
          )
        }

        if (state.status === 'connected' && state.resources.length > 0) {
          const resourceNames = state.resources.map(r => r.name).join(', ')
          this.chatContainer.addChild(
            new Text(`  ${theme.dim('Resources:')} ${resourceNames}`, 1, 0),
          )
        }

        if (state.status === 'failed' && state.error) {
          this.chatContainer.addChild(
            new Text(`  ${chalk.hex('#cc6666')(state.error)}`, 1, 0),
          )
        }
      }

      this.chatContainer.addChild(new Spacer(1))
      this.chatContainer.addChild(
        new Text(theme.dim('Usage: /mcp [enable|disable|reconnect] <server-name>'), 1, 0),
      )
      this.chatContainer.addChild(new Spacer(1))
      this.ui.requestRender()
      return
    }

    // /mcp enable <name>
    if (action === 'enable') {
      if (!serverName) {
        this.showError('Usage: /mcp enable <server-name>')
        return
      }
      const result = this.mcpClient.setServerEnabled(serverName, true)
      if (result) {
        this.showStatus(`Enabling MCP server: ${serverName}...`)
      } else {
        this.showError(`MCP server "${serverName}" not found or already connected.`)
      }
      return
    }

    // /mcp disable <name>
    if (action === 'disable') {
      if (!serverName) {
        this.showError('Usage: /mcp disable <server-name>')
        return
      }
      const result = this.mcpClient.setServerEnabled(serverName, false)
      if (result) {
        this.showStatus(`Disabled MCP server: ${serverName}`)
      } else {
        this.showError(`MCP server "${serverName}" not found.`)
      }
      return
    }

    // /mcp reconnect <name>
    if (action === 'reconnect') {
      if (!serverName) {
        this.showError('Usage: /mcp reconnect <server-name>')
        return
      }
      this.showStatus(`Reconnecting MCP server: ${serverName}...`)
      this.mcpClient.reconnectServer(serverName).then((success) => {
        if (success) {
          this.showStatus(`Reconnected MCP server: ${serverName}`)
        } else {
          this.showError(`Failed to reconnect MCP server: ${serverName}`)
        }
      })
      return
    }

    this.showError(`Unknown /mcp action: ${action}. Usage: /mcp [enable|disable|reconnect] <server-name>`)
  }

  private rebuildFooter(): void {
    const oldFooter = this.footer
    this.footer = new FooterComponent(this.agent, this.config.model.id, this.config.provider, process.cwd())
    this.ui.removeChild(oldFooter)
    this.ui.addChild(this.footer)
    // Restore context usage on the new footer
    this.updateContextUsage()
    this.ui.requestRender()
  }

  private rebuildSystemPrompt(mcpServers?: McpServerState[]): void {
    const sections = getSystemPrompt({
      cwd: process.cwd(),
      modelId: this.config.model.id,
      mcpServers,
    })
    this.agent.state.systemPrompt = sections.join('\n\n')

    // Update compaction manager with system prompt token count
    const compactionManager = getCompactionManager(this.agent)
    if (compactionManager) {
      compactionManager.setSystemPrompt(this.agent.state.systemPrompt)
    }
  }

  updateMcpState(mcpClient: McpClientManager): void {
    this.mcpClient = mcpClient
    this.rebuildSystemPrompt(mcpClient.getServerStates())
  }

  showMcpReady(states: McpServerState[]): void {
    const connected = states.filter(s => s.status === 'connected')
    const failed = states.filter(s => s.status === 'failed')

    const parts: string[] = []
    if (connected.length > 0) {
      parts.push(`${connected.length} server(s) connected`)
    }
    if (failed.length > 0) {
      parts.push(`${failed.length} failed`)
    }

    this.chatContainer.addChild(
      new Text(theme.dim(`MCP ready: ${parts.join(', ')}`), 1, 0),
    )
    this.chatContainer.addChild(new Spacer(1))
    this.ui.requestRender()
  }

  private showHelp(): void {
    const helpText = [
      `${theme.fg('accent', 'Available Commands:')}`,
      '',
      `  ${theme.bold('/clear')}              Clear the conversation history`,
      `  ${theme.bold('/compact')} [instr.]    Compress conversation context`,
      `  ${theme.bold('/model')} [model-id]   Show current model or switch to a different model`,
      `  ${theme.bold('/mcp')}                Show MCP server status and tools`,
      `  ${theme.bold('/session')} [list]     Show session info or list saved sessions`,
      `  ${theme.bold('/exit')}               Exit Microcode`,
      `  ${theme.bold('/help')}               Show this help message`,
      '',
      `${theme.fg('accent', 'Keyboard Shortcuts:')}`,
      '',
      `  ${theme.bold('Escape')}              Interrupt current operation`,
      `  ${theme.bold('Ctrl+C')}              Interrupt (when busy) / Exit`,
      `  ${theme.bold('Ctrl+D')}              Exit (when input is empty)`,
      `  ${theme.bold('Enter')}               Submit message`,
      `  ${theme.bold('Shift+Enter')}         New line in editor`,
      `  ${theme.bold('Up/Down')}             Browse command history`,
      `  ${theme.bold('Tab')}                 Accept autocomplete suggestion`,
      '',
      `${theme.fg('accent', 'Environment Variables:')}`,
      '',
      `  ANTHROPIC_API_KEY     Anthropic API key`,
      `  ANTHROPIC_BASE_URL    Anthropic API base URL`,
      `  ANTHROPIC_MODEL       Anthropic model ID`,
      `  OPENAI_API_KEY        OpenAI API key`,
      `  OPENAI_BASE_URL       OpenAI API base URL`,
      `  OPENAI_MODEL          OpenAI model ID`,
      `  API_KEY               Fallback API key`,
      `  BASE_URL              Fallback base URL`,
      `  MODEL                 Fallback model ID`,
    ]

    for (const line of helpText) {
      this.chatContainer.addChild(new Text(line, 1, 0))
    }
    this.chatContainer.addChild(new Spacer(1))
    this.ui.requestRender()
  }

  private showStatus(message: string): void {
    this.chatContainer.addChild(new Spacer(1))
    this.chatContainer.addChild(new Text(theme.dim(message), 1, 0))
    this.chatContainer.addChild(new Spacer(1))
    this.ui.requestRender()
  }

  private showError(message: string): void {
    this.chatContainer.addChild(
      new Text(chalk.hex('#cc6666')(`Error: ${message}`), 1, 0),
    )
    this.chatContainer.addChild(new Spacer(1))
    this.ui.requestRender()
  }

  private handleEditorSubmit(text: string): void {
    this.editor.addToHistory(text)
    this._pendingInput = text
    this._inputResolve?.()
  }

  private _pendingInput?: string
  private _inputResolve?: () => void

  async getUserInput(): Promise<string> {
    return new Promise<string>((resolve) => {
      this._inputResolve = () => {
        const text = this._pendingInput ?? ''
        this._pendingInput = undefined
        this._inputResolve = undefined
        resolve(text)
      }

      if (this._pendingInput !== undefined) {
        this._inputResolve()
      }
    })
  }

  private setupAgentSubscription(): void {
    this.agent.subscribe((event: AgentEvent) => {
      switch (event.type) {
        case 'agent_start':
          this.showWorking()
          break

        case 'message_start':
          if (event.message.role === 'assistant') {
            this.streamingComponent = new AssistantMessageComponent(getMarkdownTheme())
            this.streamingMessage = event.message
            this.chatContainer.addChild(this.streamingComponent)
            this.streamingComponent.updateContent(this.streamingMessage)
            this.ui.requestRender()
          }
          break

        case 'message_update':
          if (this.streamingComponent && event.message.role === 'assistant') {
            this.streamingMessage = event.message
            this.streamingComponent.updateContent(this.streamingMessage)
            this.ui.requestRender()
          }
          break

        case 'message_end':
          if (event.message.role === 'assistant') {
            if (this.streamingComponent && this.streamingMessage) {
              this.streamingComponent.updateContent(this.streamingMessage)
              this.streamingComponent = undefined
              this.streamingMessage = undefined
            }
            this.updateContextUsage()
            this.footer.invalidate()
          }
          this.ui.requestRender()
          break

        case 'tool_execution_start': {
          let component: ToolExecutionComponent | FileEditToolUI | FileWriteToolUI | FileReadToolUI
          switch (event.toolName) {
            case 'edit':
              component = new FileEditToolUI(event.toolCallId, event.args)
              break
            case 'write':
              component = new FileWriteToolUI(event.toolCallId, event.args)
              break
            case 'read':
              component = new FileReadToolUI(event.toolCallId, event.args)
              break
            default:
              component = new ToolExecutionComponent(event.toolName, event.toolCallId, event.args)
          }
          component.setExpanded(false)
          component.markExecutionStarted()
          this.chatContainer.addChild(component)
          this.pendingTools.set(event.toolCallId, component)
          this.ui.requestRender()
          break
        }

        case 'tool_execution_update': {
          const component = this.pendingTools.get(event.toolCallId)
          if (component) {
            component.updateResult(
              { ...event.partialResult, isError: false },
              true,
            )
            this.ui.requestRender()
          }
          break
        }

        case 'tool_execution_end': {
          const component = this.pendingTools.get(event.toolCallId)
          if (component) {
            component.updateResult({
              ...event.result,
              isError: event.isError,
            })
            // Pass details to per-tool UI for diff rendering
            if (
              (component instanceof FileEditToolUI ||
                component instanceof FileWriteToolUI ||
                component instanceof FileReadToolUI) &&
              event.result.details
            ) {
              component.updateDetails(event.result.details)
            }
            this.pendingTools.delete(event.toolCallId)
            this.updateContextUsage()
            this.footer.invalidate()
            this.ui.requestRender()
          }
          break
        }

        case 'turn_end':
          this.hideWorking()
          if (event.message.role === 'assistant' && event.message.stopReason === 'aborted') {
            this.chatContainer.addChild(
              new Text(chalk.hex('#cc6666').bold('\nInterrupted\n'), 1, 0),
            )
          }
          this.chatContainer.addChild(new Spacer(1))
          // Save messages to session after each turn
          void this.sessionManager.saveMessages(this.agent.state.messages as AgentMessage[])
          this.updateContextUsage()
          this.footer.invalidate()
          this.ui.requestRender()
          break

        case 'agent_end':
          this.hideWorking()
          this.ui.requestRender()
          break
      }
    })
  }

  private updateContextUsage(): void {
    const compactionManager = getCompactionManager(this.agent)
    if (!compactionManager) return

    const messages = this.agent.state.messages as AgentMessage[]
    const usage = compactionManager.getContextUsage(messages)
    this.footer.setContextUsage(usage.percentUsed, usage.tokens, usage.contextWindow)
  }

  private showWorking(): void {
    if (!this.loadingAnimation) {
      this.loadingAnimation = new Loader(
        this.ui,
        (text: string) => chalk.hex('#00d7ff')(text),
        (text: string) => chalk.hex('#666666')(text),
        'Working...',
      )
      this.loadingAnimation.start()
      this.statusContainer.clear()
      this.statusContainer.addChild(this.loadingAnimation)
      this.ui.requestRender()
    }
  }

  private hideWorking(): void {
    if (this.loadingAnimation) {
      this.loadingAnimation.stop()
      this.statusContainer.clear()
      this.loadingAnimation = undefined
      this.ui.requestRender()
    }
  }

  stop(): void {
    this.ui.stop()
  }

  private isAgentBusy(): boolean {
    return this.agent.state.isStreaming || this.agent.state.pendingToolCalls.size > 0
  }

  private exit(): void {
    this.stop()
    if (this.onExit) {
      this.onExit()
    } else {
      process.exit(0)
    }
  }
}
