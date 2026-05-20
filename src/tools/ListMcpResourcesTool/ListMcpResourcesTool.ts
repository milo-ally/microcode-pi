import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'
import type { McpClientManager } from '../../mcp/client.ts'

export function createListMcpResourcesTool(
  clientManager: McpClientManager,
): AgentTool {
  return {
    name: 'mcp__list_resources',
    label: 'MCP: List Resources',
    description:
      'List available resources from connected MCP servers. Optionally filter by server name.',
    parameters: Type.Object({
      server: Type.Optional(
        Type.String({ description: 'Optional server name to filter resources by' }),
      ),
    }),
    async execute(
      _toolCallId: string,
      params: unknown,
    ): Promise<AgentToolResult<any>> {
      const args = params as Record<string, any>
      const resources = clientManager.getAllResources()
      const filtered = args.server
        ? resources.filter((r) => r.serverName === args.server)
        : resources

      const content = filtered.map((r) => ({
        uri: r.uri,
        name: r.name,
        server: r.serverName,
        mimeType: r.mimeType,
        description: r.description,
      }))

      return {
        content: [
          {
            type: 'text',
            text:
              content.length > 0
                ? JSON.stringify(content, null, 2)
                : 'No resources available from connected MCP servers.',
          },
        ],
        details: content,
      }
    },
  }
}
