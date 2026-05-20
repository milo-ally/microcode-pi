import { readFile, writeFile, mkdir } from 'fs/promises'
import { dirname } from 'path'
import { getUserConfigPath, getProjectConfigPath } from './config.ts'
import type { McpServerConfig, McpConfig } from './types.ts'

export type ConfigScope = 'user' | 'project'

function getConfigPath(scope: ConfigScope, cwd: string): string {
  return scope === 'user' ? getUserConfigPath() : getProjectConfigPath(cwd)
}

function validateServerName(name: string): void {
  if (!name) {
    throw new Error('Server name is required.')
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new Error(
      `Invalid server name "${name}". Names can only contain letters, numbers, hyphens, and underscores.`,
    )
  }
}

async function readConfigFile(path: string): Promise<McpConfig> {
  try {
    const content = await readFile(path, 'utf-8')
    const parsed = JSON.parse(content)
    if (parsed && typeof parsed === 'object' && parsed.mcpServers) {
      return parsed as McpConfig
    }
  } catch {
    // File doesn't exist or is invalid
  }
  return { mcpServers: {} }
}

async function writeConfigFile(path: string, config: McpConfig): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const content = JSON.stringify(config, null, 2) + '\n'
  await writeFile(path, content, 'utf-8')
}

export async function addMcpServer(
  name: string,
  serverConfig: McpServerConfig,
  scope: ConfigScope,
  cwd: string,
): Promise<string> {
  validateServerName(name)

  const configPath = getConfigPath(scope, cwd)
  const config = await readConfigFile(configPath)

  if (config.mcpServers[name]) {
    throw new Error(
      `MCP server "${name}" already exists in ${scope} config. Remove it first or use a different name.`,
    )
  }

  config.mcpServers[name] = serverConfig
  await writeConfigFile(configPath, config)

  return configPath
}

export async function removeMcpServer(
  name: string,
  scope: ConfigScope,
  cwd: string,
): Promise<string> {
  validateServerName(name)

  const configPath = getConfigPath(scope, cwd)
  const config = await readConfigFile(configPath)

  if (!config.mcpServers[name]) {
    throw new Error(`MCP server "${name}" not found in ${scope} config.`)
  }

  delete config.mcpServers[name]
  await writeConfigFile(configPath, config)

  return configPath
}

export async function listMcpServers(
  scope: ConfigScope | 'all',
  cwd: string,
): Promise<{ scope: ConfigScope; name: string; config: McpServerConfig }[]> {
  const results: { scope: ConfigScope; name: string; config: McpServerConfig }[] = []

  const scopes: ConfigScope[] = scope === 'all' ? ['user', 'project'] : [scope]

  for (const s of scopes) {
    const configPath = getConfigPath(s, cwd)
    const config = await readConfigFile(configPath)
    for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
      results.push({ scope: s, name, config: serverConfig })
    }
  }

  return results
}

export function parseEnvVars(envArray: string[]): Record<string, string> {
  const env: Record<string, string> = {}
  for (const entry of envArray) {
    const eqIndex = entry.indexOf('=')
    if (eqIndex === -1) {
      throw new Error(
        `Invalid environment variable format: "${entry}". Expected KEY=value.`,
      )
    }
    const key = entry.substring(0, eqIndex).trim()
    const value = entry.substring(eqIndex + 1)
    if (!key) {
      throw new Error(`Empty key in environment variable: "${entry}"`)
    }
    env[key] = value
  }
  return env
}

export function parseHeaders(headerArray: string[]): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const header of headerArray) {
    const colonIndex = header.indexOf(':')
    if (colonIndex === -1) {
      throw new Error(
        `Invalid header format: "${header}". Expected "Header-Name: value".`,
      )
    }
    const key = header.substring(0, colonIndex).trim()
    const value = header.substring(colonIndex + 1).trim()
    if (!key) {
      throw new Error(`Empty key in header: "${header}"`)
    }
    headers[key] = value
  }
  return headers
}

export function getScopeDescription(scope: ConfigScope): string {
  return scope === 'user'
    ? getUserConfigPath()
    : `project .microcode/mcp.json`
}
