# Model Integration Design

## Architecture Overview

The model integration is organized into four layers:

```
┌─────────────────────────────────────────────────────────┐
│  microcode-pi (Application Layer)                        │
│  agent.ts → createMicrocodeAgent()                      │
│  models/registry.ts → ModelConfig                       │
├─────────────────────────────────────────────────────────┤
│  pi-agent-core (Scheduling Layer)                        │
│  Agent → AgentLoop → streamFn() → convertToLlm()        │
├─────────────────────────────────────────────────────────┤
│  pi-ai (Protocol Layer)                                  │
│  api-registry → ApiProvider.stream() → HTTP request      │
├─────────────────────────────────────────────────────────┤
│  Provider Implementations (Network Layer)                 │
│  openai-completions / anthropic-messages / ...           │
└─────────────────────────────────────────────────────────┘
```

## Protocol Layer — `pi-ai`

### Model Type (`types.ts:528-558`)

`Model<TApi>` is the central data structure of the entire system. The generic parameter `TApi` determines which API protocol to use:

```typescript
interface Model<TApi extends Api> {
  id: string              // Model ID, e.g. 'deepseek-v4-pro'
  name: string            // Display name
  api: TApi               // API protocol: 'openai-completions' | 'anthropic-messages' | ...
  provider: Provider      // Provider identifier
  baseUrl: string         // API endpoint
  reasoning: boolean      // Whether the model supports reasoning/thinking
  thinkingLevelMap?: ThinkingLevelMap  // Thinking level mapping
  input: ('text' | 'image')[]  // Supported input modalities
  cost: { input, output, cacheRead, cacheWrite }  // Pricing ($/million tokens)
  contextWindow: number   // Context window size
  maxTokens: number       // Maximum output tokens
  headers?: Record<string, string>  // Custom request headers
  compat?: OpenAICompletionsCompat | AnthropicMessagesCompat | ...  // Compatibility config
}
```

**The `compat` field is the key to cross-provider compatibility.** Different OpenAI-compatible APIs have subtle differences in field support. `compat` allows per-item overrides of auto-detected behavior:

| compat field | Purpose |
|---|---|
| `requiresReasoningContentOnAssistantMessages` | Whether to include `reasoning_content` field (DeepSeek requires this) |
| `thinkingFormat` | Thinking parameter format: `'deepseek'` / `'openai'` / `'openrouter'` / `'together'` etc. |
| `supportsStore` | Whether the provider supports OpenAI's `store` field |
| `maxTokensField` | Use `max_completion_tokens` or `max_tokens` |
| `requiresThinkingAsText` | Whether thinking blocks must be converted to `<thinking>` text tags |
| `supportsStrictMode` | Whether tool definitions support the `strict` field |
| `cacheControlFormat` | Cache control convention for prompt caching (e.g., `"anthropic"`) |

### API Protocol Registration (`api-registry.ts`)

The `ApiProvider` interface defines what each protocol must provide:

```typescript
interface ApiProvider<TApi, TOptions> {
  api: TApi
  stream: StreamFunction<TApi, TOptions>       // Raw streaming
  streamSimple: StreamFunction<TApi, SimpleStreamOptions>  // Simplified streaming (auto-handles thinking levels)
}
```

Registered via `registerApiProvider()`, internally stored in a `Map<string, ApiProvider>`.

### Provider Lazy Loading (`register-builtins.ts`)

All 9 built-in providers are **lazy-loaded**:

```typescript
function createLazyStream(loadModule): StreamFunction {
  return (model, context, options) => {
    const outer = new AssistantMessageEventStream()
    loadModule().then(module => {
      const inner = module.stream(model, context, options)
      forwardStream(outer, inner)  // Forward event stream
    }).catch(error => {
      outer.push({ type: 'error', ... })  // Encode error into stream
    })
    return outer
  }
}
```

This means a provider's module is only `import()`-ed when its API protocol is actually invoked. The 9 supported protocols:

| API Protocol | Provider Implementation | Typical Use |
|---|---|---|
| `openai-completions` | `openai-completions.ts` | OpenAI, DeepSeek, MiMo, Ollama and other compatible APIs |
| `anthropic-messages` | `anthropic.ts` | Claude family |
| `openai-responses` | `openai-responses.ts` | OpenAI Responses API |
| `azure-openai-responses` | `azure-openai-responses.ts` | Azure OpenAI |
| `openai-codex-responses` | `openai-codex-responses.ts` | OpenAI Codex |
| `google-generative-ai` | `google.ts` | Gemini |
| `google-vertex` | `google-vertex.ts` | Vertex AI |
| `mistral-conversations` | `mistral.ts` | Mistral |
| `bedrock-converse-stream` | `amazon-bedrock.ts` | AWS Bedrock |

### Streaming Event Protocol (`types.ts:347-359`)

All providers return a unified `AssistantMessageEventStream` with these event types:

```
start → text_start → text_delta... → text_end
      → thinking_start → thinking_delta... → thinking_end
      → toolcall_start → toolcall_delta... → toolcall_end
      → done | error
```

### Message Types (`types.ts:271-302`)

