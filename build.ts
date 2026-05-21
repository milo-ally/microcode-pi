#!/usr/bin/env bun
/**
 * Build script for microcode.
 * Compiles a standalone executable and installs it to a platform-appropriate location.
 *
 * Usage:
 *   bun run build.ts              # Build + install
 *   bun run build.ts --no-install # Build only (skip install)
 */
import * as path from 'path'
import * as os from 'os'
import { existsSync, mkdirSync, copyFileSync, chmodSync, statSync } from 'fs'

// ============================================================================
// ANSI helpers
// ============================================================================

const ESC = '\x1b'
const RESET = `${ESC}[0m`
const BOLD = `${ESC}[1m`
const DIM = `${ESC}[2m`
const CLEAR_LINE = `${ESC}[2K\r`

const fg = {
  cyan: (s: string) => `${ESC}[36m${s}${RESET}`,
  green: (s: string) => `${ESC}[32m${s}${RESET}`,
  yellow: (s: string) => `${ESC}[33m${s}${RESET}`,
  gray: (s: string) => `${ESC}[90m${s}${RESET}`,
  white: (s: string) => `${ESC}[37m${s}${RESET}`,
  red: (s: string) => `${ESC}[31m${s}${RESET}`,
}

const bold = (s: string) => `${BOLD}${s}${RESET}`
const dim = (s: string) => `${DIM}${s}${RESET}`

function write(s: string) {
  process.stdout.write(s)
}

// ============================================================================
// Progress bar
// ============================================================================

const BAR_WIDTH = 28
const BAR_FILLED = '━'
const BAR_EMPTY = '─'
const SPINNER_FRAMES = ['⣾', '⣽', '⣻', '⢿', '⡿', '⣟', '⣯', '⣷']

function renderBar(ratio: number): string {
  const filled = Math.round(ratio * BAR_WIDTH)
  const empty = BAR_WIDTH - filled
  return fg.cyan(BAR_FILLED.repeat(filled)) + dim(BAR_EMPTY.repeat(empty))
}

// ============================================================================
// Build config
// ============================================================================

const PROJECT_DIR = import.meta.dir
const IS_WINDOWS = process.platform === 'win32'
const BINARY_NAME = IS_WINDOWS ? 'microcode.exe' : 'microcode'
const COMPILED_BINARY = path.join(PROJECT_DIR, 'dist', BINARY_NAME)

function getInstallDir(): string {
  if (IS_WINDOWS) {
    return path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'microcode')
  }
  return path.join(os.homedir(), '.local', 'bin')
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

// ============================================================================
// Build steps
// ============================================================================

interface StepResult {
  modules?: number
  bundleMs?: number
  compileMs?: number
}

async function runBuild(): Promise<StepResult> {
  const result: StepResult = {}
  let spinnerIdx = 0
  let startTime = Date.now()

  // Spawn bun build and capture stderr (where bun writes progress)
  const proc = Bun.spawn({
    cmd: ['bun', 'build', './src/entry.ts', '--compile', '--outfile=' + COMPILED_BINARY],
    cwd: PROJECT_DIR,
    stdout: 'pipe',
    stderr: 'pipe',
  })

  // Read stderr in real time to parse bun's output
  const stderrReader = proc.stderr.getReader()
  const decoder = new TextDecoder()
  let stderrBuf = ''

  const poll = setInterval(() => {
    const elapsed = Date.now() - startTime
    const frame = SPINNER_FRAMES[spinnerIdx++ % SPINNER_FRAMES.length]
    write(`${CLEAR_LINE}  ${fg.cyan(frame)}  ${dim('compiling')} ${renderBar(Math.min(elapsed / 3000, 0.95))} ${dim(formatMs(elapsed))}`)
  }, 80)

  // Consume stderr stream
  while (true) {
    const { done, value } = await stderrReader.read()
    if (done) break
    stderrBuf += decoder.decode(value, { stream: true })
  }

  clearInterval(poll)
  await proc.exited

  // Parse bun's output: "[82ms]  bundle  2261 modules" and "[162ms]  compile"
  const bundleMatch = stderrBuf.match(/\[(\d+)ms\]\s+bundle\s+(\d+)\s+modules/)
  const compileMatch = stderrBuf.match(/\[(\d+)ms\]\s+compile/)

  if (bundleMatch) {
    result.modules = parseInt(bundleMatch[2])
    result.bundleMs = parseInt(bundleMatch[1])
  }
  if (compileMatch) {
    result.compileMs = parseInt(compileMatch[1])
  }

  return result
}

function stepDone(label: string, detail: string) {
  write(`${CLEAR_LINE}  ${fg.green('✓')}  ${bold(label)}  ${dim(detail)}\n`)
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const skipInstall = process.argv.includes('--no-install')
  const startTime = Date.now()

  // Header
  write('\n')
  write(`  ${bold('microcode')} ${dim('build')}\n`)
  write(`  ${dim('─'.repeat(44))}\n\n`)

  // Step 1: Compile
  write(`  ${fg.cyan('◉')}  ${dim('resolving modules...')}\n`)
  const result = await runBuild()

  const moduleInfo = result.modules ? `${result.modules} modules` : ''
  const timingParts = []
  if (result.bundleMs) timingParts.push(`bundle ${formatMs(result.bundleMs)}`)
  if (result.compileMs) timingParts.push(`compile ${formatMs(result.compileMs)}`)
  const timingInfo = timingParts.join(' · ')

  stepDone('compile', [moduleInfo, timingInfo].filter(Boolean).join('  '))

  // Step 2: Verify output
  if (!existsSync(COMPILED_BINARY)) {
    write(`  ${fg.red('✗')}  ${bold('build failed')} — output not found\n\n`)
    process.exit(1)
  }
  const binarySize = statSync(COMPILED_BINARY).size
  stepDone('verify', `${formatBytes(binarySize)}`)

  // Step 3: Install
  if (!skipInstall) {
    const installDir = getInstallDir()
    const installPath = path.join(installDir, BINARY_NAME)

    if (!existsSync(installDir)) {
      mkdirSync(installDir, { recursive: true })
    }

    copyFileSync(COMPILED_BINARY, installPath)
    if (!IS_WINDOWS) {
      chmodSync(installPath, 0o755)
    }

    stepDone('install', installPath)
  }

  // Footer
  const totalMs = Date.now() - startTime
  write(`  ${dim('─'.repeat(44))}\n`)
  write(`  ${fg.green('▲')}  ${bold('done')}  ${dim(formatMs(totalMs))}  `)
  write(dim('·'))
  write(`  ${dim('run')} ${fg.cyan('microcode --help')}\n\n`)

  // Windows PATH hint
  if (!skipInstall && IS_WINDOWS) {
    const installDir = getInstallDir()
    const pathDirs = (process.env.PATH ?? '').split(';')
    if (!pathDirs.includes(installDir)) {
      write(`  ${fg.yellow('!')}  ${dim(`${installDir} is not in PATH`)}\n`)
      write(`  ${dim('  restart your terminal, or run:')}\n`)
      write(`  ${dim('  ')}${fg.cyan(`[Environment]::SetEnvironmentVariable("Path", $env:Path + ";${installDir}", "User")`)}\n\n`)
    }
  }
}

void main()
