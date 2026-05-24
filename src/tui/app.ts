import type { Agent, AgentEvent, AgentMessage, ThinkingLevel } from '@earendil-works/pi-agent-core'
import { generateSummary, DEFAULT_COMPACTION_SETTINGS } from '@earendil-works/pi-agent-core'
import type { Api, AssistantMessage } from '@earendil-works/pi-ai'
import {
  TUI,
  ProcessTerminal,
  Container,
  Text,
  Spacer,
  Loader,
  SelectList,
  type SelectItem,
  type Component,
  type AutocompleteProvider,
  type SlashCommand,
} from '@earendil-works/pi-tui'
import chalk from 'chalk'
import { resolveConfig, createModelForId, type ResolvedConfig } from '../config.ts'
import { getAllModels } from '../models/index.ts'
import { getSystemPrompt } from '../constants/prompts.ts'
import { theme, getEditorTheme, getMarkdownTheme, getBashModeBorderColor } from './theme.ts'
import { MicrocodeEditor } from './components/microcodeEditor.ts'
import { FooterComponent } from './components/footer.ts'
import { AssistantMessageComponent } from './components/assistantMessage.ts'
import { ToolExecutionComponent } from './components/toolExecution.ts'
import { BashExecutionComponent } from './components/bashExecution.ts'
import { getToolUIConstructor, type ToolUIComponent } from '../tools/registry.ts'
import { UserMessage } from './components/userMessage.ts'
import type { McpClientManager } from '../mcp/client.ts'
import type { McpServerState, McpServerConfig } from '../mcp/types.ts'
import { TOOL_NAME as BASH_TOOL_NAME } from '../tools/BashTool/BashTool.ts'
import { TOOL_NAME as READ_TOOL_NAME } from '../tools/FileReadTool/FileReadTool.ts'
import { TOOL_NAME as WRITE_TOOL_NAME } from '../tools/FileWriteTool/FileWriteTool.ts'
import { TOOL_NAME as EDIT_TOOL_NAME } from '../tools/FileEditTool/FileEditTool.ts'
import { addMcpServer, removeMcpServer, type ConfigScope } from '../mcp/configWrite.ts'
import { SessionManager } from '../session/SessionManager.ts'
import { getCompactionManager, getSkills, getSkillDiagnostics } from '../agent.ts'
import { createMcpTools, createListMcpResourcesTool, createReadMcpResourceTool, registerMcpToolsAsDeferred, getDeferredToolNames } from '../tools/index.ts'
import { PermissionManager, type PermissionMode, PERMISSION_MODES } from '../permissions/index.ts'

declare const MACRO: {
  VERSION: string
}

const APP_NAME = 'Microcode'

