# Microcode

AI-powered coding assistant for the terminal.

## Prerequisites

- [Bun](https://bun.sh) >= 1.3.5

## Install

```bash
bun install
bun run build
```

This compiles a standalone `microcode` executable (no runtime dependency) and installs it to:

| Platform | Install path | Available immediately? |
|---|---|---|
| Linux / macOS | `~/.local/bin/microcode` | Yes (`~/.local/bin` is in PATH by default) |
| Windows | `%LOCALAPPDATA%\microcode\microcode.exe` | Depends — if not in PATH, restart your terminal after build |

## Usage

```bash
# Start a new session
microcode

# Resume the last session for this directory
microcode --resume

# Resume a specific session by ID
microcode --resume abc12345

# Show version
microcode --version

# Show help
microcode --help
```

## Configuration

### API Keys

Set one of the following environment variables:

| Provider   | Key                  | Base URL env             | Model env         |
|------------|----------------------|--------------------------|-------------------|
| Anthropic  | `ANTHROPIC_API_KEY`  | `ANTHROPIC_BASE_URL`     | `ANTHROPIC_MODEL` |
| OpenAI     | `OPENAI_API_KEY`     | `OPENAI_BASE_URL`        | `OPENAI_MODEL`    |
| Custom     | `API_KEY`            | `BASE_URL`               | `MODEL`           |

### MCP Servers

Place an `mcp.json` in `~/.microcode/` (user-level) or `.microcode/` (project-level):

```json
{
  "mcpServers": {
    "my-server": {
      "command": "node",
      "args": ["path/to/server.js"]
    }
  }
}
```

## Slash Commands

- `/compact` — Compress conversation context
- `/model` — Switch model
- `/help` — Show available commands

## Sessions

Sessions are saved to `~/.microcode/sessions/`. Use `microcode --resume` to continue where you left off.
