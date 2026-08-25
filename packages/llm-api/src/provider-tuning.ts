/**
 * PER-PROVIDER PROMPT-CACHE AND TOOL-CALL TUNING (item 7).
 *
 * The session driver resends the whole history every turn, so what the
 * provider is told about caching decides the bill, and what it is told about
 * parallel tool calls decides whether the transcript schema (ONE tool call
 * per turn) holds. Both answers are provider-specific, and both are declared
 * here as data chosen ONCE from `cfg.provider` — the call site reads a
 * strategy, it never asks which provider it is talking to.
 *
 * The two axes are one object because they are one decision per provider:
 * where a cacheable prefix ends, and what must ride the request itself.
 *
 * Names below are the AI SDK's, verified against the installed typings:
 * `@ai-sdk/anthropic@3` (`cacheControl`, `disableParallelToolUse`),
 * `@ai-sdk/openai@3` (`promptCacheKey`, `parallelToolCalls` — on both the
 * chat and the responses options), `@ai-sdk/amazon-bedrock@4` (`cachePoint`,
 * `additionalModelRequestFields`) and `@ai-sdk/openai-compatible@2`.
 */

import type { ModelMessage } from 'ai';
import type { LlmProviderKind } from './types.js';

/**
 * The provider-options namespace GitHub Copilot answers to. The
 * openai-compatible provider derives it from the name it was built with
 * (`provider.split('.')[0]`), so `model.ts` MUST build Copilot under this
 * exact string or the options below are silently dropped.
 */
export const COPILOT_PROVIDER_NAME = 'github-copilot';

/** One `providerOptions` bag: namespace → options, as the AI SDK takes it. */
type ProviderOptionsBag = NonNullable<ModelMessage['providerOptions']>;

export interface ProviderTuning {
  /**
   * Merged onto a message that CLOSES a cacheable prefix — the system prompt
   * and the moving tail. Absent for the providers that key their cache per
   * request rather than per message: to them a breakpoint means nothing.
   */
  readonly breakpoint?: ProviderOptionsBag;
  /**
   * What rides the call itself: the prompt-cache cluster key where the
   * provider takes one, and the one-tool-per-turn ask. `modelId` is the
   * candidate actually being called — under Bedrock the tool option is the
   * hosted model FAMILY's native field, not one of Bedrock's own.
   */
  callOptions(modelId: string, cacheKey: string): ProviderOptionsBag;
}

/**
 * Two of the four breakpoints the provider allows, which is all this driver
 * has use for: the system prompt (stable for the session) and the moving
 * tail (everything the turns have added). The tool list renders BEFORE the
 * system prompt, so the system breakpoint already covers it; a third one on
 * the tools would only pay off if the system prompt changed mid-session, and
 * it never does.
 */
const ANTHROPIC: ProviderTuning = {
  breakpoint: { anthropic: { cacheControl: { type: 'ephemeral' } } },
  callOptions: () => ({ anthropic: { disableParallelToolUse: true } }),
};

/**
 * OpenAI caches by PREFIX automatically and takes no breakpoints; the key is
 * a routing hint that keeps calls sharing a prefix on the same machine, so it
 * belongs to the cluster of calls, not to a message.
 */
const OPENAI: ProviderTuning = {
  callOptions: (_modelId, cacheKey) => ({
    openai: { promptCacheKey: cacheKey, parallelToolCalls: false },
  }),
};

/**
 * Copilot rides the openai-COMPATIBLE provider, which forwards every option
 * it does not own itself verbatim into the request body. So these are the
 * WIRE names, not the camelCase the first-party openai provider translates.
 */
const COPILOT: ProviderTuning = {
  callOptions: (_modelId, cacheKey) => ({
    [COPILOT_PROVIDER_NAME]: { prompt_cache_key: cacheKey, parallel_tool_calls: false },
  }),
};

/** Bedrock model ids name the hosted family: `anthropic.claude-…`, with an
 *  optional geography prefix (`us.anthropic.claude-…`). Same test the SDK's
 *  own Bedrock tool path uses. */
function isAnthropicOnBedrock(modelId: string): boolean {
  return modelId.includes('anthropic.');
}

/**
 * `cachePoint` is Bedrock's OWN breakpoint — a Converse-level block, so it is
 * emitted for every model. Parallel tool use is not: Converse has no such
 * field, and the only way through is `additionalModelRequestFields`, which is
 * raw passthrough to the hosted model. That makes it Anthropic-shaped, hence
 * the family gate — sending `tool_choice` to a Nova or Llama model would be
 * a malformed request rather than an ignored option.
 */
const BEDROCK: ProviderTuning = {
  breakpoint: { bedrock: { cachePoint: { type: 'default' } } },
  callOptions: (modelId): ProviderOptionsBag =>
    isAnthropicOnBedrock(modelId)
      ? {
          bedrock: {
            additionalModelRequestFields: {
              tool_choice: { type: 'auto', disable_parallel_tool_use: true },
            },
          },
        }
      : {},
};

const TUNING: Record<LlmProviderKind, ProviderTuning> = {
  anthropic: ANTHROPIC,
  openai: OPENAI,
  copilot: COPILOT,
  bedrock: BEDROCK,
};

export function providerTuningFor(provider: LlmProviderKind): ProviderTuning {
  return TUNING[provider];
}
