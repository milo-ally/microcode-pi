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

microcode-pi maintains its own static model list (4 models):

| Model ID | Provider | API | Reasoning | Context Window |
|---|---|---|---|---|
| `deepseek-v4-pro` | deepseek | openai-completions | true | 1M |
| `deepseek-v4-flash` | deepseek | openai-completions | true | 1M |
| `mimo-v2.5` | xiaomimimo | openai-completions | true | 1M |
| `mimo-v2.5-pro` | xiaomimimo | openai-completions | true | 1M |

All models use the `openai-completions` protocol and set:
```typescript
compat: { requiresReasoningContentOnAssistantMessages: true, thinkingFormat: 'deepseek' }
```

### Environment Variable Resolution Chain

```typescript
// API Key resolution order
resolveApiKey(model):
  1. ${PROVIDER}_API_KEY     // e.g. DEEPSEEK_API_KEY
  2. API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY

// Base URL override
applyEnvOverrides(model):
  BASE_URL / OPENAI_BASE_URL / ANTHROPIC_BASE_URL → overrides model.baseUrl

// Model selection
getCurrentModel():
  MODEL / OPENAI_MODEL / ANTHROPIC_MODEL → exact match → partial match → default deepseek-v4-pro
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

**Phase 2 — On-demand injection** (`agent.ts:99-106`):

```typescript
afterToolCall: async (ctx) => {
  if (ctx.toolCall.name === 'tool_search' && pendingDiscoveredTools.length > 0) {
    agent.state.tools = [...agent.state.tools, ...pendingDiscoveredTools]
  }
}
```

Critical timing:
1. Model calls `tool_search({ query: "select:mcp__slack__send" })`
2. `ToolSearchTool.execute()` runs → calls `onToolsDiscovered` callback → tool instance stored in `pendingDiscoveredTools`
3. `afterToolCall` hook fires → injects new tools into `agent.state.tools`
4. Model sees ToolSearchTool's return value (containing full schema as text)
5. **Next turn**, the API request already includes the new tool's schema → model can call it directly

`agent.state.tools` is a setter that copies the array on assignment, so the change takes effect on the next API call.

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

---

