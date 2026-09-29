/**
 * Build a Vercel AI SDK language model for a provider config + model id, by
 * the provider's own definition (`providers/`).
 */

import type { LanguageModel } from 'ai';
import { providerFor } from './providers/index.js';
import type { ProviderConfig } from './types.js';

export function buildModel(cfg: ProviderConfig, modelId: string): LanguageModel {
  return providerFor(cfg.provider).buildModel(cfg, modelId);
}
