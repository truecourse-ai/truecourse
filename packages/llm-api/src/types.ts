import type { LlmProviderKind } from '@truecourse/shared';

export type { LlmProviderKind };

/**
 * A resolved provider configuration. Built from the stored, decrypted provider
 * config row — then handed to the transport. No secrets are logged or
 * serialized back out.
 */
export interface ProviderConfig {
  provider: LlmProviderKind;
  /**
   * Provider-specific model id, e.g. `claude-3-7-sonnet-latest` (anthropic),
   * `gpt-4o` (openai), `anthropic.claude-3-7-sonnet-20250219-v1:0` (bedrock).
   */
  model: string;
  /** Optional secondary model, tried only if the primary call errors. */
  fallbackModel?: string;
  /**
   * The LIST-PRICE model id {@link ProviderConfig.model} serves, when the model
   * id itself is not one — an Azure AI Foundry deployment name
   * (`gpt-5.6-sol-2`) prices as the model behind it (`gpt-5.6-sol`). Only the
   * config's own model is mapped; a fallback call prices under its own id.
   */
  priceModel?: string;
  /** API key — anthropic / openai / copilot. */
  apiKey?: string;
  /**
   * Custom base URL. Required for Copilot is defaulted; can also point at a
   * self-hosted gateway (LiteLLM/Portkey) speaking the provider's protocol.
   */
  baseURL?: string;
  /** Extra request headers (e.g. Copilot integration headers). */
  headers?: Record<string, string>;
  // --- AWS Bedrock (omit to use the ambient AWS credential chain / IAM role) ---
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
}
