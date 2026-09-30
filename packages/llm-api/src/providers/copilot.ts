/**
 * GitHub Copilot, on the OpenAI-compatible provider pointed at the Copilot
 * endpoint. Its models are assumed OpenAI-shaped. Tool schemas go as
 * authored, without `strict`.
 *
 * Copilot rides the openai-COMPATIBLE provider, which forwards every option
 * it does not own itself verbatim into the request body. So these are the
 * WIRE names, not the camelCase the first-party openai provider translates.
 */

import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { defineProvider } from './define.js';

/**
 * The provider-options namespace Copilot answers to. The openai-compatible
 * provider derives it from the name it was built with
 * (`provider.split('.')[0]`), so the model MUST be built under this exact
 * string or the call options are silently dropped.
 */
export const COPILOT_PROVIDER_NAME = 'github-copilot';

/** GitHub Copilot's OpenAI-compatible chat endpoint. */
const COPILOT_BASE_URL = 'https://api.githubcopilot.com';

export const copilot = defineProvider({
  kind: 'copilot',
  capabilities: {},
  buildModel: (cfg, modelId) =>
    createOpenAICompatible({
      name: COPILOT_PROVIDER_NAME,
      baseURL: cfg.baseURL ?? COPILOT_BASE_URL,
      apiKey: cfg.apiKey,
      headers: cfg.headers,
    })(modelId),
  callOptions: (_modelId, cacheKey) => ({
    [COPILOT_PROVIDER_NAME]: { prompt_cache_key: cacheKey, parallel_tool_calls: false },
  }),
});
