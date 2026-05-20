import { readFile } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'
import type { McpConfig, McpServerConfig } from './types.ts'

async function readJsonFile(path: string): Promise<any> {
  try {
    const content = await readFile(path, 'utf-8')
    return JSON.parse(content)
  } catch {
    return null
  }
}

export function getUserConfigPath(): string {
  return join(homedir(), '.microcode', 'mcp.json')
}

export function getProjectConfigPath(cwd: string): string {
  return join(cwd, '.microcode', 'mcp.json')
}

export async function loadMcpConfig(
  cwd: string,
): Promise<Record<string, McpServerConfig>> {
  const configs: Record<string, McpServerConfig> = {}

  // Load user-level config
  const userConfig = await readJsonFile(getUserConfigPath())
  if (userConfig?.mcpServers) {
    Object.assign(configs, userConfig.mcpServers)
  }

  // Load project-level config (overrides user)
  const projectConfig = await readJsonFile(getProjectConfigPath(cwd))
  if (projectConfig?.mcpServers) {
    Object.assign(configs, projectConfig.mcpServers)
  }

  return configs
}

export function isMcpConfigEmpty(configs: Record<string, McpServerConfig>): boolean {
  return Object.keys(configs).length === 0
}
