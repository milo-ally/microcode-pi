import type { Api, Model } from '@earendil-works/pi-ai'

export {
  getAllModels,
  getCurrentModel,
  setCurrentModel,
  findModel,
  resolveApiKey,
  getModelConfig,
  type ModelConfig,
} from './registry.ts'

export function modelSupportsImages(model: Model<Api>): boolean {
  return model.input.includes('image')
}
