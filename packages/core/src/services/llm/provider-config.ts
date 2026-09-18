/**
 * How a run reaches the model.
 *
 * A workspace names ONE provider, stored encrypted (`llm_provider_config`) and
 * loaded per run by the server, which threads the resulting transport and
 * session driver into the pipeline call. Nothing in the engine reads a provider
 * by itself, and no provider is a process-wide default — except in OPERATOR
 * MODE, where `TRUECOURSE_LLM_TRANSPORT=claude-code` runs every workspace on
 * the operator's own `claude` login.
 */

import type { LlmProviderKind } from '@truecourse/shared';

/** The two ways a run reaches a model. */
export type LlmTransportMode = 'claude-code' | 'api';

/** A workspace's stored provider block, decrypted. */
export interface LlmApiConfig {
  provider: LlmProviderKind;
  /** Provider-specific model id — required, used by every stage. */
  model: string;
  /** Optional secondary model, tried once if the primary call errors. */
  fallbackModel?: string;
  /**
   * The list-price model id {@link LlmApiConfig.model} serves, when the model
   * id itself is not one — a deployment name behind a gateway prices as the
   * model it deploys. Nothing on the Models page sets it yet.
   */
  priceModel?: string;
  /** The key itself; the Models page refuses to save a config without one. Bedrock omits it for the AWS chain. */
  apiKey?: string;
  /** Gateway / self-hosted endpoint speaking the provider's protocol. */
  baseURL?: string;
  headers?: Record<string, string>;
  // --- AWS Bedrock (omit to use the ambient AWS credential chain) ---
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
}
