/**
 * Model registry — static model definitions matching pi-ai's models.generated.ts.
 *
 * Only 4 models are exposed: deepseek-v4-pro, deepseek-v4-flash, mimo-v2.5, mimo-v2.5-pro.
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
  }
] as Model<Api>[]

// Default model when no env var is set
const DEFAULT_MODEL_ID = MODELS[0].id

// Env var names for provider configuration
const ENV_KEYS = {
  apiKey: ['API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'],
  baseUrl: ['BASE_URL', 'OPENAI_BASE_URL', 'ANTHROPIC_BASE_URL'],
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
 * Apply environment variable overrides to a model.
 * - BASE_URL / OPENAI_BASE_URL / ANTHROPIC_BASE_URL → override baseUrl
 */
function applyEnvOverrides(model: Model<Api>): Model<Api> {
  const baseUrl = findEnvValue(ENV_KEYS.baseUrl)
  if (!baseUrl) return model
  return { ...model, baseUrl }
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
  const apiKey = resolveApiKey(model)
  if (!apiKey) {
    throw new Error(
      `No API key found for model "${model.id}" (provider: ${model.provider}).\n` +
        'Set API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY.',
    )
  }
  return { model, apiKey }
}
