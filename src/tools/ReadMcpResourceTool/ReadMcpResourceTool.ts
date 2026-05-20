import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'
import type { McpClientManager } from '../../mcp/client.ts'

export function createReadMcpResourceTool(
  clientManager: McpClientManager,
): AgentTool {
  return {
    name: 'mcp__read_resource',
    label: 'MCP: Read Resource',
    description: 'Read a resource from an MCP server by URI.',
    parameters: Type.Object({
      server: Type.String({
        description: 'The MCP server name that provides the resource',
      }),
      uri: Type.String({ description: 'The resource URI to read' }),
    }),
    async execute(
      _toolCallId: string,
      params: unknown,
    ): Promise<AgentToolResult<any>> {
      try {
        const args = params as Record<string, any>
        const result = await clientManager.readResource(
          args.server,
          args.uri,
        )

        const textContent =
          result.contents
            ?.map((c) => c.text ?? '')
            .join('\n') ?? ''

        return {
          content: [
            {
              type: 'text',
              text: textContent || 'Resource read successfully (no text content)',
            },
          ],
          details: result,
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`MCP resource error: ${message}`)
      }
    },
  }
}
