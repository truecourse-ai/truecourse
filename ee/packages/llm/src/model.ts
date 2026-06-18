/**
 * Build a Vercel AI SDK language model for a provider config + model id.
 * Anthropic / OpenAI / Bedrock are first-class; GitHub Copilot rides the
 * OpenAI-compatible provider pointed at the Copilot endpoint.
 */

import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';
import type { ProviderConfig } from './types.js';

/** GitHub Copilot's OpenAI-compatible chat endpoint. */
const COPILOT_BASE_URL = 'https://api.githubcopilot.com';

export function buildModel(cfg: ProviderConfig, modelId: string): LanguageModel {
  switch (cfg.provider) {
    case 'anthropic':
      return createAnthropic({
        apiKey: cfg.apiKey,
        baseURL: cfg.baseURL,
        headers: cfg.headers,
      })(modelId);
    case 'openai':
      return createOpenAI({
        apiKey: cfg.apiKey,
        baseURL: cfg.baseURL,
        headers: cfg.headers,
      })(modelId);
    case 'bedrock':
      return createAmazonBedrock({
        region: cfg.region,
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
        sessionToken: cfg.sessionToken,
      })(modelId);
    case 'copilot':
      return createOpenAICompatible({
        name: 'github-copilot',
        baseURL: cfg.baseURL ?? COPILOT_BASE_URL,
        apiKey: cfg.apiKey,
        headers: cfg.headers,
      })(modelId);
  }
}
