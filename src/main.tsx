import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { createMicrocodeAgent } from './agent.ts'
import { resolveApiKey } from './models/index.ts'
import { App } from './tui/app.ts'
import { McpClientManager } from './mcp/client.ts'
import { loadMcpConfig, isMcpConfigEmpty } from './mcp/config.ts'
import { addMcpServer, removeMcpServer, listMcpServers, parseEnvVars, parseHeaders, type ConfigScope } from './mcp/configWrite.ts'
import type { McpServerConfig } from './mcp/types.ts'
import { createMcpTools, createListMcpResourcesTool, createReadMcpResourceTool, registerMcpToolsAsDeferred } from './tools/index.ts'
import { SessionManager } from './session/SessionManager.ts'
import { PermissionManager, type PermissionMode, PERMISSION_MODES } from './permissions/index.ts'
import { cleanupImageCache } from './utils/imageUtils.ts'

declare const MACRO: {
  VERSION: string
}

function parseFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag)
  if (idx === -1) return undefined
  const val = args[idx + 1]
  if (!val || val.startsWith('-')) return undefined
  return val
}

function collectFlagValues(args: string[], flag: string): string[] {
  const values: string[] = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag && args[i + 1] && !args[i + 1].startsWith('-')) {
      values.push(args[i + 1])
    }
  }
  return values
}

function filterFlags(args: string[]): string[] {
  const result: string[] = []
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('-')) {
      // Skip flag and its value (if next arg doesn't start with -)
      if (args[i + 1] && !args[i + 1].startsWith('-')) {
        i++ // skip value too
      }
      continue
    }
    result.push(args[i])
  }
  return result
}

