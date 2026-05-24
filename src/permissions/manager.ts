/**
 * PermissionManager — central permission checking for tool execution.
 *
 * Follows microcode-ts's permission architecture with three modes:
 * - default: rules-based + ask for dangerous tools
 * - auto-approve: allow all tool calls (YOLO mode)
 * - plan: only allow read-only tools
 */

import type { AgentTool, BeforeToolCallContext, BeforeToolCallResult } from '@earendil-works/pi-agent-core'
import { getToolDefinition } from '../tools/registry.ts'
import { matchRule, parseRuleString, ruleValueToString } from './rules.ts'
import type {
  PermissionBehavior,
  PermissionDecision,
  PermissionMode,
  PermissionRule,
  PermissionRuleSource,
  PermissionRuleValue,
  ToolPermissionContext,
} from './types.ts'
import { TOOL_DEFAULT_PERMISSIONS, ASK_USER_QUESTION_TOOL_NAME } from '../tools/index.ts'

export interface PermissionManagerOptions {
  mode?: PermissionMode
  allowedTools?: string[]
  deniedTools?: string[]
  askTools?: string[]
  onPermissionRequest?: (
    toolName: string,
    input: Record<string, unknown>,
    description: string,
  ) => Promise<boolean>
  onAskUserQuestion?: (
    toolName: string,
    input: Record<string, unknown>,
  ) => Promise<{ answers?: Record<string, string>; block?: boolean }>
  /** Resolver to look up a tool instance by name from agent.state.tools. */
  getTool?: (name: string) => AgentTool<any, any> | undefined
}

export class PermissionManager {
  private context: ToolPermissionContext
  private onPermissionRequest?: (
    toolName: string,
    input: Record<string, unknown>,
    description: string,
  ) => Promise<boolean>
  private onAskUserQuestion?: (
    toolName: string,
    input: Record<string, unknown>,
  ) => Promise<{ answers?: Record<string, string>; block?: boolean }>
  private getTool?: (name: string) => AgentTool<any, any> | undefined

  constructor(options: PermissionManagerOptions = {}) {
    const allowRules: PermissionRule[] = []
    const denyRules: PermissionRule[] = []
    const askRules: PermissionRule[] = []

    for (const spec of options.allowedTools ?? []) {
      const value = parseRuleString(spec)
      allowRules.push({ ...value, behavior: 'allow', source: 'cliArg' })
    }
    for (const spec of options.deniedTools ?? []) {
      const value = parseRuleString(spec)
      denyRules.push({ ...value, behavior: 'deny', source: 'cliArg' })
    }
    for (const spec of options.askTools ?? []) {
      const value = parseRuleString(spec)
      askRules.push({ ...value, behavior: 'ask', source: 'cliArg' })
    }

    this.context = {
      mode: options.mode ?? 'default',
      allowRules,
      denyRules,
      askRules,
    }
    this.onPermissionRequest = options.onPermissionRequest
    this.onAskUserQuestion = options.onAskUserQuestion
    this.getTool = options.getTool
  }

  setOnPermissionRequest(
    handler: (
      toolName: string,
      input: Record<string, unknown>,
      description: string,
    ) => Promise<boolean>,
  ): void {
    this.onPermissionRequest = handler
  }

  setOnAskUserQuestion(
    handler: (
      toolName: string,
      input: Record<string, unknown>,
    ) => Promise<{ answers?: Record<string, string>; block?: boolean }>,
  ): void {
    this.onAskUserQuestion = handler
  }

  setGetTool(
    resolver: (name: string) => AgentTool<any, any> | undefined,
  ): void {
    this.getTool = resolver
  }

  getMode(): PermissionMode {
    return this.context.mode
  }

  setMode(mode: PermissionMode): void {
    this.context.mode = mode
  }

  addRule(rule: PermissionRule): void {
    const list = this.getRuleList(rule.behavior)
    list.push(rule)
  }

  removeRule(ruleValue: PermissionRuleValue, behavior: PermissionBehavior): void {
    const list = this.getRuleList(behavior)
    const idx = list.findIndex(
      (r) =>
        r.toolName.toLowerCase() === ruleValue.toolName.toLowerCase() &&
        r.ruleContent === ruleValue.ruleContent,
    )
    if (idx !== -1) list.splice(idx, 1)
  }

