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

  // --- deepseek provider (openai format) ---
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
  } satisfies Model<"openai-completions">,
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
  } satisfies Model<"openai-completions">,

  // --- deepseek provider (anthropic format) ---
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    api: 'anthropic-messages',
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com/anthropic',
    reasoning: true,
    thinkingLevelMap: { minimal: null, low: null, medium: null, high: 'high', xhigh: 'max' },
    input: ['text'],
    cost: { input: 0.435, output: 0.87, cacheRead: 0.003625, cacheWrite: 0 },
    contextWindow: 1000000,
    maxTokens: 384000,
  } satisfies Model<"anthropic-messages">,
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    api: 'anthropic-messages',
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com/anthropic',
    reasoning: true,
    thinkingLevelMap: { minimal: null, low: null, medium: null, high: 'high', xhigh: 'max' },
    input: ['text'],
    cost: { input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: 0 },
    contextWindow: 1000000,
    maxTokens: 384000,
  } satisfies Model<"anthropic-messages">,

  // --- xiaomimimo provider (openai format) ---
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

  // --- xiaomimimo provider (anthropic format) ---
  {
    id: 'mimo-v2.5',
    name: 'MiMo V2.5',
    api: 'anthropic-messages',
    provider: 'xiaomimimo',
    baseUrl: 'https://api.xiaomimimo.com/anthropic',
    reasoning: true,
    thinkingLevelMap: { minimal: null, low: null, medium: null, high: 'high', xhigh: 'max' },
    input: ['text', 'image'],
    cost: { input: 0.4, output: 2, cacheRead: 0.08, cacheWrite: 0 },
    contextWindow: 1000000,
    maxTokens: 128000,
  } satisfies Model<"anthropic-messages">,
  {
    id: 'mimo-v2.5-pro',
    name: 'MiMo V2.5 Pro',
    api: 'anthropic-messages',
    provider: 'xiaomimimo',
    baseUrl: 'https://api.xiaomimimo.com/anthropic',
    reasoning: true,
    thinkingLevelMap: { minimal: null, low: null, medium: null, high: 'high', xhigh: 'max' },
    input: ['text'],
    cost: { input: 1, output: 3, cacheRead: 0.2, cacheWrite: 0 },
    contextWindow: 1048576,
    maxTokens: 128000,
  } satisfies Model<"anthropic-messages">,

  // --- google provider (google-generative-ai format) ---
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

// Env var names for model selection
const MODEL_ENV_KEYS = ['OPENAI_MODEL', 'ANTHROPIC_MODEL', 'GEMINI_MODEL', 'MODEL'] as const

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
 * - GEMINI_BASE_URL: only for google-generative-ai models
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
  if (model.api === 'google-generative-ai') {
    const geminiBase = getEnv('GEMINI_BASE_URL')
    if (geminiBase) return { ...model, baseUrl: geminiBase }
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
 * Guess the preferred API protocol from environment variables.
 * Returns the protocol implied by env vars, or undefined if ambiguous.
 */
function preferredApiFromEnv(): Api | undefined {
  const protos: { api: Api; check: boolean }[] = [
    { api: 'anthropic-messages', check: !!getEnv('ANTHROPIC_BASE_URL') || !!getEnv('ANTHROPIC_API_KEY') },
    { api: 'google-generative-ai', check: !!getEnv('GEMINI_BASE_URL') || !!getEnv('GEMINI_API_KEY') },
    { api: 'openai-completions', check: !!getEnv('OPENAI_BASE_URL') || !!getEnv('OPENAI_API_KEY') },
  ]
  const active = protos.filter(p => p.check)
  return active.length === 1 ? active[0].api : undefined
}

/**
 * Get the current active model.
 * Resolution order: MODEL/OPENAI_MODEL/ANTHROPIC_MODEL env var → default deepseek-v4-pro.
 *
 * When multiple models share the same ID (different API protocols):
 * 1. If only one protocol's env vars are set, prefer that protocol
 * 2. Otherwise default to openai-completions
 */
export function getCurrentModel(): Model<Api> {
  if (_currentModel) return _currentModel

  const envModelId = findEnvValue(MODEL_ENV_KEYS)

  let candidates: Model<Api>[]

  if (envModelId) {
    candidates = MODELS.filter((m) => m.id === envModelId)
    if (candidates.length === 0) {
      // Fallback: partial match
      candidates = MODELS.filter((m) => m.id.includes(envModelId) || envModelId.includes(m.id))
    }
  } else {
    candidates = MODELS.filter((m) => m.id === DEFAULT_MODEL_ID)
  }

  if (candidates.length === 0) {
    throw new Error('No model found.')
  }

  // When multiple models share the same ID, pick by protocol
  let base: Model<Api>
  if (candidates.length === 1) {
    base = candidates[0]
  } else {
    const preferred = preferredApiFromEnv()
    base = preferred
      ? candidates.find((m) => m.api === preferred) ?? candidates[0]
      : candidates[0]
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
 * When multiple models share the same ID (different API protocols),
 * pass `api` to disambiguate. Without `api`, returns the first match.
 */
export function findModel(modelId: string, api?: Api): Model<Api> | undefined {
  const all = getAllModels()
  if (api) return all.find((m) => m.id === modelId && m.api === api)
  return all.find((m) => m.id === modelId)
}

/**
 * Resolve API key by the model's API protocol.
 * Each protocol has one env var, with API_KEY as universal fallback.
 */
export function resolveApiKey(model: Model<Api>): string | undefined {
  const keyByApi: Partial<Record<Api, string>> = {
    'openai-completions': getEnv('OPENAI_API_KEY'),
    'anthropic-messages': getEnv('ANTHROPIC_API_KEY'),
    'google-generative-ai': getEnv('GEMINI_API_KEY'),
  }
  return keyByApi[model.api] ?? getEnv('API_KEY')
}

/**
 * Resolve a fully-configured ModelConfig for the current or specified model.
 * This is the primary entry point — all model capability info comes from here.
 *
 * @param modelId - If provided, resolve this specific model. Otherwise use current model.
 * @param api - If provided (with modelId), disambiguate between protocols for the same model ID.
 */
export function getModelConfig(modelId?: string, api?: Api): ModelConfig {
  const model = modelId ? findModel(modelId, api) ?? getCurrentModel() : getCurrentModel()
  const apiKey = resolveApiKey(model) ?? ''
  return { model, apiKey }
}