async function handleMcpAdd(args: string[]): Promise<void> {
  const scope = (parseFlag(args, '--scope') ?? 'project') as ConfigScope
  const transport = parseFlag(args, '--transport') ?? 'stdio'
  const envVars = collectFlagValues(args, '-e')
  const headerValues = collectFlagValues(args, '--header')

  const positional = filterFlags(args)
  const name = positional[0]
  const commandOrUrl = positional[1]
  const remainingArgs = positional.slice(2)

  if (!name) {
    console.error('Error: Server name is required.')
    console.log('Usage: microcode mcp add <name> <command> [args...]')
    console.log('       microcode mcp add --transport sse <name> <url>')
    process.exit(1)
  }

  if (!commandOrUrl) {
    console.error('Error: Command or URL is required.')
    console.log('Usage: microcode mcp add <name> <command> [args...]')
    process.exit(1)
  }

  if (scope !== 'user' && scope !== 'project') {
    console.error(`Invalid scope: ${scope}. Must be 'user' or 'project'.`)
    process.exit(1)
  }

  if (transport !== 'stdio' && transport !== 'sse' && transport !== 'http') {
    console.error(`Invalid transport: ${transport}. Must be 'stdio', 'sse', or 'http'.`)
    process.exit(1)
  }

  let serverConfig: McpServerConfig
  let description: string

  if (transport === 'sse') {
    const headers = headerValues.length > 0 ? parseHeaders(headerValues) : undefined
    serverConfig = { type: 'sse', url: commandOrUrl, headers }
    description = `SSE server at ${commandOrUrl}`
  } else if (transport === 'http') {
    const headers = headerValues.length > 0 ? parseHeaders(headerValues) : undefined
    serverConfig = { type: 'http', url: commandOrUrl, headers }
    description = `HTTP server at ${commandOrUrl}`
  } else {
    const env = envVars.length > 0 ? parseEnvVars(envVars) : undefined
    serverConfig = { type: 'stdio', command: commandOrUrl, args: remainingArgs, env }
    description = `stdio server: ${commandOrUrl} ${remainingArgs.join(' ')}`.trim()
  }

  try {
    const configPath = await addMcpServer(name, serverConfig, scope, process.cwd())
    console.log(`Added MCP server "${name}" (${description})`)
    console.log(`Config: ${configPath}`)
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}

async function handleMcpRemove(args: string[]): Promise<void> {
  const scope = (parseFlag(args, '--scope') ?? 'project') as ConfigScope
  const positional = filterFlags(args)
  const name = positional[0]

  if (!name) {
    console.error('Error: Server name is required.')
    console.log('Usage: microcode mcp remove <name> [--scope user|project]')
    process.exit(1)
  }

  try {
    const configPath = await removeMcpServer(name, scope, process.cwd())
    console.log(`Removed MCP server "${name}" from ${scope} config`)
    console.log(`Config: ${configPath}`)
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}

async function handleMcpList(args: string[]): Promise<void> {
  const scope = (parseFlag(args, '--scope') ?? 'all') as ConfigScope | 'all'

  try {
    const servers = await listMcpServers(scope, process.cwd())

    if (servers.length === 0) {
      console.log('No MCP servers configured.')
      return
    }

    console.log('Configured MCP servers:\n')
    for (const { scope: s, name, config } of servers) {
      let typeDesc: string
      if (config.type === 'sse') {
        typeDesc = `sse → ${config.url}`
      } else if (config.type === 'http') {
        typeDesc = `http → ${config.url}`
      } else if (config.type === 'ws') {
        typeDesc = `ws → ${config.url}`
      } else {
        typeDesc = `stdio → ${config.command} ${(config.args ?? []).join(' ')}`.trim()
      }
      console.log(`  ${name} [${s}]`)
      console.log(`    ${typeDesc}`)
    }
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}

async function main(): Promise<void> {
  // Set process title for better visibility in process lists
  try {
    // Try to set process title (may be limited on some platforms)
    process.title = 'microcode'
    // Also set argv0 if possible
    process.argv0 = 'microcode'
  } catch {
    // process.title may not be supported on all platforms
  }

  const args = process.argv.slice(2)

  // Handle --version/-v
  if (args.length === 1 && (args[0] === '--version' || args[0] === '-v')) {
    console.log(`${MACRO.VERSION} (Microcode)`)
    process.exit(0)
  }

  // Handle --help/-h
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
    console.log(`
Microcode - AI-powered coding assistant

Usage:
  microcode [options] [prompt]
  microcode mcp add <name> <command> [args...]
  microcode mcp remove <name>
  microcode mcp list

Options:
  --version, -v              Show version
  --help, -h                 Show this help
  --resume [id]              Resume a session (last session if no id given)
  --permission <mode>        Set permission mode: default, auto-approve, plan
  --permission-mode <mode>   (alias for --permission)
  --model <model-id>         Override the model (e.g., claude-sonnet-4-20250514)
  --thinking <level>         Set thinking depth: off, minimal, low, medium, high, xhigh

MCP Commands:
  mcp add <name> <command> [args...]     Add a stdio MCP server
  mcp add --transport sse <name> <url>   Add an SSE MCP server
  mcp add --transport http <name> <url>  Add an HTTP MCP server
  mcp remove <name>                      Remove an MCP server
  mcp list                               List configured MCP servers

  Options for mcp add:
    --scope <user|project>     Config scope (default: project)
    --transport <stdio|sse|http>  Transport type (default: stdio)
    -e KEY=value               Set environment variables
    --header "Key: Value"      Set headers for SSE/HTTP

Environment Variables:
  ANTHROPIC_API_KEY     Anthropic API key
  ANTHROPIC_BASE_URL    Anthropic API base URL (default: https://api.anthropic.com/v1)
  ANTHROPIC_MODEL       Anthropic model ID (default: claude-sonnet-4-20250514)

  OPENAI_API_KEY        OpenAI API key
  OPENAI_BASE_URL       OpenAI API base URL (default: https://api.openai.com/v1)
  OPENAI_MODEL          OpenAI model ID (default: gpt-4o)

  API_KEY               Fallback API key (used with OpenAI-compatible APIs)
  BASE_URL              Fallback base URL
  MODEL                 Fallback model ID

MCP Configuration:
  Place mcp.json in ~/.microcode/ (user) or .microcode/ (project)
  with a "mcpServers" key containing server definitions.
  Or use 'microcode mcp add' to add servers from the command line.

Session Management:
  Sessions are automatically saved to ~/.microcode/sessions/
  Use --resume to continue where you left off.
  Use /compact to manually compress conversation context.
`)
    process.exit(0)
  }

  // Handle mcp subcommands: microcode mcp add/remove/list ...
  if (args[0] === 'mcp') {
    const subcommand = args[1]
    const mcpArgs = args.slice(2)

    if (subcommand === 'add') {
      await handleMcpAdd(mcpArgs)
      process.exit(0)
    } else if (subcommand === 'remove') {
      await handleMcpRemove(mcpArgs)
      process.exit(0)
    } else if (subcommand === 'list') {
      await handleMcpList(mcpArgs)
      process.exit(0)
    } else {
      console.error(`Unknown mcp subcommand: ${subcommand}`)
      console.log('Usage: microcode mcp add|remove|list [options] [args...]')
      process.exit(1)
    }
  }

  const cwd = process.cwd()
  const resumeFlagIdx = args.indexOf('--resume')
  const resumeFlag = resumeFlagIdx !== -1
  // Session ID is the arg after --resume, if it exists and isn't another flag
  const resumeSessionId = resumeFlag
    ? (args[resumeFlagIdx + 1] && !args[resumeFlagIdx + 1].startsWith('-')
        ? args[resumeFlagIdx + 1]
        : undefined)
    : undefined
  const filteredArgs = args.filter((a) => !a.startsWith('-'))

  // Parse --permission / --permission-mode flag
  const permModeIdx = args.indexOf('--permission') !== -1
    ? args.indexOf('--permission')
    : args.indexOf('--permission-mode')
  let permissionMode: PermissionMode | undefined
  if (permModeIdx !== -1) {
    const modeArg = args[permModeIdx + 1]?.toLowerCase()
    if (modeArg && PERMISSION_MODES.includes(modeArg as PermissionMode)) {
      permissionMode = modeArg as PermissionMode
    } else {
      console.error(`Invalid permission mode: ${modeArg}. Valid modes: ${PERMISSION_MODES.join(', ')}`)
      process.exit(1)
    }
  }

  // Parse --model flag
  const modelIdx = args.indexOf('--model')
  let modelId: string | undefined
  if (modelIdx !== -1) {
    modelId = args[modelIdx + 1]
    if (!modelId || modelId.startsWith('-')) {
      console.error('Missing model ID after --model')
      process.exit(1)
    }
  }

  // Parse --thinking flag
  const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const
  type ThinkingLevel = (typeof THINKING_LEVELS)[number]
  const thinkingIdx = args.indexOf('--thinking')
  let thinkingLevel: ThinkingLevel | undefined
  if (thinkingIdx !== -1) {
    const levelArg = args[thinkingIdx + 1]?.toLowerCase()
    if (levelArg && THINKING_LEVELS.includes(levelArg as ThinkingLevel)) {
      thinkingLevel = levelArg as ThinkingLevel
    } else {
      console.error(`Invalid thinking level: ${levelArg}. Valid levels: ${THINKING_LEVELS.join(', ')}`)
      process.exit(1)
    }
  }

  // Create session manager
  const sessionManager = new SessionManager()

  // Resume or create session
  let restoredMessages: AgentMessage[] | null = null
  if (resumeFlag) {
    let targetSession = null

    if (resumeSessionId) {
      // Resume specific session by ID
      const sessions = await sessionManager.list()
      targetSession = sessions.find((s) => s.id.startsWith(resumeSessionId)) ?? null
      if (!targetSession) {
        console.error(`Session not found: ${resumeSessionId}`)
        process.exit(1)
      }
    } else {
      // Resume latest session for this directory
      targetSession = await sessionManager.getLatestSession(cwd)
    }

    if (targetSession) {
      try {
        restoredMessages = await sessionManager.open(targetSession)
        console.log(`Resumed session: ${targetSession.id.slice(0, 8)}`)
      } catch (error) {
        console.error(`Failed to resume session: ${error instanceof Error ? error.message : String(error)}`)
        await sessionManager.create(cwd)
      }
    } else {
      console.log('No previous session found. Starting new session.')
      await sessionManager.create(cwd)
    }
  } else {
    await sessionManager.create(cwd)
  }

  // Create permission manager
  const permissionManager = new PermissionManager({ mode: permissionMode })

  // Create MCP client and agent without waiting for MCP servers
  const mcpClient = new McpClientManager()
  const agent = createMicrocodeAgent({ cwd, modelId, thinkingLevel, permissionManager })

  // Restore messages if resuming
  if (restoredMessages && restoredMessages.length > 0) {
    agent.state.messages = restoredMessages
  }

  // Create TUI app (REPL starts immediately)
  const app = new App(agent, mcpClient, sessionManager, permissionManager, modelId, thinkingLevel)

  // Warn if no API key is configured (non-blocking — app still starts)
  if (!resolveApiKey(agent.state.model)) {
    const provider = (agent.state.model.provider as string).toUpperCase().replace(/-/g, '_')
    app.addStartupWarning(
      `No API key configured. Set ${provider}_API_KEY or API_KEY to enable model responses.`,
    )
  }

  // Wire permission prompt to TUI
  permissionManager.setOnPermissionRequest(
    (toolName, input, description) => app.promptPermission(toolName, input, description),
  )

  // Wire ask_user_question interactive handler to TUI
  permissionManager.setOnAskUserQuestion(
    (toolName, input) => app.promptAskUserQuestion(toolName, input),
  )

  // Handle exit from TUI (Ctrl+C, Ctrl+D, Escape)
  app.onExit = async () => {
    try {
      await sessionManager.saveMessages(agent.state.messages as AgentMessage[])
    } catch {
      // Ignore save errors on shutdown
    }
    await mcpClient.disconnectAll()
    const sessionId = sessionManager.getSessionId()
    if (sessionId) {
      console.log(`\nResume this session with: microcode --resume ${sessionId.slice(0, 8)}`)
    }
    cleanupImageCache(sessionId ?? '')
    process.exit(0)
  }

  // Connect MCP servers in background — non-blocking
  const mcpConfigs = await loadMcpConfig(cwd)
  if (!isMcpConfigEmpty(mcpConfigs)) {
    void mcpClient.connectAll(mcpConfigs).then(() => {
      // Register MCP tools as deferred (discovered via ToolSearchTool)
      registerMcpToolsAsDeferred(mcpClient)

      // Inject resource tools directly (they're always needed)
      const resourceTools = [
        createListMcpResourcesTool(mcpClient),
        createReadMcpResourceTool(mcpClient),
      ]
      agent.state.tools = [...agent.state.tools, ...resourceTools]

      // Rebuild system prompt with MCP info and deferred tool names
      app.updateMcpState(mcpClient)

      // Notify user in chat
      app.showMcpReady(mcpClient.getServerStates())
    })
  }

  // Handle graceful shutdown
  const shutdown = async () => {
    // Save session before exit
    try {
      await sessionManager.saveMessages(agent.state.messages as AgentMessage[])
    } catch {
      // Ignore save errors on shutdown
    }
    await mcpClient.disconnectAll()
    app.stop()
    // Print resume command
    const sessionId = sessionManager.getSessionId()
    if (sessionId) {
      console.log(`\nResume this session with: microcode --resume ${sessionId.slice(0, 8)}`)
    }
    cleanupImageCache(sessionId ?? '')
    process.exit(0)
  }

  process.on('SIGINT', () => {
    void shutdown()
  })
  process.on('SIGTERM', () => {
    void shutdown()
  })

  // If there's an initial prompt argument, send it after app starts
  const initialPrompt = filteredArgs.join(' ')
  if (initialPrompt) {
    // Will be handled after app.run() starts
  }

  await app.run()
}

void main()
