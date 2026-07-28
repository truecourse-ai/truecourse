/**
 * Live validation of a candidate API-transport configuration: one tiny call
 * that proves the credentials, endpoint, and model id all resolve and answer.
 *
 * Same semantics the enterprise Models page uses before it persists a provider
 * (`ee/packages/server/src/llm/index.ts`), so a config accepted in one edition
 * is accepted in the other. It lives in core rather than the CLI so the CLI
 * (`config llm setup` / `config llm test`) and any future caller share it.
 *
 * Nothing is recorded and nothing is priced — the probe is not a pipeline call.
 */

import { createApiTransport, type ProviderConfig } from '@truecourse/llm-api';
import type { LlmTransport } from '@truecourse/shared/llm';
import type { GlobalApiLlmConfig } from '../../config/global-config.js';
import { buildProviderConfig } from './install-transport.js';

/** Timeout for the probe call — long enough for a cold provider, short enough to fail fast. */
const PROBE_TIMEOUT_MS = 30_000;

export interface ProbeApiConfigOptions {
  /** Build the transport under test. Overridden by tests; defaults to the real one. */
  createTransport?: (cfg: ProviderConfig) => LlmTransport;
}

/**
 * Run the probe against a candidate API block. Resolves when the provider
 * answers; throws `LlmApiConfigError` when the block itself is unusable, or the
 * provider's own error when the call fails.
 */
export async function probeApiConfig(
  api: GlobalApiLlmConfig,
  opts: ProbeApiConfigOptions = {},
): Promise<void> {
  const cfg = buildProviderConfig(api);
  const transport = (opts.createTransport ?? ((c) => createApiTransport(c)))(cfg);
  const text = await transport({
    system: 'You are a configuration probe.',
    user: 'Reply with exactly {"ok": true}.',
    responseFormat: 'json',
    timeoutMs: PROBE_TIMEOUT_MS,
  });
  // A non-empty completion confirms the credentials + model resolve and respond.
  if (typeof text !== 'string' || text.trim() === '') {
    throw new Error('provider returned an empty response');
  }
}
