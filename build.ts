#!/usr/bin/env bun
/**
 * Build script for microcode.
 * Builds the project and installs a `microcode` CLI wrapper to ~/.local/bin.
 */
import { $ } from 'bun'
import * as path from 'path'
import * as os from 'os'
import { existsSync, mkdirSync, writeFileSync, chmodSync } from 'fs'

const PROJECT_DIR = import.meta.dir
const DIST_ENTRY = path.join(PROJECT_DIR, 'dist', 'bootstrapEntry.js')
const BIN_DIR = path.join(os.homedir(), '.local', 'bin')
const WRAPPER_PATH = path.join(BIN_DIR, 'microcode')

async function build() {
  console.log('Building microcode...')
  await $`bun build ./src/bootstrapEntry.ts --outdir=./dist --target=bun`
  console.log(`  → ${DIST_ENTRY}`)
}

function installWrapper() {
  if (!existsSync(BIN_DIR)) {
    mkdirSync(BIN_DIR, { recursive: true })
  }

  const wrapper = `#!/bin/sh
exec bun run "${DIST_ENTRY}" "$@"
`
  writeFileSync(WRAPPER_PATH, wrapper, { mode: 0o755 })
  chmodSync(WRAPPER_PATH, 0o755)
  console.log(`  → ${WRAPPER_PATH}`)
}

function checkPath() {
  const pathDirs = (process.env.PATH ?? '').split(':')
  if (pathDirs.includes(BIN_DIR)) {
    console.log(`  ${BIN_DIR} is already in PATH`)
  } else {
    console.log(`\n  Add to your shell profile (~/.bashrc, ~/.zshrc, etc.):`)
    console.log(`    export PATH="${BIN_DIR}:$PATH"`)
  }
}

async function main() {
  await build()
  installWrapper()
  checkPath()
  console.log('\nDone! Run `microcode --help` to get started.')
}

void main()
