import { ensureBootstrapMacro } from './bootstrapMacro'

// Set process title as early as possible
try {
  process.title = 'microcode'
  process.argv0 = 'microcode'
} catch {
  // process.title may not be supported on all platforms
}

ensureBootstrapMacro()

await import('./main.tsx')
