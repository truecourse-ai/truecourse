/**
 * The PROVIDER PROBE — one tiny call that proves a provider block answers.
 *
 * It is not a pipeline call and never becomes one: nothing is recorded, nothing
 * is priced, no tool is offered and no transcript is written. The Models page
 * runs it before it stores a block, and every run runs it before it spends, so
 * a block accepted in one place is accepted in the other.
 *
 * It lives here, beside the session driver, because building a model from a
 * provider config is this package's business and nobody else's.
 */

import { generateText } from 'ai';
import { buildModel } from './model.js';
import type { ProviderConfig } from './types.js';

/** Long enough for a cold provider, short enough to fail fast. */
export const PROBE_TIMEOUT_MS = 30_000;

/**
 * Ask the configured model for one short answer. Resolves when it answers with
 * anything at all; throws the provider's own error when it does not.
 */
export async function probeProvider(cfg: ProviderConfig): Promise<void> {
  const result = await generateText({
    model: buildModel(cfg, cfg.model),
    system: 'You are a configuration probe.',
    prompt: 'Reply with exactly {"ok": true}.',
    abortSignal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  // A non-empty completion confirms the credentials, endpoint and model id all
  // resolve and respond.
  if (result.text.trim() === '') throw new Error('provider returned an empty response');
}
