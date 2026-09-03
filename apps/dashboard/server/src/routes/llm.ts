/**
 * Models settings — the workspace's LLM provider.
 *
 *   GET   /api/llm/config   the masked view (null until one is set) + the
 *                           provider kinds the client offers.
 *   PATCH /api/llm/config   validate, PROBE the candidate live, then save.
 *
 * Nothing is persisted until the provider has actually answered: a wrong key,
 * a bad model id or an unreachable gateway comes back as a 400 carrying the
 * provider's own words, and the stored config is untouched.
 *
 * Any authenticated member of the workspace may read and write it — the config
 * is what makes the product work at all, so there is no separate admin gate.
 *
 * On an instance running on its operator's Claude Code the GET carries that
 * as `operator` and the PATCH is refused: nothing saved here would be used.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { LLM_PROVIDER_KINDS } from '@truecourse/shared';
import type { LlmConfigUpdate } from '@truecourse/shared';
import type { GlobalApiLlmConfig } from '@truecourse/core/config/global-config';
import { log } from '@truecourse/core/lib/logger';
import {
  OPERATOR_PROVIDER,
  operatorClaudeCode,
  probeWorkspaceLlmConfig,
  workspaceLlmConfigStore,
} from '../services/workspace-llm.service.js';

const OPERATOR_MESSAGE =
  "This instance runs on the operator's Claude Code (TRUECOURSE_LLM_TRANSPORT=claude-code); the workspace provider is not used.";

const configSchema = z.object({
  provider: z.enum(LLM_PROVIDER_KINDS),
  model: z.string().min(1).max(200),
  fallbackModel: z.string().max(200).optional(),
  apiKey: z.string().min(1).max(2000).optional(),
  accessKeyId: z.string().max(200).optional(),
  baseURL: z.string().url().max(500).optional(),
  region: z.string().max(64).optional(),
  headers: z.record(z.string()).optional(),
});

/**
 * The block to probe: the submitted fields, with the stored secret filled in
 * when the form omitted it. A provider SWITCH never inherits the previous
 * provider's secret — the store's own write rule says the same thing.
 */
function buildCandidate(
  input: LlmConfigUpdate,
  stored: GlobalApiLlmConfig | null,
): GlobalApiLlmConfig {
  const sameProvider = stored?.provider === input.provider;
  const candidate: GlobalApiLlmConfig = {
    provider: input.provider,
    model: input.model,
    ...(input.fallbackModel ? { fallbackModel: input.fallbackModel } : {}),
    ...(input.baseURL ? { baseURL: input.baseURL } : {}),
    ...(input.headers ? { headers: input.headers } : {}),
  };
  if (input.provider === 'bedrock') {
    if (input.region) candidate.region = input.region;
    const accessKeyId = input.accessKeyId ?? (sameProvider ? stored?.accessKeyId : undefined);
    if (accessKeyId) candidate.accessKeyId = accessKeyId;
    const secret = input.apiKey ?? (sameProvider ? stored?.secretAccessKey : undefined);
    if (secret) candidate.secretAccessKey = secret;
    return candidate;
  }
  const apiKey = input.apiKey ?? (sameProvider ? stored?.apiKey : undefined);
  if (apiKey) candidate.apiKey = apiKey;
  return candidate;
}

const router: Router = Router();

router.get('/config', async (req: Request, res: Response) => {
  const orgId = req.user?.organizationId;
  if (!orgId) {
    res.status(403).json({ error: 'This session has no workspace.' });
    return;
  }
  try {
    res.json({
      config: await workspaceLlmConfigStore().getView(orgId),
      providers: LLM_PROVIDER_KINDS,
      ...(operatorClaudeCode() ? { operator: OPERATOR_PROVIDER } : {}),
    });
  } catch (err) {
    log.error(`[LLM] reading the config for ${orgId} failed: ${(err as Error).message}`);
    res.status(500).json({ error: 'Failed to load the provider config.' });
  }
});

router.patch('/config', async (req: Request, res: Response) => {
  const orgId = req.user?.organizationId;
  if (!orgId) {
    res.status(403).json({ error: 'This session has no workspace.' });
    return;
  }
  if (operatorClaudeCode()) {
    res.status(409).json({ error: OPERATOR_MESSAGE });
    return;
  }
  const parsed = configSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid config', details: parsed.error.flatten() });
    return;
  }
  const input = parsed.data;

  const store = workspaceLlmConfigStore();
  const stored = await store.getConfig(orgId).catch(() => null);
  const candidate = buildCandidate(input, stored);

  // Bedrock may use ambient IAM credentials; every other provider needs a key.
  if (input.provider !== 'bedrock' && !candidate.apiKey) {
    res.status(400).json({ error: 'An API key is required for this provider.' });
    return;
  }

  try {
    // The same probe every run start uses — so a config accepted here is one
    // the pipeline will accept too.
    await probeWorkspaceLlmConfig(candidate);
  } catch (err) {
    log.warn(
      `[LLM] provider test failed (${input.provider}) for ${orgId}: ${(err as Error).message}`,
    );
    res.status(400).json({ error: `Provider test failed: ${(err as Error).message}` });
    return;
  }

  await store.save(orgId, input);
  log.info(`[LLM] provider updated for ${orgId} → ${candidate.provider} (${candidate.model})`);
  res.json({ config: await store.getView(orgId), providers: LLM_PROVIDER_KINDS });
});

export default router;
