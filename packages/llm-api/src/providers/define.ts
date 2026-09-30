/**
 * What a provider IS to the api driver: how to build its model, what it can
 * enforce of a tool schema, and the provider options it wants on a message and
 * on a call. One definition per provider, one file each beside this one; the
 * driver reads the definition and never names a provider itself.
 *
 * A definition never sees a session: what a session wants of it (a reasoning
 * level) arrives as plain data, so provider knowledge and session knowledge do
 * not mix.
 */

import type { LanguageModel, ModelMessage } from 'ai';
import type { ReasoningLevel } from '@truecourse/agent-loop';
import type { LlmProviderKind, ProviderConfig } from '../types.js';
import type { SchemaCapabilities } from '../wire-schema.js';

/** One `providerOptions` bag: namespace → options, as the AI SDK takes it. */
export type ProviderOptionsBag = NonNullable<ModelMessage['providerOptions']>;

export interface ProviderDefinition<K extends LlmProviderKind = LlmProviderKind> {
  readonly kind: K;
  /** What this provider asks of, and can enforce of, a tool schema. */
  readonly capabilities: SchemaCapabilities;
  buildModel(cfg: ProviderConfig, modelId: string): LanguageModel;
  /**
   * Merged onto a message that CLOSES a cacheable prefix — the system prompt
   * and the moving tail. Absent for the providers that key their cache per
   * request rather than per message: to them a breakpoint means nothing.
   */
  readonly breakpoint?: ProviderOptionsBag;
  /**
   * What rides the call itself: the prompt-cache cluster key where the
   * provider takes one, and the one-tool-per-turn ask. `modelId` is the
   * candidate actually being called.
   */
  callOptions(modelId: string, cacheKey: string): ProviderOptionsBag;
  /**
   * A session's declared reasoning level, as this provider's own setting for
   * `modelId`. Absent ⇒ the provider's default for every level.
   */
  reasoning?(modelId: string, level: ReasoningLevel): ProviderOptionsBag;
}

/** A provider definition, its `kind` kept literal so the registry can hold it to its key. */
export function defineProvider<K extends LlmProviderKind>(definition: ProviderDefinition<K>): ProviderDefinition<K> {
  return definition;
}
