/**
 * Provider-specific schema, cache, tool-call and reasoning settings.
 * The driver chooses this strategy once per provider. OpenAI-family tools
 * require strict-schema normalization; other providers keep optional fields
 * optional. Google validates the full JSON Schema sent by its SDK adapter.
 */

import type { ModelMessage } from 'ai';
import type { SessionDef } from '@truecourse/agent-loop';
import type { LlmProviderKind } from './types.js';
import type { SchemaCapabilities } from './wire-schema.js';

/**
 * The provider-options namespace GitHub Copilot answers to. The
 * openai-compatible provider derives it from the name it was built with
 * (`provider.split('.')[0]`), so `model.ts` MUST build Copilot under this
 * exact string or the options below are silently dropped.
 */
export const COPILOT_PROVIDER_NAME = 'github-copilot';

/** One `providerOptions` bag: namespace → options, as the AI SDK takes it. */
type ProviderOptionsBag = NonNullable<ModelMessage['providerOptions']>;

export interface ProviderTuning extends SchemaCapabilities {
  /** Provider-specific instructions, ahead of the session's own prompt. */
  sessionInstructions?(def: SessionDef): string;

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
  callOptions(modelId: string, cacheKey: string, sessionKind?: string): ProviderOptionsBag;
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
 *
 * `store: false` is what makes the REPLAY stateless, and it is not an
 * optimization. The driver resends the whole history every turn, and the
 * Responses API takes a replayed reasoning part one of two ways: with `store`
 * left at its default the request carries `{ type: 'item_reference', id:
 * 'rs_…' }`, a pointer the endpoint must still be holding — one that is not
 * (an Azure AI Foundry deployment, a rotated backend) answers "Item with id
 * 'rs_…' not found" and the whole session dies on a validation error it can
 * never retry past. With `store: false` the request carries the reasoning item
 * itself, encrypted content and all, so nothing has to be retained anywhere.
 * That is the whole cost of statelessness and there is no way around it: the
 * item reference is the only smaller form, and it is the one that needs the
 * retention `store: false` gives up. So every turn of a long session re-sends
 * the reasoning of every turn before it, and the wire grows with the square of
 * the transcript.
 *
 * `reasoning.encrypted_content` is what asks the model to hand that encrypted
 * content back, and it is the SDK's ask to make, not ours: it adds the include
 * itself when `store` is false and the model id reads as a reasoning model, and
 * a model that has no reasoning to encrypt REJECTS the parameter outright
 * ("Encrypted content is not supported with this model"), which would be every
 * turn of every session on a `gpt-4o`-class model.
 */
const OPENAI: ProviderTuning = {
  normalizeToolSchema: true,
  callOptions: (_modelId, cacheKey) => ({
    openai: { promptCacheKey: cacheKey, parallelToolCalls: false, store: false },
  }),
};

/**
 * Copilot rides the openai-COMPATIBLE provider, which forwards every option
 * it does not own itself verbatim into the request body. So these are the
 * WIRE names, not the camelCase the first-party openai provider translates.
 */
const COPILOT: ProviderTuning = {
  normalizeToolSchema: true,
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

/** Setup includes the web authoring sessions it dispatches per place. */
function isSetupSession(kind: string | undefined): boolean {
  return kind?.startsWith('guard-setup.') === true || kind === 'guard-interfaces.web-tasks';
}

/**
 * Gemini caches prefixes implicitly and has no parallel-call switch.
 * Gemini 3 setup sessions use high thinking; older models retain their
 * native default because they do not accept thinkingLevel.
 */
const GOOGLE: ProviderTuning = {
  strictTools: true,
  callOptions: (modelId, _cacheKey, sessionKind): ProviderOptionsBag =>
    /^gemini-3[.-]/.test(modelId) && isSetupSession(sessionKind)
      ? { google: { thinkingConfig: { thinkingLevel: 'high' } } }
      : {},
  sessionInstructions: (def) => {
    if (!isSetupSession(def.kind)) return '';
    const checkpoint = def.draftCheckpoint;
    const check = checkpoint?.tool ?? def.outcomePrecondition?.tool;
    return [
      '<session_rules>',
      `Your first grant is ${def.budget.turns} turns. Finish within it when possible; do not rely on an extension.`,
      'Read only the evidence needed for the assigned task. Omit optional tool arguments you do not need; never fill them with empty strings or null unless the schema allows it.',
      ...(check ? [
        `Submit a first draft to \`${check}\` by turn ${checkpoint?.afterTurn ?? Math.max(1, Math.floor(def.budget.turns / 2))}. Use its results to revise the draft.`,
      ] : []),
      'Reserve turns for validation and the outcome. Once the task requirements are satisfied, call `outcome` immediately. Report unresolved findings in the permitted outcome fields; do not invent evidence or claim an unverified result.',
      'When told to wrap up, stop exploring and submit the supported outcome using the session contract.',
      '</session_rules>',
    ].join('\n');
  },
};

const TUNING: Record<LlmProviderKind, ProviderTuning> = {
  anthropic: ANTHROPIC,
  openai: OPENAI,
  copilot: COPILOT,
  bedrock: BEDROCK,
  google: GOOGLE,
};

export function providerTuningFor(provider: LlmProviderKind): ProviderTuning {
  return TUNING[provider];
}
