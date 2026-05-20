import type { Model } from '@earendil-works/pi-ai'

export interface ResolvedConfig {
  model: Model<any>
  apiKey: string
  provider: 'anthropic' | 'openai' | 'custom'
}

function getEnv(key: string): string | undefined {
  return process.env[key]
}

function resolveAnthropicConfig(): { model: Model<'anthropic-messages'>; apiKey: string } | undefined {
  const apiKey = getEnv('ANTHROPIC_API_KEY')
  if (!apiKey) return undefined

  const baseUrl = getEnv('ANTHROPIC_BASE_URL') || 'https://api.deepseek.com/anthropic'
  const modelId = getEnv('ANTHROPIC_MODEL') || 'deepseek-v4-pro'

  return {
    apiKey,
    model: {
      id: modelId,
      name: modelId,
      api: 'anthropic-messages',
      provider: 'anthropic',
      baseUrl,
      reasoning: true,
      input: ['text', 'image'],
      cost: {
        input: 3,
        output: 15,
        cacheRead: 0.3,
        cacheWrite: 3.75,
      },
      contextWindow: 200000,
      maxTokens: 8192,
    },
  }
}

function resolveOpenAIConfig(): { model: Model<'openai-completions'>; apiKey: string } | undefined {
  const apiKey = getEnv('OPENAI_API_KEY')
  if (!apiKey) return undefined

  const baseUrl = getEnv('OPENAI_BASE_URL') || 'https://api.deepseek.com'
  const modelId = getEnv('OPENAI_MODEL') || 'deepseek-v4-pro'

  return {
    apiKey,
    model: {
      id: modelId,
      name: modelId,
      api: 'openai-completions',
      provider: 'openai',
      baseUrl,
      reasoning: false,
      input: ['text', 'image'],
      cost: {
        input: 2.5,
        output: 10,
        cacheRead: 0,
        cacheWrite: 0,
      },
      contextWindow: 128000,
      maxTokens: 16384,
    },
  }
}

function resolveFallbackConfig(): { model: Model<'openai-completions'>; apiKey: string } | undefined {
  const apiKey = getEnv('API_KEY')
  if (!apiKey) return undefined

  const baseUrl = getEnv('BASE_URL') || 'https://api.deepseek.com'
  const modelId = getEnv('MODEL') || 'deepseek-v4-pro'

  return {
    apiKey,
    model: {
      id: modelId,
      name: modelId,
      api: 'openai-completions',
      provider: 'custom',
      baseUrl,
      reasoning: false,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 16384,
    },
  }
}

export function resolveConfig(): ResolvedConfig {
  const anthropic = resolveAnthropicConfig()
  if (anthropic) {
    return {
      model: anthropic.model,
      apiKey: anthropic.apiKey,
      provider: 'anthropic',
    }
  }

  const openai = resolveOpenAIConfig()
  if (openai) {
    return {
      model: openai.model,
      apiKey: openai.apiKey,
      provider: 'openai',
    }
  }

  const fallback = resolveFallbackConfig()
  if (fallback) {
    return {
      model: fallback.model,
      apiKey: fallback.apiKey,
      provider: 'custom',
    }
  }

  throw new Error(
    'No API key found. Set one of:\n' +
      '  ANTHROPIC_API_KEY (with optional ANTHROPIC_BASE_URL, ANTHROPIC_MODEL)\n' +
      '  OPENAI_API_KEY (with optional OPENAI_BASE_URL, OPENAI_MODEL)\n' +
      '  API_KEY (fallback)',
  )
}

export function getApiKeyForProvider(provider: string): string | undefined {
  switch (provider) {
    case 'anthropic':
      return getEnv('ANTHROPIC_API_KEY')
    case 'openai':
      return getEnv('OPENAI_API_KEY')
    default:
      return getEnv('API_KEY') || getEnv('OPENAI_API_KEY') || getEnv('ANTHROPIC_API_KEY')
  }
}

/**
 * Create a Model object for a given model ID, inferring the provider from available env vars.
 */
export function createModelForId(modelId: string): { model: Model<any>; apiKey: string; provider: string } {
  // Try anthropic first
  const anthropicKey = getEnv('ANTHROPIC_API_KEY')
  if (anthropicKey) {
    const baseUrl = getEnv('ANTHROPIC_BASE_URL') || 'https://api.deepseek.com/anthropic'
    return {
      apiKey: anthropicKey,
      provider: 'anthropic',
      model: {
        id: modelId,
        name: modelId,
        api: 'anthropic-messages',
        provider: 'anthropic',
        baseUrl,
        reasoning: true,
        input: ['text', 'image'],
        cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
        contextWindow: 200000,
        maxTokens: 8192,
      },
    }
  }

  // Try openai
  const openaiKey = getEnv('OPENAI_API_KEY')
  if (openaiKey) {
    const baseUrl = getEnv('OPENAI_BASE_URL') || 'https://api.deepseek.com'
    return {
      apiKey: openaiKey,
      provider: 'openai',
      model: {
        id: modelId,
        name: modelId,
        api: 'openai-completions',
        provider: 'openai',
        baseUrl,
        reasoning: false,
        input: ['text', 'image'],
        cost: { input: 2.5, output: 10, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 16384,
      },
    }
  }

  // Fallback
  const fallbackKey = getEnv('API_KEY')
  if (fallbackKey) {
    const baseUrl = getEnv('BASE_URL') || 'https://api.deepseek.com'
    return {
      apiKey: fallbackKey,
      provider: 'custom',
      model: {
        id: modelId,
        name: modelId,
        api: 'openai-completions',
        provider: 'custom',
        baseUrl,
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 16384,
      },
    }
  }

  throw new Error('No API key found. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or API_KEY.')
}
