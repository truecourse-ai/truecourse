// PREVIEW: REAL — the workspace's LLM provider, read and written over the
// dashboard server's own routes.

/**
 * The Models settings seam.
 *
 * The read answers a MASKED view (the stored key never comes back, only its
 * tail) plus the provider kinds this build offers. The write PROBES the
 * candidate provider live before it saves anything, so a 400 carries the
 * provider's own words about why it refused — which is the whole answer, and
 * why the form shows that text verbatim.
 *
 * The read is allowed to fail quietly at the shell level (no server, no
 * session): "the read did not answer" is not "the workspace has no provider",
 * and the needs-setup banner is a claim only the first can support.
 */

import { fetchApi } from '@/lib/api';
import type { LlmConfigResponse, LlmConfigUpdate } from '@truecourse/shared';

/** The masked config (null until one is set) and the providers on offer. */
export function fetchLlmConfig(): Promise<LlmConfigResponse> {
  return fetchApi<LlmConfigResponse>('/api/llm/config');
}

/**
 * Test and save. Rejects with the server's own message on a refusal: an
 * invalid form, a missing key, or the provider's reason for saying no.
 * Omitting `apiKey` keeps the stored one, but only for the same provider.
 */
export function saveLlmConfig(update: LlmConfigUpdate): Promise<LlmConfigResponse> {
  return fetchApi<LlmConfigResponse>('/api/llm/config', {
    method: 'PATCH',
    body: JSON.stringify(update),
  });
}
