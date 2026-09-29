/**
 * AWS Bedrock, on the Converse API. Tool schemas go as authored, without
 * `strict`. Credentials are the config's keys, or the ambient AWS chain when
 * they are omitted.
 *
 * `cachePoint` is Bedrock's OWN breakpoint — a Converse-level block, so it is
 * emitted for every model. Parallel tool use is not: Converse has no such
 * field, and the only way through is `additionalModelRequestFields`, which is
 * raw passthrough to the hosted model. That makes it Anthropic-shaped, hence
 * the family gate — sending `tool_choice` to a Nova or Llama model would be
 * a malformed request rather than an ignored option.
 */

import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { defineProvider, type ProviderOptionsBag } from './define.js';

/** Bedrock model ids name the hosted family: `anthropic.claude-…`, with an
 *  optional geography prefix (`us.anthropic.claude-…`). Same test the SDK's
 *  own Bedrock tool path uses. */
function isAnthropicOnBedrock(modelId: string): boolean {
  return modelId.includes('anthropic.');
}

export const bedrock = defineProvider({
  kind: 'bedrock',
  capabilities: {},
  buildModel: (cfg, modelId) =>
    createAmazonBedrock({
      region: cfg.region,
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
      sessionToken: cfg.sessionToken,
    })(modelId),
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
});
