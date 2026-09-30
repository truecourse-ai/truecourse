/**
 * The provider registry: every provider the api driver can run on, by kind.
 * Adding a provider is one definition file and one entry here; the record's
 * type refuses a kind with no definition, or a definition filed under another
 * kind.
 */

import type { LlmProviderKind } from '../types.js';
import { anthropic } from './anthropic.js';
import { bedrock } from './bedrock.js';
import { copilot } from './copilot.js';
import type { ProviderDefinition } from './define.js';
import { google } from './google.js';
import { openai } from './openai.js';

const PROVIDERS: { readonly [K in LlmProviderKind]: ProviderDefinition<K> } = {
  anthropic,
  bedrock,
  copilot,
  google,
  openai,
};

export function providerFor(kind: LlmProviderKind): ProviderDefinition {
  return PROVIDERS[kind];
}

/** Every registered provider. */
export function registeredProviders(): readonly ProviderDefinition[] {
  return Object.values(PROVIDERS);
}

export { defineProvider, type ProviderDefinition, type ProviderOptionsBag } from './define.js';
export { COPILOT_PROVIDER_NAME } from './copilot.js';
