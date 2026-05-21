import { ensureBootstrapMacro } from './macro'

// Set process title as early as possible
try {
  process.title = 'microcode'
} catch {
  // process.title may not be supported on all platforms
}

ensureBootstrapMacro()

await import('./main.tsx')
