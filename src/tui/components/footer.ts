import { type Component, truncateToWidth, visibleWidth } from '@earendil-works/pi-tui'
import chalk from 'chalk'
import { execSync } from 'child_process'
import type { Agent, ThinkingLevel } from '@earendil-works/pi-agent-core'

function formatTokens(count: number): string {
  if (count < 1000) return count.toString()
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`
  if (count < 1000000) return `${Math.round(count / 1000)}k`
  if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`
  return `${Math.round(count / 1000000)}M`
}

function getGitBranch(cwd: string): string | null {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
  } catch {
    return null
  }
}

function getContextColor(percentUsed: number): string {
  if (percentUsed >= 85) return '#cc6666'   // red
  if (percentUsed >= 70) return '#cc9966'   // yellow
  return '#669966'                           // green
}

/**
 * Footer component matching pi-coding-agent style:
 * Left: ~/path (branch)  ↑input ↓output $cost  ctx:XX%
 * Right: (provider) model-id
 */
export class FooterComponent implements Component {
  private agent: Agent
  private modelId: string
  private provider: string
  private cwd: string
  private thinkingLevel: ThinkingLevel = 'off'
  private totalInput = 0
  private totalOutput = 0
  private totalCost = 0
  private contextPercent: number | null = null
  private contextTokens: number | null = null
  private contextWindow: number | null = null

  constructor(agent: Agent, modelId: string, provider: string, cwd: string, thinkingLevel?: ThinkingLevel) {
    this.agent = agent
    this.modelId = modelId
    this.provider = provider
    this.cwd = cwd
    if (thinkingLevel) this.thinkingLevel = thinkingLevel
  }

  setThinkingLevel(level: ThinkingLevel): void {
    this.thinkingLevel = level
  }

  addUsage(input: number, output: number, cost: number): void {
    this.totalInput += input
    this.totalOutput += output
    this.totalCost += cost
  }

  setContextUsage(percent: number, tokens: number, contextWindow: number): void {
    this.contextPercent = percent
    this.contextTokens = tokens
    this.contextWindow = contextWindow
  }

  invalidate(): void {}

  render(width: number): string[] {
    // Build left side: cwd (branch) + stats
    let pwd = this.cwd
    const home = process.env.HOME || process.env.USERPROFILE
    if (home && pwd.startsWith(home)) {
      pwd = `~${pwd.slice(home.length)}`
    }

    // Add git branch
    const branch = getGitBranch(this.cwd)
    if (branch) {
      pwd = `${pwd} (${branch})`
    }

    const statsParts: string[] = []
    if (this.totalInput) statsParts.push(`↑${formatTokens(this.totalInput)}`)
    if (this.totalOutput) statsParts.push(`↓${formatTokens(this.totalOutput)}`)
    if (this.totalCost) statsParts.push(`$${this.totalCost.toFixed(3)}`)

    // Add context usage indicator
    if (this.contextPercent !== null && this.contextTokens !== null && this.contextWindow !== null) {
      const ctxColor = getContextColor(this.contextPercent)
      const ctxText = `ctx:${this.contextPercent}%`
      statsParts.push(chalk.hex(ctxColor)(ctxText))
    }

    const statsLeft = statsParts.length > 0
      ? chalk.hex('#666666')(`${pwd}  `) + statsParts.join(chalk.hex('#666666')(' '))
      : chalk.hex('#666666')(pwd)

    // Build right side: (provider) model [thinking]
    const thinkingStr = this.thinkingLevel !== 'off' ? chalk.hex('#00d7ff')(` • ${this.thinkingLevel}`) : ''
    const rightSide = chalk.hex('#666666')(`(${this.provider}) ${this.modelId}`) + thinkingStr

    const statsLeftWidth = visibleWidth(statsLeft)
    const rightSideWidth = visibleWidth(rightSide)
    const minPadding = 2

    let statsLine: string
    if (statsLeftWidth + minPadding + rightSideWidth <= width) {
      const padding = ' '.repeat(width - statsLeftWidth - rightSideWidth)
      statsLine = statsLeft + padding + rightSide
    } else if (statsLeftWidth <= width) {
      statsLine = statsLeft
    } else {
      statsLine = truncateToWidth(statsLeft, width, '...')
    }

    return [statsLine]
  }
}