```typescript
type Message = UserMessage | AssistantMessage | ToolResultMessage

// AssistantMessage content is a union type
content: (TextContent | ThinkingContent | ToolCall)[]
```

## Scheduling Layer — `pi-agent-core`

### Agent Construction (`agent.ts`)

Key configuration the `Agent` accepts:

```typescript
interface AgentOptions {
  initialState: {
    systemPrompt: string
    model: Model<any>
    tools: AgentTool[]
    thinkingLevel?: ThinkingLevel
  }
  streamFn?: StreamFn              // Optional custom stream function
  convertToLlm?: (AgentMessage[]) => Message[]  // Message format conversion
  transformContext?: (AgentMessage[]) => Promise<AgentMessage[]>  // Context transformation
  beforeToolCall?: (ctx) => Promise<BeforeToolCallResult>  // Pre-tool hook
  afterToolCall?: (ctx) => Promise<AfterToolCallResult>    // Post-tool hook
}
```

### Agent Loop Flow

Each conversational turn follows this complete flow:

```
User message → agent.prompt(text)
    │
    ▼
transformContext(messages)     ← Context compression (microcompact + auto-compact)
    │
    ▼
convertToLlm(messages)        ← AgentMessage[] → Message[] (LLM format)
    │
    ▼
streamFn(model, context, opts) ← Call LLM API, stream response
    │
    ▼
Model output → AssistantMessage
    │
    ├─ Has toolCall → beforeToolCall → execute → afterToolCall → continue loop
    │
    └─ No toolCall → turn_end → wait for user input
```

## Application Layer — microcode-pi

### Model Registry (`models/registry.ts`)

microcode-pi maintains its own static model list (7 models):

| Model ID | Provider | API | Reasoning | Context Window |
|---|---|---|---|---|
| `deepseek-v4-pro` | deepseek | openai-completions | true | 1M |
| `deepseek-v4-flash` | deepseek | openai-completions | true | 1M |
| `mimo-v2.5` | xiaomimimo | openai-completions | true | 1M |
| `mimo-v2.5-pro` | xiaomimimo | openai-completions | true | 1M |
| `gemini-2.5-pro` | google | google-generative-ai | true | 1M |
| `gemini-2.5-flash` | google | google-generative-ai | true | 1M |
| `gemini-2.5-flash-lite` | google | google-generative-ai | true | 1M |

DeepSeek and MiMo models use the `openai-completions` protocol and set:
```typescript
compat: { requiresReasoningContentOnAssistantMessages: true, thinkingFormat: 'deepseek' }
```

Gemini models use the `google-generative-ai` protocol (no `compat` needed — pi-ai's google provider handles thinking natively via Gemini's `thought: true` part format).

### Adding a New Model

To add a new model to microcode-pi:

