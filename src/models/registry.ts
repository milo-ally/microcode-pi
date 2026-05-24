/**
 * Model registry — static model definitions matching pi-ai's models.generated.ts.
 *
 * 7 models exposed: deepseek-v4-pro/flash, mimo-v2.5/pro, gemini-2.5-pro/flash/flash-lite.
 * Providers switch automatically with model selection.
 * Environment variables override baseUrl and provide API keys.
 */

import { type Api, type Model } from '@earendil-works/pi-ai'

// ============================================================================
// Model definitions (from models.generated.ts)
// ============================================================================

const MODELS: Model<Api>[] = [
  // --- deepseek provider ---
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    api: 'openai-completions',
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com',
    compat: { requiresReasoningContentOnAssistantMessages: true, thinkingFormat: 'deepseek' },
    reasoning: true,
    thinkingLevelMap: { minimal: null, low: null, medium: null, high: 'high', xhigh: 'max' },
    input: ['text'],
    cost: { input: 0.435, output: 0.87, cacheRead: 0.003625, cacheWrite: 0 },
    contextWindow: 1000000,
    maxTokens: 384000,
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    api: 'openai-completions',
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com',
    compat: { requiresReasoningContentOnAssistantMessages: true, thinkingFormat: 'deepseek' },
    reasoning: true,
    thinkingLevelMap: { minimal: null, low: null, medium: null, high: 'high', xhigh: 'max' },
    input: ['text'],
    cost: { input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: 0 },
    contextWindow: 1000000,
    maxTokens: 384000,
  },
  // --- xiaomimimo provider ---
  {
    id: 'mimo-v2.5',
    name: 'MiMo V2.5',
    api: 'openai-completions',
    provider: 'xiaomimimo',
    baseUrl: 'https://api.xiaomimimo.com/v1',
    compat: { requiresReasoningContentOnAssistantMessages: true, thinkingFormat: 'deepseek' },
    reasoning: true,
    thinkingLevelMap: { minimal: null, low: null, medium: null, high: 'high', xhigh: 'max' },
    input: ['text', 'image'],
    cost: { input: 0.4, output: 2, cacheRead: 0.08, cacheWrite: 0 },
    contextWindow: 1000000,
    maxTokens: 128000,
  },
  {
    id: 'mimo-v2.5-pro',
    name: 'MiMo V2.5 Pro',
    api: 'openai-completions',
    provider: 'xiaomimimo',
    baseUrl: 'https://api.xiaomimimo.com/v1',
    compat: { requiresReasoningContentOnAssistantMessages: true, thinkingFormat: 'deepseek' },
    reasoning: true,
    thinkingLevelMap: { minimal: null, low: null, medium: null, high: 'high', xhigh: 'max' },
    input: ['text'],
    cost: { input: 1, output: 3, cacheRead: 0.2, cacheWrite: 0 },
    contextWindow: 1048576,
    maxTokens: 128000,
  },
  // --- google provider (Gemini, via google-generative-ai protocol) ---
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    api: 'google-generative-ai',
    provider: 'google',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
    contextWindow: 1048576,
    maxTokens: 65536,
  },
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    api: 'google-generative-ai',
    provider: 'google',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 0.3, output: 2.5, cacheRead: 0.03, cacheWrite: 0 },
    contextWindow: 1048576,
    maxTokens: 65536,
  },
  {
    id: 'gemini-2.5-flash-lite',
    name: 'Gemini 2.5 Flash Lite',
    api: 'google-generative-ai',
    provider: 'google',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 0.1, output: 0.4, cacheRead: 0.01, cacheWrite: 0 },
    contextWindow: 1048576,
    maxTokens: 65536,
  }
] as Model<Api>[]

// Default model when no env var is set
const DEFAULT_MODEL_ID = MODELS[0].id

// Env var names for provider configuration
const ENV_KEYS = {
  apiKey: ['API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'],
  model: ['MODEL', 'OPENAI_MODEL', 'ANTHROPIC_MODEL'],
} as const

function getEnv(key: string): string | undefined {
  return process.env[key]
}

