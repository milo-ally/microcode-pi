/**
 * Permission type definitions for microcode-pi.
 *
 * Follows microcode-ts's permission architecture with simplified modes
 * and rule-based access control for tool execution.
 */

// ============================================================================
// Permission Modes
// ============================================================================

export const PERMISSION_MODES = ['default', 'auto-approve', 'plan'] as const
export type PermissionMode = (typeof PERMISSION_MODES)[number]

// ============================================================================
// Permission Behaviors
// ============================================================================

export type PermissionBehavior = 'allow' | 'deny' | 'ask'

// ============================================================================
// Permission Rules
// ============================================================================

export type PermissionRuleSource =
  | 'globalSettings'
  | 'projectSettings'
  | 'cliArg'
  | 'session'

export interface PermissionRule {
  toolName: string
  ruleContent?: string
  behavior: PermissionBehavior
  source: PermissionRuleSource
}

export interface PermissionRuleValue {
  toolName: string
  ruleContent?: string
}

// ============================================================================
// Permission Decisions
// ============================================================================

export type PermissionDecision =
  | { allowed: true }
  | { allowed: false; reason: string }

// ============================================================================
// Permission Context
// ============================================================================

export interface ToolPermissionContext {
  mode: PermissionMode
  allowRules: PermissionRule[]
  denyRules: PermissionRule[]
  askRules: PermissionRule[]
}
