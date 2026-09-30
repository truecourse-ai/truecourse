/**
 * Anthropic, first-party. Tool schemas go as authored, without `strict`.
 *
 * Two of the four cache breakpoints the provider allows, which is all the
 * driver has use for: the system prompt (stable for the session) and the
 * moving tail (everything the turns have added). The tool list renders BEFORE
 * the system prompt, so the system breakpoint already covers it; a third one
 * on the tools would only pay off if the system prompt changed mid-session,
 * and it never does.
 */

import { createAnthropic } from '@ai-sdk/anthropic';
import { defineProvider } from './define.js';

export const anthropic = defineProvider({
  kind: 'anthropic',
  capabilities: {},
  buildModel: (cfg, modelId) =>
    createAnthropic({ apiKey: cfg.apiKey, baseURL: cfg.baseURL, headers: cfg.headers })(modelId),
  breakpoint: { anthropic: { cacheControl: { type: 'ephemeral' } } },
  callOptions: () => ({ anthropic: { disableParallelToolUse: true } }),
});