function findEnvValue(keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const val = getEnv(key)
    if (val) return val
  }
  return undefined
}

/**
 * Apply environment variable overrides to a model's baseUrl.
 * - BASE_URL: global override, applies to all models
 * - OPENAI_BASE_URL: only for openai-completions models
 * - ANTHROPIC_BASE_URL: only for anthropic-messages models
 *
 * This prevents e.g. OPENAI_BASE_URL (an OpenAI-compatible proxy) from
 * breaking Gemini or Anthropic native API endpoints.
 */
function applyEnvOverrides(model: Model<Api>): Model<Api> {
  // Global override — applies unconditionally
  const globalBase = getEnv('BASE_URL')
  if (globalBase) return { ...model, baseUrl: globalBase }

  // Protocol-specific overrides
  if (model.api === 'openai-completions') {
    const openaiBase = getEnv('OPENAI_BASE_URL')
    if (openaiBase) return { ...model, baseUrl: openaiBase }
  }
  if (model.api === 'anthropic-messages') {
    const anthropicBase = getEnv('ANTHROPIC_BASE_URL')
    if (anthropicBase) return { ...model, baseUrl: anthropicBase }
  }

  return model
}

// ============================================================================
// ModelConfig — unified model + capabilities + API key
// ============================================================================

/**
 * Unified model configuration. All runtime-necessary model information
 * lives here. This is the single source of truth for model capabilities.
 */
export interface ModelConfig {
  model: Model<Api> // including id, provider, name, api, baseUrl, compat, reasoning, thinkingLevelMap, input, cost, contextWindow, maxTokens
  apiKey: string
}

// Singleton state
let _currentModel: Model<Api> | undefined

/**
 * Get all available models (with env overrides applied).
 */
export function getAllModels(): Model<Api>[] {
  return MODELS.map(applyEnvOverrides)
}

/**
 * Get the current active model.
 * Resolution order: MODEL/OPENAI_MODEL/ANTHROPIC_MODEL env var → default deepseek-v4-pro.
 */
export function getCurrentModel(): Model<Api> {
  if (_currentModel) return _currentModel

  const envModelId = findEnvValue(ENV_KEYS.model)

  let base: Model<Api> | undefined

  if (envModelId) {
    base = MODELS.find((m) => m.id === envModelId)
    if (!base) {
      // Fallback: partial match
      base = MODELS.find((m) => m.id.includes(envModelId) || envModelId.includes(m.id))
    }
  }

  if (!base) {
    base = MODELS.find((m) => m.id === DEFAULT_MODEL_ID)
  }

  if (!base) {
    throw new Error('No model found.')
  }

  _currentModel = applyEnvOverrides(base)
  return _currentModel
}

/**
 * Set the current model (e.g., from /model command).
 */
export function setCurrentModel(model: Model<Api>): void {
  _currentModel = model
}

/**
 * Find a model by id from the available models list.
 */
export function findModel(modelId: string): Model<Api> | undefined {
  const all = getAllModels()
  return all.find((m) => m.id === modelId)
}

/**
 * Resolve API key for a model's provider.
 * Checks provider-specific env vars first, then fallback.
 */
export function resolveApiKey(model: Model<Api>): string | undefined {
  // Provider-specific keys
  const providerKey = getEnv(`${model.provider.toUpperCase().replace(/-/g, '_')}_API_KEY`)
  if (providerKey) return providerKey

  // Gemini API key convention (provider=google → GEMINI_API_KEY)
  if (model.provider === 'google') {
    const geminiKey = getEnv('GEMINI_API_KEY')
    if (geminiKey) return geminiKey
  }

  // Common keys
  return findEnvValue(ENV_KEYS.apiKey)
}

/**
 * Resolve a fully-configured ModelConfig for the current or specified model.
 * This is the primary entry point — all model capability info comes from here.
 *
 * @param modelId - If provided, resolve this specific model. Otherwise use current model.
 */
export function getModelConfig(modelId?: string): ModelConfig {
  const model = modelId ? findModel(modelId) ?? getCurrentModel() : getCurrentModel()
  const apiKey = resolveApiKey(model) ?? ''
  return { model, apiKey }
}