const BUILTIN_SLASH_COMMANDS: SlashCommand[] = [
  { name: 'clear', description: 'Clear the conversation history' },
  { name: 'compact', description: 'Compress conversation context (usage: /compact [instructions])', argumentHint: '[instructions]' },
  { name: 'model', description: 'Show or switch model (usage: /model [model-id])', argumentHint: '[model-id]' },
  { name: 'thinking', description: 'Show or set thinking depth (usage: /thinking [level])', argumentHint: '[off|minimal|low|medium|high|xhigh]' },
  { name: 'mcp', description: 'Manage MCP servers (usage: /mcp [add|remove|enable|disable|reconnect] [args...])', argumentHint: '[action] [args...]' },
  { name: 'session', description: 'Show session info or list sessions', argumentHint: '[list]' },
  { name: 'permission', description: 'Show or switch permission mode (usage: /permission [mode])', argumentHint: '[mode]' },
  { name: 'skills', description: 'Show available skills' },
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
  private pendingTools = new Map<string, ToolUIComponent>()
  private toolExecutionInProgress = false // Track if any tool is currently executing
  private loadingAnimation?: Loader
  private lastSigintTime = 0
  private config: ResolvedConfig
  private mcpClient?: McpClientManager
  private sessionManager: SessionManager
  private compacting = false
  private permissionPromptActive = false
  private permissionManager: PermissionManager
  private isBashMode = false
  private bashComponent?: BashExecutionComponent
  private startupWarnings: string[] = []
  onExit?: () => void | Promise<void>

  constructor(agent: Agent, mcpClient?: McpClientManager, sessionManager?: SessionManager, permissionManager?: PermissionManager, modelId?: string, thinkingLevel?: ThinkingLevel) {
    this.agent = agent
    this.mcpClient = mcpClient
    this.sessionManager = sessionManager ?? new SessionManager()
    this.permissionManager = permissionManager ?? new PermissionManager()
    this.config = modelId ? createModelForId(modelId) : resolveConfig()
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
      thinkingLevel ?? agent.state.thinkingLevel,
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

  /** Queue a warning to be shown in the chat area after TUI initializes. */
  addStartupWarning(message: string): void {
    this.startupWarnings.push(message)
  }

  async run(): Promise<void> {
    this.init()
    this.setupAgentSubscription()

    // Show any queued startup warnings
    for (const msg of this.startupWarnings) {
      this.chatContainer.addChild(new Text(chalk.hex('#ffff00')(`⚠ ${msg}`), 1, 0))
      this.chatContainer.addChild(new Spacer(1))
    }
    if (this.startupWarnings.length > 0) {
      this.ui.requestRender()
    }

    // Main interactive loop
    while (true) {
      const userInput = await this.getUserInput()
      if (!userInput.trim()) continue

      // Handle bash commands (! for normal, !! for excluded from context)
      if (userInput.startsWith('!')) {
        const isExcluded = userInput.startsWith('!!')
        const command = isExcluded ? userInput.slice(2).trim() : userInput.slice(1).trim()
        if (command) {
          await this.handleBashCommand(command, isExcluded)
          this.isBashMode = false
          continue
        }
      }

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
      theme.dim('!') + theme.dim(' shell'),
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

    // Detect bash mode (! prefix)
    this.editor.onChange = (text: string) => {
      const wasBashMode = this.isBashMode
      this.isBashMode = text.trimStart().startsWith('!')
      if (wasBashMode !== this.isBashMode) {
        this.updateEditorBorderColor()
      }
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
      if (this.permissionPromptActive) {
        this.exit()
      } else if (this.isAgentBusy()) {
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

  private async handleBashCommand(command: string, excludeFromContext = false): Promise<void> {
    // Create UI component for display
    this.bashComponent = new BashExecutionComponent(command, this.ui, excludeFromContext)
    this.chatContainer.addChild(this.bashComponent)
    this.ui.requestRender()

    try {
      const { exec } = await import('child_process')
      exec(command, { cwd: process.cwd() }, (error, stdout, stderr) => {
        const output = stdout + stderr
        if (output) {
          this.bashComponent?.appendOutput(output)
        }
        const exitCode = error ? error.code ?? 1 : 0
        this.bashComponent?.setComplete(exitCode, false)
        this.bashComponent = undefined
        this.updateEditorBorderColor()
        this.ui.requestRender()
      })
    } catch (error) {
      if (this.bashComponent) {
        this.bashComponent.setComplete(undefined, false)
      }
      this.showError(`Bash command failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
      this.bashComponent = undefined
      this.updateEditorBorderColor()
    }
  }

  private updateEditorBorderColor(): void {
    if (this.isBashMode) {
      this.editor.borderColor = getBashModeBorderColor()
    } else {
      this.editor.borderColor = (text: string) => theme.fg('blue', text)
    }
    this.ui.requestRender()
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

      case '/permission':
        this.handlePermissionCommand(args)
        return true

      case '/thinking':
        this.handleThinkingCommand(args)
        return true

      case '/skills':
        this.handleSkillsCommand()
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
    if (searchTerm?.trim()) {
      // Direct switch by model ID (e.g. /model deepseek-v4-pro)
      this.switchModel(searchTerm.trim())
      return
    }

    // Show selectable model list
    const models = getAllModels()
    const currentId = this.config.model.id
    const currentApi = this.config.model.api

    // Detect duplicate IDs to show protocol info
    const idCounts = new Map<string, number>()
    for (const m of models) {
      idCounts.set(m.id, (idCounts.get(m.id) ?? 0) + 1)
    }

    const items: SelectItem[] = models.map((m) => {
      const hasDuplicate = (idCounts.get(m.id) ?? 0) > 1
      const protocolLabel = hasDuplicate ? ` [${m.api}]` : ''
      const isCurrent = m.id === currentId && m.api === currentApi
      return {
        value: `${m.id}|${m.api}`,
        label: `${m.name ?? m.id}${protocolLabel}`,
        description: `${m.provider}${isCurrent ? ' (current)' : ''}`,
      }
    })

    const selectList = new SelectList(items, items.length, {
      selectedPrefix: (text) => chalk.cyan(text),
      selectedText: (text) => chalk.cyan(text),
      description: (text) => theme.dim(text),
      scrollInfo: (text) => theme.dim(text),
      noMatch: (text) => theme.dim(text),
    }, { maxPrimaryColumnWidth: 52 })

    const label = theme.fg('accent', 'Select model:')
    this.chatContainer.addChild(new Text(label, 1, 0))
    this.chatContainer.addChild(selectList)
    this.ui.setFocus(selectList)
    this.ui.requestRender()

    let finished = false
    const removeListener = this.ui.addInputListener((data) => {
      if (data === '\x03') {
        // Ctrl+C
        finished = true
        removeListener()
        this.chatContainer.removeChild(selectList)
        this.chatContainer.addChild(new Spacer(1))
        this.ui.setFocus(this.editor)
        this.ui.requestRender()
        return { consume: true }
      }
      return undefined
    })

    const finish = (selectedValue?: string) => {
      if (finished) return
      finished = true
      removeListener()
      this.chatContainer.removeChild(selectList)

      if (selectedValue) {
        const [modelId, api] = selectedValue.split('|')
        this.switchModel(modelId, api as Api | undefined)
      }

      this.chatContainer.addChild(new Spacer(1))
      this.ui.setFocus(this.editor)
      this.ui.requestRender()
    }

    selectList.onSelect = (item) => {
      finish(item.value)
    }

    selectList.onCancel = () => {
      finish()
    }
  }

  /** Switch to a model by ID and update all dependent state. */
  private switchModel(modelId: string, api?: Api): void {
    try {
      const { model, apiKey, provider } = createModelForId(modelId, api)

      this.agent.state.model = model
      this.config = { model, apiKey, provider }

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

      this.showStatus(`Model switched to: ${model.id} (${provider}, ${model.api})`)
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
          new Text(theme.dim('Use /mcp add <name> <command> to add a server'), 1, 0),
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
        new Text(theme.dim('Usage: /mcp [enable|disable|reconnect|add|remove] <server-name>'), 1, 0),
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

    // /mcp add <name> <command> [args...]
    if (action === 'add') {
      this.handleMcpAddCommand(args.trim())
      return
    }

    // /mcp remove <name>
    if (action === 'remove') {
      if (!serverName) {
        this.showError('Usage: /mcp remove <server-name>')
        return
      }
      this.handleMcpRemoveCommand(serverName)
      return
    }

    this.showError(`Unknown /mcp action: ${action}. Usage: /mcp [enable|disable|reconnect|add|remove] <server-name>`)
  }

  private async handleMcpAddCommand(argsStr: string): Promise<void> {
    const parts = argsStr.split(/\s+/).filter(Boolean)
    // Skip 'add' prefix if present
    const name = parts[0]
    const command = parts[1]
    const cmdArgs = parts.slice(2)

    if (!name || !command) {
      this.showError('Usage: /mcp add <name> <command> [args...]')
      return
    }

    const serverConfig: McpServerConfig = {
      type: 'stdio',
      command,
      args: cmdArgs,
    }

    try {
      const configPath = await addMcpServer(name, serverConfig, 'project', process.cwd())
      this.showStatus(`Added MCP server "${name}" to ${configPath}`)

      // Connect the new server immediately
      if (this.mcpClient) {
        this.showStatus(`Connecting MCP server: ${name}...`)
        await this.mcpClient.connectServer(name, serverConfig)
        const server = this.mcpClient.getServer(name)
        if (server?.status === 'connected') {
          this.showStatus(`MCP server "${name}" connected with ${server.tools.length} tool(s)`)

          // Register MCP tools as deferred (discovered via ToolSearchTool)
          registerMcpToolsAsDeferred(this.mcpClient)

          // Inject resource tools directly (they're always needed)
          const resourceTools = [
            createListMcpResourcesTool(this.mcpClient),
            createReadMcpResourceTool(this.mcpClient),
          ]
          this.agent.state.tools = [...this.agent.state.tools, ...resourceTools]

          // Rebuild system prompt with updated MCP info and deferred tool names
          this.rebuildSystemPrompt(this.mcpClient.getServerStates())
        } else {
          this.showError(`Failed to connect MCP server "${name}": ${server?.error ?? 'unknown error'}`)
        }
      }
    } catch (error) {
      this.showError(`Failed to add MCP server: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private async handleMcpRemoveCommand(name: string): Promise<void> {
    try {
      await removeMcpServer(name, 'project', process.cwd())
      this.showStatus(`Removed MCP server "${name}" from config`)

      // Disconnect if connected
      if (this.mcpClient) {
        this.mcpClient.setServerEnabled(name, false)
      }
    } catch (error) {
      this.showError(`Failed to remove MCP server: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private rebuildFooter(): void {
    const oldFooter = this.footer
    this.footer = new FooterComponent(this.agent, this.config.model.id, this.config.provider, process.cwd(), this.agent.state.thinkingLevel)
    this.ui.removeChild(oldFooter)
    this.ui.addChild(this.footer)
    // Restore context usage on the new footer
    this.updateContextUsage()
    this.ui.requestRender()
  }

  private rebuildSystemPrompt(mcpServers?: McpServerState[]): void {
    const deferredToolNames = getDeferredToolNames()
    const sections = getSystemPrompt({
      cwd: process.cwd(),
      modelId: this.config.model.id,
      mcpServers,
      skills: getSkills(this.agent),
      deferredToolNames: deferredToolNames.length > 0 ? deferredToolNames : undefined,
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

  private static PERMISSION_DESCRIPTIONS: Record<PermissionMode, string> = {
    'default': 'Read: auto-allow | Write/Edit/Bash: prompt before execution',
    'auto-approve': 'All tools execute without confirmation (YOLO mode)',
    'plan': 'Read-only — all write/edit/bash operations are blocked',
  }

  private handlePermissionCommand(args: string): void {
    const mode = args.trim().toLowerCase() as PermissionMode

    if (!mode) {
      const current = this.permissionManager.getMode()
      const items: SelectItem[] = PERMISSION_MODES.map((m) => ({
        value: m,
        label: m,
        description: `${App.PERMISSION_DESCRIPTIONS[m]}${m === current ? ' (current)' : ''}`,
      }))

      const selectList = new SelectList(items, items.length, {
        selectedPrefix: (text) => chalk.cyan(text),
        selectedText: (text) => chalk.cyan(text),
        description: (text) => theme.dim(text),
        scrollInfo: (text) => theme.dim(text),
        noMatch: (text) => theme.dim(text),
      })

      const label = theme.fg('accent', 'Select permission mode:')
      this.chatContainer.addChild(new Text(label, 1, 0))
      this.chatContainer.addChild(selectList)
      this.ui.setFocus(selectList)
      this.ui.requestRender()

      let finished = false
      const removeListener = this.ui.addInputListener((data) => {
        if (data === '\x03') {
          finished = true
          removeListener()
          this.chatContainer.removeChild(selectList)
          this.chatContainer.addChild(new Spacer(1))
          this.ui.setFocus(this.editor)
          this.ui.requestRender()
          return { consume: true }
        }
        return undefined
      })

      const finish = (selectedMode?: PermissionMode) => {
        if (finished) return
        finished = true
        removeListener()
        this.chatContainer.removeChild(selectList)

        if (selectedMode) {
          this.permissionManager.setMode(selectedMode)
          this.showStatus(`Permission mode set to: ${selectedMode}`)
        }

        this.chatContainer.addChild(new Spacer(1))
        this.ui.setFocus(this.editor)
        this.ui.requestRender()
      }

      selectList.onSelect = (item) => {
        finish(item.value as PermissionMode)
      }

      selectList.onCancel = () => {
        finish()
      }

      return
    }

    if (!PERMISSION_MODES.includes(mode)) {
      this.showError(`Invalid permission mode: ${mode}. Valid modes: ${PERMISSION_MODES.join(', ')}`)
      return
    }

    this.permissionManager.setMode(mode)
    this.showStatus(`Permission mode set to: ${mode}`)
  }

  private static THINKING_LEVELS: ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh']
  private static THINKING_DESCRIPTIONS: Record<ThinkingLevel, string> = {
    off: 'No reasoning',
    minimal: 'Very brief reasoning (~1k tokens)',
    low: 'Light reasoning (~2k tokens)',
    medium: 'Moderate reasoning (~8k tokens)',
    high: 'Deep reasoning (~16k tokens)',
    xhigh: 'Maximum reasoning (~32k tokens)',
  }

  private handleThinkingCommand(args: string): void {
    const level = args.trim().toLowerCase() as ThinkingLevel

    if (!level) {
      const current = this.agent.state.thinkingLevel
      const items: SelectItem[] = App.THINKING_LEVELS.map((l) => ({
        value: l,
        label: l,
        description: App.THINKING_DESCRIPTIONS[l],
      }))

      const selectList = new SelectList(items, items.length, {
        selectedPrefix: (text) => chalk.cyan(text),
        selectedText: (text) => chalk.cyan(text),
        description: (text) => theme.dim(text),
        scrollInfo: (text) => theme.dim(text),
        noMatch: (text) => theme.dim(text),
      })

      const thinkingLabel = theme.fg('accent', 'Select thinking level:')
      this.chatContainer.addChild(new Text(thinkingLabel, 1, 0))
      this.chatContainer.addChild(selectList)
      this.ui.setFocus(selectList)
      this.ui.requestRender()

      let finished = false
      const removeListener = this.ui.addInputListener((data) => {
        if (data === '\x03') {
          // Ctrl+C
          finished = true
          removeListener()
          this.chatContainer.removeChild(selectList)
          this.chatContainer.addChild(new Spacer(1))
          this.ui.setFocus(this.editor)
          this.ui.requestRender()
          return { consume: true }
        }
        return undefined
      })

      const finish = (selectedLevel?: ThinkingLevel) => {
        if (finished) return
        finished = true
        removeListener()
        this.chatContainer.removeChild(selectList)

        if (selectedLevel) {
          this.agent.state.thinkingLevel = selectedLevel
          this.footer.setThinkingLevel(selectedLevel)
          this.showStatus(`Thinking level set to: ${selectedLevel}`)
        }

        this.chatContainer.addChild(new Spacer(1))
        this.ui.setFocus(this.editor)
        this.ui.requestRender()
      }

      selectList.onSelect = (item) => {
        finish(item.value as ThinkingLevel)
      }

      selectList.onCancel = () => {
        finish()
      }

      return
    }

    if (!App.THINKING_LEVELS.includes(level)) {
      this.showError(`Invalid thinking level: ${level}. Valid levels: ${App.THINKING_LEVELS.join(', ')}`)
      return
    }

    this.agent.state.thinkingLevel = level
    this.footer.setThinkingLevel(level)
    this.showStatus(`Thinking level set to: ${level}`)
  }

  private handleSkillsCommand(): void {
    const skills = getSkills(this.agent)
    const diagnostics = getSkillDiagnostics(this.agent)

    if (skills.length === 0) {
      this.chatContainer.addChild(
        new Text(theme.dim('No skills loaded.'), 1, 0),
      )
      this.chatContainer.addChild(
        new Text(theme.dim('Create SKILL.md files in ~/.microcode/skills/ or .microcode/skills/ to add skills.'), 1, 0),
      )
    } else {
      this.chatContainer.addChild(
        new Text(theme.fg('accent', `Available skills (${skills.length}):`), 1, 0),
      )
      this.chatContainer.addChild(new Spacer(1))

      for (const skill of skills) {
        const disabled = skill.disableModelInvocation ? theme.dim(' (disabled)') : ''
        this.chatContainer.addChild(
          new Text(`${theme.bold(skill.name)}${disabled}`, 1, 0),
        )
        this.chatContainer.addChild(
          new Text(`  ${theme.dim(skill.description)}`, 1, 0),
        )
        this.chatContainer.addChild(
          new Text(`  ${theme.dim(skill.filePath)}`, 1, 0),
        )
        this.chatContainer.addChild(new Spacer(1))
      }
    }

    if (diagnostics.length > 0) {
      this.chatContainer.addChild(
        new Text(theme.fg('yellow', 'Skill diagnostics:'), 1, 0),
      )
      for (const diagnostic of diagnostics) {
        this.chatContainer.addChild(
          new Text(`  ${theme.dim(diagnostic)}`, 1, 0),
        )
      }
      this.chatContainer.addChild(new Spacer(1))
    }

    this.chatContainer.addChild(new Spacer(1))
    this.ui.requestRender()
  }

  /**
   * Interactively present questions from the ask_user_question tool and collect answers.
   * Each question is shown as a SelectList in the chat area.
   * Returns the collected answers, or { block: true } if cancelled.
   */
  async promptAskUserQuestion(
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<{ answers?: Record<string, string>; block?: boolean }> {
    const questions = input.questions as Array<{
      question: string
      header: string
      options: Array<{ label: string; description: string }>
      multiSelect?: boolean
    }>

    if (!questions || questions.length === 0) {
      return { block: true }
    }

    const answers: Record<string, string> = {}

    for (const q of questions) {
      const answer = await this.promptSingleQuestion(q)
      if (answer === undefined) {
        // User cancelled
        return { block: true }
      }
      answers[q.question] = answer
    }

    return { answers }
  }

  /**
   * Present a single question with its options as a SelectList.
   * Returns the selected answer string, or undefined if cancelled.
   */
  private async promptSingleQuestion(q: {
    question: string
    header: string
    options: Array<{ label: string; description: string }>
    multiSelect?: boolean
  }): Promise<string | undefined> {
    return new Promise<string | undefined>((resolve) => {
      this.hideWorking()
      this.permissionPromptActive = true

      // Build select items from options + "Other"
      const items: SelectItem[] = q.options.map((opt) => ({
        value: opt.label,
        label: opt.label,
        description: opt.description,
      }))
      items.push({
        value: '__other__',
        label: 'Other',
        description: 'Provide a custom answer',
      })

      const selectList = new SelectList(items, items.length, {
        selectedPrefix: (text) => chalk.cyan(text),
        selectedText: (text) => chalk.cyan(text),
        description: (text) => theme.dim(text),
        scrollInfo: (text) => theme.dim(text),
        noMatch: (text) => theme.dim(text),
      })

      // Show question header and the select list
      const headerLabel = theme.fg('accent', `${q.header}:`)
      this.chatContainer.addChild(new Text(`${headerLabel} ${q.question}`, 1, 0))
      this.chatContainer.addChild(selectList)
      this.ui.setFocus(selectList)
      this.ui.requestRender()

      let finished = false
      const removeListener = this.ui.addInputListener((data) => {
        if (data === '\x03') {
          // Ctrl+C — cancel
          finished = true
          removeListener()
          this.permissionPromptActive = false
          this.chatContainer.removeChild(selectList)
          this.chatContainer.addChild(new Spacer(1))
          this.ui.setFocus(this.editor)
          this.ui.requestRender()
          resolve(undefined)
          return { consume: true }
        }
        return undefined
      })

      const finish = (value?: string) => {
        if (finished) return
        finished = true
        removeListener()
        this.permissionPromptActive = false
        this.chatContainer.removeChild(selectList)

        if (value === '__other__') {
          // Show "Other" prompt — let user type free-text
          this.chatContainer.addChild(
            new Text(theme.dim('Type your answer and press Enter:'), 1, 0),
          )
          this.ui.setFocus(this.editor)
          this.ui.requestRender()

          // Wait for user to type in the editor
          void this.getUserInput().then((text) => {
            const trimmed = text.trim()
            this.chatContainer.addChild(new Text(`  ${chalk.cyan(trimmed)}`, 1, 0))
            this.chatContainer.addChild(new Spacer(1))
            this.ui.requestRender()
            resolve(trimmed || undefined)
          })
          return
        }

        // Show selected answer
        this.chatContainer.addChild(
          new Text(`  ${chalk.cyan(value ?? '')}`, 1, 0),
        )
        this.chatContainer.addChild(new Spacer(1))
        this.showWorking()
        this.ui.setFocus(this.editor)
        this.ui.requestRender()
        resolve(value)
      }

      selectList.onSelect = (item) => finish(item.value)
      selectList.onCancel = () => finish(undefined)
    })
  }

  /**
   * Prompt user for tool permission using an inline select list in the chat area.
   * Returns true if approved, false if denied.
   */
  async promptPermission(
    toolName: string,
    input: Record<string, unknown>,
    description: string,
  ): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      // Pause spinner while waiting for user decision
      this.hideWorking()
      this.permissionPromptActive = true

      // Extract content for session rule matching
      const ruleContent = this.extractRuleContent(toolName, input)
      const sessionLabel = ruleContent ? `${toolName}(${ruleContent})` : toolName

      const items: SelectItem[] = [
        { value: 'allow', label: 'Allow', description: `Allow ${toolName} to execute` },
        { value: 'allow-session', label: `Allow for session`, description: `Don't ask again for ${sessionLabel}` },
        { value: 'deny', label: 'Deny', description: `Block ${toolName} execution` },
      ]

      const selectList = new SelectList(items, items.length, {
        selectedPrefix: (text) => chalk.cyan(text),
        selectedText: (text) => chalk.cyan(text),
        description: (text) => theme.dim(text),
        scrollInfo: (text) => theme.dim(text),
        noMatch: (text) => theme.dim(text),
      })

      // Add inline to chat area
      const permLabel = theme.fg('accent', 'Permission requested:')
      this.chatContainer.addChild(new Text(`${permLabel} ${description}`, 1, 0))
      this.chatContainer.addChild(selectList)
      this.ui.setFocus(selectList)
      this.ui.requestRender()

      // Intercept Ctrl+C before it reaches SelectList — exit app instead of deny
      let finished = false
      const removeListener = this.ui.addInputListener((data) => {
        if (data === '\x03') { // Ctrl+C
          finished = true
          removeListener()
          this.permissionPromptActive = false
          this.chatContainer.removeChild(selectList)
          this.exit()
          return { consume: true }
        }
        return undefined
      })

      const finish = (approved: boolean) => {
        if (finished) return
        finished = true
        removeListener()
        this.permissionPromptActive = false
        this.chatContainer.removeChild(selectList)
        const icon = approved ? theme.fg('green', '✓') : theme.fg('red', '✗')
        const resultText = approved ? 'Approved' : 'Denied'
        this.chatContainer.addChild(new Text(`${icon} ${resultText}`, 1, 0))
        this.chatContainer.addChild(new Spacer(1))
        // Resume spinner if approved - agent will continue responding
        if (approved) this.showWorking()
        // Restore focus to editor so user can type again
        this.ui.setFocus(this.editor)
        this.ui.requestRender()
        if (!approved) this.agent.abort()
        resolve(approved)
      }

      selectList.onSelect = (item) => {
        if (item.value === 'allow-session') {
          this.permissionManager.addSessionRule(toolName, ruleContent)
        }
        finish(item.value === 'allow' || item.value === 'allow-session')
      }
      selectList.onCancel = () => finish(false)
    })
  }

  private extractRuleContent(toolName: string, input: Record<string, unknown>): string | undefined {
    switch (toolName) {
      case BASH_TOOL_NAME:
        return typeof input.command === 'string' ? input.command : undefined
      case EDIT_TOOL_NAME:
      case WRITE_TOOL_NAME:
      case READ_TOOL_NAME:
        return typeof input.path === 'string' ? input.path : undefined
      default:
        return undefined
    }
  }

  getPermissionManager(): PermissionManager {
    return this.permissionManager
  }

  private showHelp(): void {
    const helpText = [
      `${theme.fg('accent', 'Available Commands:')}`,
      '',
      `  ${theme.bold('/clear')}              Clear the conversation history`,
      `  ${theme.bold('/compact')} [instr.]    Compress conversation context`,
      `  ${theme.bold('/model')} [model-id]   Show current model or switch to a different model`,
      `  ${theme.bold('/thinking')} [level]   Show or set thinking depth`,
      `  ${theme.bold('/mcp')}                Manage MCP servers (add/remove/enable/disable)`,
      `  ${theme.bold('/session')} [list]     Show session info or list saved sessions`,
      `  ${theme.bold('/permission')} [mode]  Show or switch permission mode`,
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
          const UIConstructor = getToolUIConstructor(event.toolName)
          const component: ToolUIComponent = UIConstructor
            ? new UIConstructor(event.toolCallId, event.args)
            : new ToolExecutionComponent(event.toolName, event.toolCallId, event.args)
          component.setExpanded(false)
          component.markExecutionStarted()
          this.chatContainer.addChild(component)
          this.pendingTools.set(event.toolCallId, component)
          this.toolExecutionInProgress = true
          // Ensure spinner is visible during tool execution
          this.showWorking()
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
            if (component.updateDetails && event.result.details) {
              component.updateDetails(event.result.details)
            }
            this.pendingTools.delete(event.toolCallId)
            if (this.pendingTools.size === 0) {
              this.toolExecutionInProgress = false
            }
            this.updateContextUsage()
            this.footer.invalidate()
            this.ui.requestRender()
          }
          break
        }

        case 'turn_end':
          // Don't hide spinner if tools are still executing
          if (!this.toolExecutionInProgress) {
            this.hideWorking()
          }
          if (event.message.role === 'assistant' && event.message.stopReason === 'aborted') {
            this.chatContainer.addChild(
              new Text(chalk.hex('#cc6666').bold('\nInterrupted\n'), 1, 0),
            )
          } else if (event.message.role === 'assistant' && event.message.stopReason === 'error') {
            const errMsg = event.message.errorMessage || 'Unknown error'
            this.chatContainer.addChild(
              new Text(chalk.hex('#cc6666')(`\nError: ${errMsg}\n`), 1, 0),
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
