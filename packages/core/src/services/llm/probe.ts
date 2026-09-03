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
import { loadSdk } from '@truecourse/llm-claude-agent';
import { resolveClaudeBinary } from '@truecourse/shared';
import type { LlmTransport } from '@truecourse/shared/llm';
import type { GlobalApiLlmConfig } from '../../config/global-config.js';
import { checkClaudeAuth } from '../../lib/cli-binary.js';
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

/**
 * The claude-code counterpart: prove the `claude` binary is installed and
 * logged in (one tiny `claude -p` round-trip) and that the Agent SDK the
 * session driver rides on can be loaded — it is an optional peer, so a missing
 * install would otherwise fail every session identically, one run in. Throws
 * with `claude`'s own words on a refused login.
 */
export async function probeClaudeCode(): Promise<void> {
  const binary = resolveClaudeBinary();
  const result = await checkClaudeAuth(binary);
  if (!result.ok) {
    if (result.reason === 'not-found') {
      throw new Error(`The \`claude\` CLI was not found (looked for \`${binary}\`).`);
    }
    throw new Error(
      result.output || `\`claude\` exited with code ${result.code ?? 'unknown'} during the login probe.`,
    );
  }
  await loadSdk();
}
