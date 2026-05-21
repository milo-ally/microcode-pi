import type { AgentTool } from '@earendil-works/pi-agent-core'
import type { Component } from '@earendil-works/pi-tui'
import type { PermissionBehavior } from '../permissions/types.ts'

// ============================================================================
// Types
// ============================================================================

/** 工具 UI 组件的公共接口 */
export interface ToolUIComponent extends Component {
  setExpanded(expanded: boolean): void
  markExecutionStarted(): void
  updateResult(result: ToolResult, isPartial?: boolean): void
  updateDetails?(details: Record<string, unknown>): void
}

export interface ToolResult {
  content: Array<{ type: string; text?: string }>
  isError: boolean
}

/** UI 组件构造器 */
export type ToolUIConstructor = new (toolCallId: string, args: any) => ToolUIComponent

/** 工具定义 — 绑定工具的所有元数据 */
export interface ToolDefinition {
  name: string
  defaultPermission: PermissionBehavior
  createTool: (...args: any[]) => AgentTool<any, any>
  ui?: ToolUIConstructor
  formatDescription?: (input: Record<string, unknown>) => string
  extractMatchContent?: (input: Record<string, unknown>) => string | undefined
  /** Tool description for keyword search matching. Used by ToolSearchTool. */
  description?: string
  /** If true, tool is hidden from initial context and discovered via ToolSearchTool. */
  shouldDefer?: boolean
}

// ============================================================================
// Registry
// ============================================================================

const registry = new Map<string, ToolDefinition>()

export function registerTool(def: ToolDefinition): void {
  registry.set(def.name, def)
}

export function getToolDefinition(name: string): ToolDefinition | undefined {
  return registry.get(name)
}

export function getAllToolDefinitions(): ToolDefinition[] {
  return Array.from(registry.values())
}

export function getToolUIConstructor(name: string): ToolUIConstructor | undefined {
  return registry.get(name)?.ui
}

export function getToolDefaultPermissions(): Record<string, PermissionBehavior> {
  const result: Record<string, PermissionBehavior> = {}
  for (const [name, def] of registry) {
    result[name] = def.defaultPermission
  }
  return result
}

/** Check if a tool definition should be deferred (hidden from initial context). */
export function isDeferredTool(def: ToolDefinition): boolean {
  return def.shouldDefer === true
}

/** Get tool definitions that should be loaded immediately (not deferred). */
export function getCoreToolDefinitions(): ToolDefinition[] {
  return Array.from(registry.values()).filter(def => !isDeferredTool(def))
}

/** Get tool definitions that are deferred (discovered via ToolSearchTool). */
export function getDeferredToolDefinitions(): ToolDefinition[] {
  return Array.from(registry.values()).filter(isDeferredTool)
}

// ============================================================================
// Dynamic deferred tools (for MCP tools that are created at runtime)
// ============================================================================

const dynamicDeferredTools = new Map<string, ToolDefinition>()

/** Register a dynamically created tool as deferred (e.g., MCP tools). */
export function registerDynamicDeferredTool(def: ToolDefinition): void {
  dynamicDeferredTools.set(def.name, def)
}

/** Remove a dynamically registered deferred tool. */
export function unregisterDynamicDeferredTool(name: string): void {
  dynamicDeferredTools.delete(name)
}

/** Get all deferred tools (registered + dynamic). */
export function getAllDeferredToolDefinitions(): ToolDefinition[] {
  const registered = getDeferredToolDefinitions()
  const dynamic = Array.from(dynamicDeferredTools.values())
  // Deduplicate by name (registered takes precedence)
  const seen = new Set(registered.map(d => d.name))
  return [...registered, ...dynamic.filter(d => !seen.has(d.name))]
}