1. Find the model definition in `pi/packages/ai/src/models.generated.ts` (search by model ID)
2. Copy the definition into the `MODELS` array in `src/models/registry.ts`, removing the `satisfies Model<...>` type assertion (the array's `as Model<Api>[]` cast covers it)
3. Set the protocol-appropriate env var (e.g. `OPENAI_API_KEY` for openai-completions models)
4. Test: set the env var, run with `MODEL=<model-id>`, verify a basic prompt completes

### Environment Variable Resolution Chain

API key and base URL are resolved by **protocol** (not provider):

```
| 协议                 | API Key            | Base URL           | Model           |
|---------------------|--------------------|--------------------|-----------------|
| openai-completions  | OPENAI_API_KEY     | OPENAI_BASE_URL    | OPENAI_MODEL    |
| anthropic-messages  | ANTHROPIC_API_KEY  | ANTHROPIC_BASE_URL | ANTHROPIC_MODEL |
| google-generative-ai| GEMINI_API_KEY     | GEMINI_BASE_URL    | GEMINI_MODEL    |
| 任意（兜底）         | API_KEY            | BASE_URL           | —               |
```

```typescript
// API Key — resolved by model.api
resolveApiKey(model):
  openai-completions  → OPENAI_API_KEY
  anthropic-messages  → ANTHROPIC_API_KEY
  google-generative-ai→ GEMINI_API_KEY
  fallback            → API_KEY

// Base URL override (protocol-aware)
applyEnvOverrides(model):
  BASE_URL              → overrides all models (global)
  OPENAI_BASE_URL       → only for openai-completions models
  ANTHROPIC_BASE_URL    → only for anthropic-messages models
  GEMINI_BASE_URL       → only for google-generative-ai models

// Model selection
getCurrentModel():
  OPENAI_MODEL / ANTHROPIC_MODEL / GEMINI_MODEL / MODEL → exact match → partial match → default deepseek-v4-pro
```

### streamFn Integration (`agent.ts:108-114`)

```typescript
streamFn: async (model, context, opts) => {
  const apiKey = resolveApiKey(model) ?? modelConfig.apiKey
  return streamSimple(model, context, { ...opts, apiKey })
}
```

Key point: **API Key is resolved dynamically on every LLM call**, not fixed at startup. This supports:
- Runtime model switching via `/model` (different providers use different keys)
- OAuth token refresh scenarios

### convertToLlm — Cross-API Message Conversion (`agent.ts:178-248`)

This is microcode-pi's most important adaptation layer, converting internal Agent message formats to LLM API formats:

```typescript
function createConvertToLlm(getModel) {
  return (messages: AgentMessage[]): Message[] => {
    const model = getModel()
    const requiresReasoningContent = model.compat?.requiresReasoningContentOnAssistantMessages

    return messages.flatMap(msg => {
      switch (msg.role) {
        case 'user':
        case 'toolResult':
          return [msg]  // Pass through directly

        case 'assistant':
          // Extract thinking block text
          const thinkingText = msg.content
            .filter(c => c.type === 'thinking')
            .map(c => c.thinking).join('\n')

          // Filter out thinking blocks, keep text + toolCall
          const filtered = msg.content.filter(c => c.type !== 'thinking')
          const result = { ...msg, content: filtered }

          // DeepSeek format needs reasoning_content field
          if (requiresReasoningContent) {
            result.reasoning_content = thinkingText || ''
          }
          return [result]

        case 'bashExecution':
          // Convert to user message
          return [{ role: 'user', content: `Command: ${msg.command}\nOutput: ${msg.output}` }]

        case 'compactionSummary':
          return [{ role: 'user', content: `[Previous conversation summary]\n${msg.summary}` }]

        case 'branchSummary':
          return [{ role: 'user', content: `[Branch summary]\n${msg.summary}` }]
      }
    })
  }
}
```

**Core design decision**: thinking block handling depends on `model.compat`:
- **DeepSeek format** (`requiresReasoningContentOnAssistantMessages: true`): thinking text is extracted into the `reasoning_content` field and removed from `content`
- **Anthropic format**: thinking blocks stay in `content`; the provider's `convertMessages` handles them
- The `getModel()` closure fetches the current model, auto-adapting after `/model` switches

### transformContext — Context Compression (`agent.ts:116-130`)

```typescript
transformContext: async (messages) => {
  // Layer 1: Microcompact — compress old tool results (reduce token usage)
  const { messages: microcompacted } = compactionManager.microcompact(messages)

  // Layer 2: Auto-compact — trigger full compression when approaching context window
  if (compactionManager.isCompactionNeeded(microcompacted)) {
    return await compactionManager.autoCompact(microcompacted)
  }
  return microcompacted
}
```

Two-layer compression strategy:
- **Microcompact**: Replace old tool execution results with summaries, preserving recent results unchanged
- **Auto-compact**: When token estimation approaches `contextWindow`, use the LLM to generate a summary of the entire conversation segment

## openai-completions Provider Details

Since all of microcode-pi's models use the `openai-completions` protocol, here are its key internals.

The provider uses the official OpenAI SDK. Core flow:

1. **Message transformation**: `transformMessages()` converts pi-ai's `Message[]` to OpenAI's `ChatCompletionMessageParam[]`
2. **Tool transformation**: TypeBox schema → OpenAI function calling schema
3. **Thinking parameters**: Build reasoning parameters based on `compat.thinkingFormat`:
   - `'deepseek'` → `{ thinking: { type: 'enabled' }, reasoning_effort: 'high' }`
   - `'openai'` → `{ reasoning_effort: 'high' }`
   - `'openrouter'` → `{ reasoning: { effort: 'high' } }`
   - `'together'` → `{ reasoning: { enabled: true } }`
4. **Stream processing**: Parse SSE chunks → build `AssistantMessageEvent` → push into event stream
5. **Compatibility adaptation**: The `compat` field controls per-request details (`store`, `max_tokens` field name, `developer` role, etc.)

## Design Highlights

1. **Three-layer decoupling** — pi-ai (protocol) → pi-agent-core (scheduling) → microcode-pi (application); each layer is independently replaceable
2. **Lazy-loaded providers** — Only the API protocol actually used gets its module loaded, reducing startup overhead
3. **compat compatibility layer** — A single `Model` type + `compat` overrides adapts to 20+ OpenAI-compatible API variations
4. **Unified streaming event protocol** — Consistent `AssistantMessageEvent` protocol lets the TUI incrementally render output from any provider
5. **Dynamic API Key** — Resolved on every LLM call, supporting runtime model switching and token refresh
6. **convertToLlm adaptation** — Handles internal Agent messages (bashExecution, compactionSummary, etc.) to LLM format conversion, auto-selecting thinking format via model compat
7. **Two-layer compression** — Microcompact (local) + auto-compact (global), maximizing context utilization without losing critical information


# Tool System Design

## Architecture Overview

The tool system is organized into four layers, bottom-up:

```
┌─────────────────────────────────────────────────┐
│  Agent Loop (pi-agent-core)                     │  ← Scheduling: manages tool call lifecycle
├─────────────────────────────────────────────────┤
│  PermissionManager                              │  ← Access control: allow / deny / ask
├─────────────────────────────────────────────────┤
│  ToolSearchTool + Two-Phase Discovery           │  ← Discovery: lazy-load MCP tools on demand
├─────────────────────────────────────────────────┤
│  Registry + ToolDefinition                      │  ← Registration: tool definitions & metadata
└─────────────────────────────────────────────────┘
```

## Registration Layer — `registry.ts`

The registry is a `Map<string, ToolDefinition>`. Each tool registers itself via `registerTool()`.

The `ToolDefinition` interface (`registry.ts:26-37`) captures all metadata for a tool:

```typescript
interface ToolDefinition {
  name: string                         // Unique identifier, e.g. 'bash', 'mcp__slack__send'
  defaultPermission: PermissionBehavior // 'allow' | 'deny' | 'ask'
  createTool: (...args: any[]) => AgentTool  // Factory function
  ui?: ToolUIConstructor              // TUI rendering component (optional)
  formatDescription?: (input) => string  // Human-readable description for permission prompts
  extractMatchContent?: (input) => string  // Content extraction for rule matching
  description?: string                // Used by ToolSearchTool for keyword search
  shouldDefer?: boolean               // Whether to defer loading (core design lever)
}
```

**`shouldDefer` is the foundation of the two-phase discovery mechanism** — tools flagged `true` are hidden from the initial context and loaded on demand via `ToolSearchTool`.

The registry also maintains a separate `dynamicDeferredTools` Map (`registry.ts:88`) for tools created at runtime (MCP tools that connect after startup).

Key query functions:

| Function | Returns |
|---|---|
| `getCoreToolDefinitions()` | Tools where `shouldDefer !== true` |
| `getDeferredToolDefinitions()` | Tools where `shouldDefer === true` (static registration) |
| `getAllDeferredToolDefinitions()` | Static + dynamic deferred tools (deduplicated merge) |

## Three Sources of Tools

### Built-in Core Tools (static registration, loaded immediately)

Registered via side-effect imports in `src/tools/index.ts`:

```
import './BashTool/index.ts'       → name: 'bash'
import './FileEditTool/index.ts'   → name: 'edit'
import './FileWriteTool/index.ts'  → name: 'write'
import './FileReadTool/index.ts'   → name: 'read'
import './ToolSearchTool/index.ts' → name: 'tool_search'
```

Each tool follows a **three-file convention**:
- `XxxTool.ts` — Tool logic, exports a `createXxxTool(cwd)` factory function
- `index.ts` — Calls `registerTool()` (side-effect registration)
- `UI.tsx` — TUI rendering component (optional)

Taking `BashTool` (`BashTool.ts:37-142`) as an example, it returns an `AgentTool` object containing:
- `name`, `label`, `description` — Metadata
- `parameters` — TypeBox schema (`{ command: string, timeout?: number, description?: string }`)
- `execute(toolCallId, params, signal, onUpdate)` — Actual execution logic via `child_process.spawn`, supporting streaming output (`onUpdate` callback), timeout, and signal-based cancellation

### SkillTool (special handling)

`SkillTool` is not registered via side-effect import. Instead, it is dynamically registered inside `createCodingTools()` because it needs a `getSkills` callback to access the agent's skill list. It reads SKILL.md file content and returns it to the model.

### MCP Tools (dynamic deferred registration)

MCP tools are dynamically registered into the `dynamicDeferredTools` Map via `registerMcpToolsAsDeferred()` (`MCPTool.ts:97-109`). Each MCP tool is named `mcp__{serverName}__{toolName}`.

Internally, MCP tool execution delegates to `McpClientManager.callTool()`, forwarding the request to the MCP server.

## Discovery Layer — Two-Phase Tool Loading (Core Innovation)

This is the most sophisticated part of the system, solving the problem of **MCP tools consuming excessive context window tokens**.

### Problem

Each tool's full schema (name + description + parameter JSON Schema) costs roughly 200-500 tokens. With 20 MCP tools, that is 4000-10000 tokens — space that could be used for conversation history or code.

### Solution: `ToolSearchTool`

`ToolSearchTool` (`ToolSearchTool.ts:135-218`) is a **meta-tool** — it is itself a core tool, but its purpose is to discover and load other deferred tools.

**Query modes**:
1. `select:tool_name` — Direct selection (supports comma-separated multi-select: `select:A,B,C`)
2. Keyword search — Scoring system based on tool name tokenization + description matching

**Search algorithm** (`ToolSearchTool.ts:45-107`):
- Exact name match → return immediately
- MCP prefix match → prefix-based search
- Keyword scoring: tool name part match +10 (MCP +12), partial containment +5/+3, description match +2

### Two-Phase Flow

**Phase 1 — Initialization** (`agent.ts:42-66`):

```
coreTools = createCodingTools({ cwd, getSkills })  // 4 core tools
toolSearchTool = createToolSearchTool({ ... })      // Meta-tool
initialTools = [...coreTools, toolSearchTool]       // 5-6 tools total
```

The system prompt includes an `<available-deferred-tools>` section listing all deferred tool names (without schemas).

**Phase 2 — On-demand injection** (`agent.ts:99-109`):

```typescript
afterToolCall: async (ctx) => {
  if (ctx.toolCall.name === 'tool_search' && pendingDiscoveredTools.length > 0) {
    const newTools = pendingDiscoveredTools
    pendingDiscoveredTools = []
    // Update both agent.state.tools AND context.tools so the next API call sees them
    agent.state.tools = [...agent.state.tools, ...newTools]
    ctx.context.tools = [...(ctx.context.tools ?? []), ...newTools]
  }
}
```

Critical timing:
1. Model calls `tool_search({ query: "select:mcp__slack__send" })`
2. `ToolSearchTool.execute()` runs → calls `onToolsDiscovered` callback → tool instance stored in `pendingDiscoveredTools`
3. `afterToolCall` hook fires → injects new tools into both `agent.state.tools` and `ctx.context.tools`
4. Model sees ToolSearchTool's return value (containing full schema as text)
5. **Same turn**, the next API request already includes the new tool's schema → model can call it directly

Both `agent.state.tools` and `ctx.context.tools` must be updated: the former for external state consistency, the latter because the agent loop reads tools from its local context snapshot for subsequent API calls within the same run.

## Permission Layer — `PermissionManager`

`PermissionManager` (`manager.ts`) runs in the Agent's `beforeToolCall` hook, deciding whether to allow a tool call.

**Three modes**:
- `default` — Rule-based checking; dangerous tools require user confirmation
- `auto-approve` — Allow everything (YOLO mode)
- `plan` — Only allow tools with `defaultPermission: 'allow'` (read-only)

**Rule priority** (`manager.ts:147-173`):
```
deny rules > ask rules > allow rules > tool default permission > fallback to ask
```

Each tool declares its `defaultPermission` at registration time:
- `bash` → `'ask'` (requires user confirmation)
- `read` → `'allow'` (auto-approved)
- `edit`, `write` → `'ask'`
- `skill`, `tool_search` → `'allow'`

The `formatDescription` function generates human-readable descriptions for permission prompts, e.g. `grep {"pattern":"TODO"}`.

## UI Layer — Tool Rendering

Each tool can provide a custom `ToolUIComponent` (implementing the `Component` interface) for TUI display. If none is provided, the system falls back to a generic `ToolExecutionComponent`.

The UI component interface (`registry.ts:9-15`):
```typescript
interface ToolUIComponent extends Component {
  setExpanded(expanded: boolean): void
  markExecutionStarted(): void
  updateResult(result: ToolResult, isPartial?: boolean): void
  updateDetails?(details: Record<string, unknown>): void
}
```

`updateResult` supports an `isPartial` parameter, working with the `onUpdate` callback to enable streaming output (e.g., BashTool's real-time stdout).

## Complete Tool Call Lifecycle

```
User input
    │
    ▼
transformContext()     ← Compress old messages (microcompact + auto-compact)
    │
    ▼
streamFn()            ← Call LLM API, stream response
    │
    ▼
Model outputs toolCall
    │
    ▼
beforeToolCall()      ← PermissionManager.checkPermissionWithPrompt()
    │                     → allow / deny / ask (prompt user)
    ▼
tool.execute()        ← Actual execution, with signal cancellation and onUpdate streaming
    │
    ▼
afterToolCall()       ← ToolSearchTool triggers injection of new tools into agent.state.tools
    │
    ▼
turn_end              ← More toolCalls → continue loop; none → wait for user
```

## Design Highlights

1. **Two-phase discovery** — Core tools load immediately; MCP tools load on demand, saving context window
2. **Registry pattern** — Side-effect registration + `shouldDefer` flag; adding a new tool requires touching only 3 files, never agent/app
3. **Dynamic tool injection** — `afterToolCall` hook + `agent.state.tools` setter enables runtime hot-loading of tools
4. **Factory function pattern** — `createTool(cwd)` lets tools capture context like the working directory, avoiding global state
5. **Permission/tool decoupling** — Tools only declare `defaultPermission`; rule matching is handled centrally by `PermissionManager`

## Complete Tool Definition Example

### ToolDefinition Interface — All Fields

```typescript
interface ToolDefinition {
  // Required fields

  /** Unique identifier used for registration and invocation */
  name: string

  /** Default permission policy */
  defaultPermission: 'allow' | 'deny' | 'ask'

  /** Factory function that creates a tool instance */
  createTool: (...args: any[]) => AgentTool<any, any>

  /** Tool description, used by ToolSearchTool for keyword search */
  description?: string

  // Optional fields

  /** TUI rendering component constructor */
  ui?: ToolUIConstructor

  /** Formats a tool call into a human-readable description (for permission prompts, etc.) */
  formatDescription?: (input: Record<string, unknown>) => string

  /** Extracts content for permission rule matching */
  extractMatchContent?: (input: Record<string, unknown>) => string | undefined

  /** Whether to defer loading (true = discovered via tool_search, false = loaded immediately) */
  shouldDefer?: boolean
}
```

---

### Example: Creating a "Send Notification" Tool

#### File Structure

```
src/tools/NotifyTool/
├── NotifyTool.ts      # Tool logic
├── index.ts           # Registration entry
└── UI.tsx             # TUI component (optional)
```

---

#### File 1: `src/tools/NotifyTool/NotifyTool.ts`

```typescript
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core'
import { Type, type Static } from 'typebox'
import type { PermissionBehavior } from '../../permissions/types.ts'

// Default permission policy:
// 'allow' — auto-approve, no confirmation needed
// 'deny'  — deny by default
// 'ask'   — require user confirmation before execution
export const TOOL_DEFAULT_PERMISSION: PermissionBehavior = 'ask'

// Input parameter schema (TypeBox)
const NotifyToolSchema = Type.Object({
  title: Type.String({
    description: 'Notification title',
    minLength: 1,
    maxLength: 100,
  }),

  message: Type.String({
    description: 'Notification body',
    minLength: 1,
    maxLength: 1000,
  }),

  priority: Type.Optional(
    Type.Union([
      Type.Literal('low', { description: 'Low priority' }),
      Type.Literal('normal', { description: 'Normal priority' }),
      Type.Literal('high', { description: 'High priority' }),
    ], { description: 'Notification priority', default: 'normal' })
  ),

  requiresAck: Type.Optional(
    Type.Boolean({ description: 'Whether user acknowledgment is required', default: false })
  ),
})

// Static type derived from the schema
export type NotifyToolInput = Static<typeof NotifyToolSchema>

// Extra data returned to the caller
export interface NotifyToolDetails {
  notificationId: string
  sentAt: string
  recipient: string
}

// Factory function: creates a notification tool instance
export function createNotifyTool(
  options: NotifyToolOptions
): AgentTool<typeof NotifyToolSchema, NotifyToolDetails> {
  const { notificationService, defaultRecipient } = options

  return {
    name: 'notify',
    label: 'Send Notification',

    // Description used by ToolSearchTool keyword search.
    // Should clearly state the tool's purpose and usage scenarios.
    description: 'Send a notification to the user. Supports title, message, priority, and acknowledgment.',

    parameters: NotifyToolSchema,

    async execute(
      toolCallId: string,
      params: NotifyToolInput,
      signal?: AbortSignal,
      onUpdate?: (partial: AgentToolResult<NotifyToolDetails>) => void,
    ): Promise<AgentToolResult<NotifyToolDetails>> {
      const { title, message, priority = 'normal', requiresAck = false } = params

      if (!title || !message) {
        throw new Error('Title and message are required')
      }

      if (signal?.aborted) {
        throw new Error('Tool execution was cancelled')
      }

      try {
        const notificationId = await notificationService.send({
          title,
          message,
          priority,
          requiresAck,
          recipient: defaultRecipient,
        })

        if (onUpdate) {
          onUpdate({
            content: [{ type: 'text', text: `Sending notification: ${title}` }],
            details: {
              notificationId,
              sentAt: new Date().toISOString(),
              recipient: defaultRecipient,
            },
          })
        }

        return {
          content: [
            { type: 'text', text: `Notification sent successfully!` },
            { type: 'text', text: `ID: ${notificationId}` },
            { type: 'text', text: `Title: ${title}` },
            { type: 'text', text: `Priority: ${priority}` },
            { type: 'text', text: `Status: ${requiresAck ? 'Awaiting acknowledgment' : 'Delivered'}` },
          ],
          details: {
            notificationId,
            sentAt: new Date().toISOString(),
            recipient: defaultRecipient,
          },
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        throw new Error(`Failed to send notification: ${errorMessage}`)
      }
    },
  }
}

export interface NotifyToolOptions {
  notificationService: NotificationService
  defaultRecipient: string
}
```

---

#### File 2: `src/tools/NotifyTool/index.ts`

```typescript
import { registerTool } from '../registry.ts'
import { createNotifyTool, TOOL_DEFAULT_PERMISSION, type NotifyToolOptions } from './NotifyTool.ts'
import { NotifyToolUI } from './UI.tsx'

// Register the notification tool in the global registry
registerTool({
  // Required fields
  name: 'notify',
  defaultPermission: TOOL_DEFAULT_PERMISSION,

  createTool: (cwd: string) => {
    const notificationService = new NotificationService()
    const options: NotifyToolOptions = {
      notificationService,
      defaultRecipient: 'user',
    }
    return createNotifyTool(options)
  },

  // Optional but recommended fields

  // Description for ToolSearchTool search.
  // Should include functionality, use cases, and examples.
  description: 'Send a notification to the user. Supports title, message, priority (low/normal/high), and optional acknowledgment requirement.',

  // TUI rendering component for terminal display
  ui: NotifyToolUI,

  // Human-readable description for permission prompts and logs
  formatDescription: (input) => {
    if (typeof input.title === 'string' && typeof input.message === 'string') {
      const priority = input.priority ? ` [${input.priority}]` : ''
      const truncated = input.message.length > 30
        ? input.message.slice(0, 30) + '...'
        : input.message
      return `notify${priority}: ${input.title} - "${truncated}"`
    }
    return '(send notification)'
  },

  // Extract content for permission rule matching
  extractMatchContent: (input) => {
    if (typeof input.title === 'string') {
      return input.title
    }
    return undefined
  },

  // false = core tool, loaded immediately
  // true  = deferred tool, discovered via tool_search before loading
  shouldDefer: false,
})
```

---

#### File 3: `src/tools/NotifyTool/UI.tsx` (Optional)

```typescript
import type { ToolUIComponent, ToolResult } from '../registry.ts'
import { h, type ComponentChildren } from 'preact'

// TUI rendering component for the notification tool.
// Displays the tool execution process in the terminal interface.
export class NotifyToolUI implements ToolUIComponent {
  private container: HTMLElement | null = null
  private expanded = false
  private toolCallId: string
  private args: any

  constructor(toolCallId: string, args: any) {
    this.toolCallId = toolCallId
    this.args = args
  }

  setContainer(container: HTMLElement): void {
    this.container = container
    this.render()
  }

  setExpanded(expanded: boolean): void {
    this.expanded = expanded
    this.render()
  }

  markExecutionStarted(): void {
    this.render()
  }

  updateResult(result: ToolResult, isPartial?: boolean): void {
    this.render(result, isPartial)
  }

  updateDetails?(details: Record<string, unknown>): void {
    // Optional implementation
  }

  private render(result?: ToolResult, isPartial?: boolean): void {
    if (!this.container) return

    const title = this.args?.title || 'Notification'
    const message = this.args?.message || ''
    const priority = this.args?.priority || 'normal'

    const priorityColors: Record<string, string> = {
      low: '#888',
      normal: '#4A90D9',
      high: '#E53935',
    }

    this.container.innerHTML = `
      <div style="padding: 8px; border: 1px solid #444; border-radius: 4px; margin: 4px 0;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="color: ${priorityColors[priority]};">[${priority.toUpperCase()}]</span>
          <strong>${title}</strong>
        </div>
        ${this.expanded || result ? `<div style="margin-top: 8px; color: #ccc;">${message}</div>` : ''}
        ${result ? `
          <div style="margin-top: 8px; padding: 8px; background: #2a2a2a; border-radius: 4px;">
            ${result.content.map(c => `<div>${c.text || ''}</div>`).join('')}
          </div>
        ` : ''}
      </div>
    `
  }
}
```

---

### Microcompact Configuration

Microcompact (Layer 1 of session compression) automatically clears old tool results to save context window tokens. By default it covers `bash`, `read`, `write`, `edit`. New tools must be explicitly opted in.

**File to modify:** `src/session/CompactionManager.ts`

**SOP — two steps:**

**Step 1:** Import the new tool's `TOOL_NAME` at the top of the file:

```typescript
// existing imports:
import { TOOL_NAME as BASH_TOOL_NAME } from '../tools/BashTool/BashTool.ts'
import { TOOL_NAME as READ_TOOL_NAME } from '../tools/FileReadTool/FileReadTool.ts'
import { TOOL_NAME as WRITE_TOOL_NAME } from '../tools/FileWriteTool/FileWriteTool.ts'
import { TOOL_NAME as EDIT_TOOL_NAME } from '../tools/FileEditTool/FileEditTool.ts'
// ↓ add the new one:
import { TOOL_NAME as NOTIFY_TOOL_NAME } from '../tools/NotifyTool/NotifyTool.ts'
```

**Step 2:** Add the `TOOL_NAME` to the `COMPACTABLE_TOOL_NAMES` set:

```typescript
const COMPACTABLE_TOOL_NAMES = new Set([
  BASH_TOOL_NAME,
  READ_TOOL_NAME,
  WRITE_TOOL_NAME,
  EDIT_TOOL_NAME,
  NOTIFY_TOOL_NAME,  // ← added
])
```

**What happens after:** The tool's old results (all but the most recent 3) will be replaced with `[Old tool result content cleared]` on every agent loop iteration, reducing token usage with no LLM cost.

**Guidance on whether to add a tool to microcompact:**

| Tool characteristic | Add? | Reason |
|---|---|---|
| Produces large text output that becomes stale (e.g. file listings, command output) | Yes | Old results lose value quickly; clearing them saves tokens |
| Produces small, immutable results (e.g. notification confirmation, settings read) | Maybe | Token savings are marginal, but harmless |
| Results are semantically important for future decisions (e.g. user answers, permission grants) | No | The model needs full history to make correct decisions over time |
| Tool is a meta-tool (e.g. `tool_search`, `skill`) | No | The result content is schemas/knowledge the model must retain |

---

### Register in the Entry File

Add the following import to `src/tools/index.ts`:

```typescript
// ... other imports
import './NotifyTool/index.ts'
```

---

### Field Reference

| Field | Required | Type | Description |
|---|---|---|---|
| `name` | Yes | `string` | Unique identifier, e.g. `'notify'`, `'mcp__slack__send'` |
| `defaultPermission` | Yes | `'allow' \| 'deny' \| 'ask'` | Default permission policy |
| `createTool` | Yes | `(...args) => AgentTool` | Factory function |
| `description` | Recommended | `string` | Tool description (used by ToolSearchTool) |
| `ui` | No | `ToolUIConstructor` | TUI rendering component (optional) |
| `formatDescription` | Recommended | `(input) => string` | Human-readable description for permission prompts |
| `extractMatchContent` | Recommended | `(input) => string \| undefined` | Content extraction for permission rule matching |
| `shouldDefer` | No | `boolean` | Whether to defer loading (default: `false`) |

---

# Special Tools

## AskUserQuestionTool

### Purpose

Lets the model ask the user structured multiple-choice questions during execution. The model calls `ask_user_question` with a list of questions and options; the TUI presents them interactively; answers are returned to the model as a tool result.

### ★ Key Insight: Permission Check AS Functionality

**This is the most important design pattern in this tool.** The `TOOL_DEFAULT_PERMISSION` is set to `'ask'` — not because the tool is dangerous, but because **the permission flow IS the tool's interactive mechanism**.

```
Normal tool:     'ask' permission → "Allow / Deny?" → execute(input)
AskUserQuestion: 'ask' permission → "Pick A / B / C?" → execute(input + answers)
```

The `PermissionManager.checkPermissionWithPrompt()` intercepts the tool call and, instead of showing a generic "Allow/Deny" prompt, routes to `onAskUserQuestion()` which renders the interactive question UI. Answers are stored on the tool object, and `execute()` reads them back.

**Why this matters**: pi-agent-core's `BeforeToolCallResult` only supports `{ block, reason }` — there is no `updatedInput` field. The frontend (microcode-frontend) solves this with `onAllow(updatedInput)` in React. Our solution avoids modifying the core framework entirely by exploiting the fact that `agent.state.tools` and the tools used in `prepareToolCall` share the same object references. The tool object itself becomes the communication channel between the permission layer and the execution layer.

**If `TOOL_DEFAULT_PERMISSION` were `'allow'`**, the permission flow would be skipped entirely — `execute()` would receive no answers and the tool would be useless. This is the only tool where `'ask'` is load-bearing for functionality, not safety.

### Architecture

```
Model calls: ask_user_question({ questions: [...] })
    │
    ▼
beforeToolCall → PermissionManager.checkPermissionWithPrompt(ctx)
    │
    ├─ checkPermission() → { reason: 'ask' }   (default is 'ask', NOT 'allow')
    │
    ├─ ★ Detects tool === 'ask_user_question'
    │   Routes to onAskUserQuestion() instead of onPermissionRequest()
    │       │
    │       ▼
    │   TUI renders questions with SelectLists, user picks answers
    │       │
    │       ▼
    │   Returns { answers: { "Q1": "A", "Q2": "B" } }
    │
    ├─ tool.setAnswers(answers)   ← stored on the tool OBJECT, not arguments
    │
    ▼
tool.execute(toolCallId, params)
    │  params does NOT contain answers — they're read from the tool object
    │  via tool.getAndClearAnswers()
    ▼
Returns formatted answers to model
```

### Why Answers Are Stored on the Tool Object (Not Arguments)

This is a critical detail. In pi-agent-core's agent loop (`agent-loop.js`):

1. `prepareToolCall()` calls `validateToolArguments()` → produces `validatedArgs`
2. `beforeToolCall()` hook runs (this is where PermissionManager intercepts)
3. `executePreparedToolCall()` calls `tool.execute(id, prepared.args)` — using the **pre-computed** `validatedArgs`, NOT `toolCall.arguments`

So mutating `ctx.toolCall.arguments` in `beforeToolCall` has **zero effect** on what `execute()` receives. The solution: since `agent.state.tools` and the tools array in `prepareToolCall`'s context share the same object references, we can store data directly on the tool instance via `setAnswers()` / `getAndClearAnswers()`. The tool object acts as a shared memory channel.

### Files

| File | Role |
|---|---|
| `src/tools/AskUserQuestionTool/AskUserQuestionTool.ts` | Tool logic: schema, factory, execute, answer storage |
| `src/tools/AskUserQuestionTool/index.ts` | Registration: `registerTool()` with formatDescription, extractMatchContent |
| `src/tools/AskUserQuestionTool/UI.tsx` | TUI display: shows questions and collected answers |
| `src/permissions/manager.ts` | `onAskUserQuestion` callback + `getTool` resolver for answer injection |
| `src/tui/app.ts` | `promptAskUserQuestion()` / `promptSingleQuestion()` — interactive SelectList UI |
| `src/main.tsx` | Wiring: `permissionManager.setOnAskUserQuestion(...)` |

### Design Decisions for Future Reference

1. **Reuse the permission layer for interactive input** — When a tool needs user interaction before execution, don't build a separate mechanism. Hijack the `'ask'` permission path with a tool-specific handler.

2. **Tool object as communication channel** — When `beforeToolCall` can't modify the arguments that `execute()` receives, store data on the tool instance itself. This works because tool instances are shared references.

3. **`getTool` resolver pattern** — `PermissionManager` receives a `(name) => AgentTool` callback to look up tool instances by name. This avoids coupling the permission manager to a specific tools array.

4. **`getAndClearAnswers()` idempotency** — Answers are consumed on read. This prevents stale answers from leaking into subsequent calls if the tool is reused.