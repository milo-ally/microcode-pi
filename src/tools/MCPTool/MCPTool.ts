import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core'
import { Type, type TSchema } from 'typebox'
import type { McpClientManager } from '../../mcp/client.ts'
import type { McpToolInfo } from '../../mcp/types.ts'
import { registerDynamicDeferredTool, type ToolDefinition } from '../registry.ts'

function jsonSchemaToTypeBox(inputSchema: Record<string, any>): TSchema {
  if (inputSchema.properties) {
    const properties: Record<string, TSchema> = {}
    for (const [key, prop] of Object.entries(
      inputSchema.properties as Record<string, any>,
    )) {
      switch (prop.type) {
        case 'string':
          properties[key] = Type.String({ description: prop.description })
          break
        case 'number':
        case 'integer':
          properties[key] = Type.Number({ description: prop.description })
          break
        case 'boolean':
          properties[key] = Type.Boolean({ description: prop.description })
          break
        case 'array':
          properties[key] = Type.Array(Type.Any(), {
            description: prop.description,
          })
          break
        case 'object':
          properties[key] = Type.Object({}, { description: prop.description })
          break
        default:
          properties[key] = Type.Any({ description: prop.description })
      }
    }

    return Type.Object(properties, {
      description: inputSchema.description,
      additionalProperties: true,
    })
  }

  return Type.Object({}, { description: inputSchema.description })
}

export function createMcpTool(
  clientManager: McpClientManager,
  toolInfo: McpToolInfo,
): AgentTool {
  const schema = jsonSchemaToTypeBox(toolInfo.inputSchema)

  return {
    name: `mcp__${toolInfo.serverName}__${toolInfo.name}`,
    label: `MCP: ${toolInfo.name}`,
    description: `[MCP:${toolInfo.serverName}] ${toolInfo.description}`,
    parameters: schema,
    async execute(
      _toolCallId: string,
      params: unknown,
    ): Promise<AgentToolResult<any>> {
      try {
        const result = await clientManager.callTool(
          toolInfo.serverName,
          toolInfo.name,
          params as Record<string, any>,
        )

        const textContent =
          result.content
            ?.filter((c) => c.type === 'text')
            .map((c) => c.text ?? '')
            .join('\n') ?? ''

        return {
          content: [
            { type: 'text', text: textContent || 'Tool executed successfully' },
          ],
          details: result,
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`MCP tool error: ${message}`)
      }
    },
  }
}

export function createMcpTools(clientManager: McpClientManager): AgentTool[] {
  const tools = clientManager.getAllTools()
  return tools.map((toolInfo) => createMcpTool(clientManager, toolInfo))
}

/**
 * Register MCP tools as dynamic deferred tools so they can be discovered
 * via ToolSearchTool. Call this when MCP servers connect.
 */
export function registerMcpToolsAsDeferred(clientManager: McpClientManager): void {
  const tools = clientManager.getAllTools()
  for (const toolInfo of tools) {
    const toolName = `mcp__${toolInfo.serverName}__${toolInfo.name}`
    registerDynamicDeferredTool({
      name: toolName,
      defaultPermission: 'allow',
      createTool: () => createMcpTool(clientManager, toolInfo),
      description: `[MCP:${toolInfo.serverName}] ${toolInfo.description}`,
      shouldDefer: true,
    })
  }
}
