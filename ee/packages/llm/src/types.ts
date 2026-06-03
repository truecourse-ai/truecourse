/** The API providers the enterprise transport can talk to. */
export type LlmProviderKind = 'anthropic' | 'openai' | 'bedrock' | 'copilot';

/**
 * A resolved provider configuration. Built from the stored (decrypted)
 * provider config row, or from env, by `ee-server` — then handed to the
 * transport. No secrets are logged or serialized back out.
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
