import { ensureBootstrapMacro } from './bootstrapMacro'

ensureBootstrapMacro()

await import('./main.tsx')
