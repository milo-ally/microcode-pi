import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { createMicrocodeAgent } from './agent.ts'
import { App } from './tui/app.ts'
import { McpClientManager } from './mcp/client.ts'
import { loadMcpConfig, isMcpConfigEmpty } from './mcp/config.ts'
import { createMcpTools, createListMcpResourcesTool, createReadMcpResourceTool } from './tools/index.ts'
import { SessionManager } from './session/SessionManager.ts'

declare const MACRO: {
  VERSION: string
}

async function main(): Promise<void> {
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

Options:
  --version, -v    Show version
  --help, -h       Show this help
  --resume [id]    Resume a session (last session if no id given)

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

Session Management:
  Sessions are automatically saved to ~/.microcode/sessions/
  Use --resume to continue where you left off.
  Use /compact to manually compress conversation context.
`)
    process.exit(0)
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

  // Create MCP client and agent without waiting for MCP servers
  const mcpClient = new McpClientManager()
  const agent = createMicrocodeAgent({ cwd })

  // Restore messages if resuming
  if (restoredMessages && restoredMessages.length > 0) {
    agent.state.messages = restoredMessages
  }

  // Create TUI app (REPL starts immediately)
  const app = new App(agent, mcpClient, sessionManager)

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
    process.exit(0)
  }

  // Connect MCP servers in background — non-blocking
  const mcpConfigs = await loadMcpConfig(cwd)
  if (!isMcpConfigEmpty(mcpConfigs)) {
    void mcpClient.connectAll(mcpConfigs).then(() => {
      // Inject MCP tools + resource tools
      const mcpTools = createMcpTools(mcpClient)
      const resourceTools = [
        createListMcpResourcesTool(mcpClient),
        createReadMcpResourceTool(mcpClient),
      ]
      agent.state.tools = [...agent.state.tools, ...mcpTools, ...resourceTools]

      // Rebuild system prompt with MCP info
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