  /**
   * Add a session-level allow rule. These rules last for the lifetime of the
   * session and are checked before mode defaults.
   */
  addSessionRule(toolName: string, ruleContent?: string): void {
    this.context.allowRules.push({
      toolName,
      ruleContent,
      behavior: 'allow',
      source: 'session',
    })
  }

  getContext(): ToolPermissionContext {
    return { ...this.context }
  }

  /**
   * Core permission check — returns a decision.
   */
  checkPermission(
    toolName: string,
    input: Record<string, unknown>,
  ): PermissionDecision {
    const { mode } = this.context

    // Mode: auto-approve → allow everything except the Ask tool, whose
    // interactive Q&A flow depends on the 'ask' permission path.
    if (mode === 'auto-approve' && toolName !== ASK_USER_QUESTION_TOOL_NAME) {
      return { allowed: true }
    }

    // Mode: plan → only tools with 'allow' default
    if (mode === 'plan') {
      if (TOOL_DEFAULT_PERMISSIONS[toolName] === 'allow') {
        return { allowed: true }
      }
      return {
        allowed: false,
        reason: `Tool "${toolName}" is not allowed in plan mode (read-only)`,
      }
    }

    // Mode: default → check rules, then fall back to defaults
    // Priority: deny > ask > allow > default behavior
    const denyMatch = matchRule(toolName, input, this.context.denyRules)
    if (denyMatch) {
      return {
        allowed: false,
        reason: `Tool "${toolName}" denied by rule: ${ruleValueToString(denyMatch)}`,
      }
    }

    const askMatch = matchRule(toolName, input, this.context.askRules)
    if (askMatch) {
      return { allowed: false, reason: 'ask' }
    }

    const allowMatch = matchRule(toolName, input, this.context.allowRules)
    if (allowMatch) {
      return { allowed: true }
    }

    // Default behaviors for known tools
    const defaultBehavior = TOOL_DEFAULT_PERMISSIONS[toolName]
    if (defaultBehavior === 'allow') {
      return { allowed: true }
    }

    // All other tools default to ask
    return { allowed: false, reason: 'ask' }
  }

  /**
   * Full permission check with async prompt support.
   * Used as the `beforeToolCall` hook.
   */
  async checkPermissionWithPrompt(
    ctx: BeforeToolCallContext,
  ): Promise<BeforeToolCallResult | undefined> {
    const toolName = ctx.toolCall.name
    const input = (ctx.args ?? ctx.toolCall.arguments) as Record<string, unknown>
    const decision = this.checkPermission(toolName, input)

    if (decision.allowed) return undefined

    // Denied by rule
    if (decision.reason !== 'ask') {
      return { block: true, reason: decision.reason }
    }

    // ★ Elegant: for ask_user_question, the permission flow IS the tool's functionality.
    // Instead of a generic "allow/deny" prompt, we hijack the 'ask' path to run an
    // interactive Q&A session. Answers are stored on the tool object so execute()
    // can read them — the tool and the permission system are symbiotic.
    if (toolName === ASK_USER_QUESTION_TOOL_NAME && this.onAskUserQuestion) {
      const result = await this.onAskUserQuestion(toolName, input)
      if (result.block) {
        return { block: true, reason: `User cancelled question for "${toolName}"` }
      }
      // Store answers on the tool object so execute() can read them
      if (result.answers && this.getTool) {
        const tool = this.getTool(toolName) as any
        if (tool?.setAnswers) {
          tool.setAnswers(result.answers)
        }
      }
      return undefined
    }

    // Ask behavior — prompt user
    if (!this.onPermissionRequest) {
      // No prompt handler → block in non-interactive mode
      return { block: true, reason: `Permission required for "${toolName}" (non-interactive mode)` }
    }

    const description = this.formatToolDescription(toolName, input)
    const approved = await this.onPermissionRequest(toolName, input, description)
    if (approved) return undefined

    return { block: true, reason: `Permission denied by user for "${toolName}"` }
  }

  private getRuleList(behavior: PermissionBehavior): PermissionRule[] {
    switch (behavior) {
      case 'allow':
        return this.context.allowRules
      case 'deny':
        return this.context.denyRules
      case 'ask':
        return this.context.askRules
    }
  }

  private formatToolDescription(
    toolName: string,
    input: Record<string, unknown>,
  ): string {
    const def = getToolDefinition(toolName)
    if (def?.formatDescription) {
      return def.formatDescription(input)
    }
    return `${toolName}(${JSON.stringify(input).slice(0, 100)})`
  }
}
