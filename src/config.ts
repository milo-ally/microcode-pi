/**
 * Configuration — thin wrapper around the model registry.
 *
 * All model resolution logic lives in src/models/registry.ts.
 * This module provides backward-compatible API for callers that haven't migrated yet.
 */

import type { Api, Model } from '@earendil-works/pi-ai'
import { getAllModels, getModelConfig, setCurrentModel } from './models/index.ts'

/**
 * @deprecated Use getModelConfig() from models/index.ts directly.
 */
export interface ResolvedConfig {
  model: Model<Api>
  apiKey: string
  provider: string
}

/**
 * @deprecated Use getModelConfig() from models/index.ts directly.
 */
export function resolveConfig(): ResolvedConfig {
  const { model, apiKey } = getModelConfig()
  return { model, apiKey, provider: model.provider }
}

/**
 * @deprecated Use getModelConfig(modelId) from models/index.ts directly.
 */
export function getApiKeyForProvider(provider: string): string | undefined {
  const { model, apiKey } = getModelConfig()
  if (provider === model.provider) return apiKey
  return process.env.API_KEY
}

/**
 * Find a model by ID from the registry and resolve its config.
 * Used by --model CLI flag and /model command.
 *
 * @param api - If provided, disambiguate between protocols for the same model ID.
 */
export function createModelForId(modelId: string, api?: Api): ResolvedConfig {
  const { model, apiKey } = getModelConfig(modelId, api)
  setCurrentModel(model)
  return { model, apiKey, provider: model.provider }
}

/**
 * Get list of available model IDs for display.
 */
export function getAvailableModelIds(): string[] {
  return getAllModels().map((m: Model<Api>) => m.id)
}
