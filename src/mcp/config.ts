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

export async function loadMcpConfig(
  cwd: string,
): Promise<Record<string, McpServerConfig>> {
  const configs: Record<string, McpServerConfig> = {}

  // Load user-level config
  const userConfigPath = join(homedir(), '.microcode', 'mcp.json')
  const userConfig = await readJsonFile(userConfigPath)
  if (userConfig?.mcpServers) {
    Object.assign(configs, userConfig.mcpServers)
  }

  // Load project-level config (overrides user)
  const projectConfigPath = join(cwd, '.microcode', 'mcp.json')
  const projectConfig = await readJsonFile(projectConfigPath)
  if (projectConfig?.mcpServers) {
    Object.assign(configs, projectConfig.mcpServers)
  }

  return configs
}

export function isMcpConfigEmpty(configs: Record<string, McpServerConfig>): boolean {
  return Object.keys(configs).length === 0
}
