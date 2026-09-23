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
 *
 * TRUECOURSE CREDITS are a choice like the others and unlike the others: they
 * store NOTHING — no key, no model, no endpoint — because the block runs on is
 * the platform's, held in this server's environment. The GET offers the choice
 * only on a server that holds one, and carries the workspace's balance so the
 * page can show what choosing it buys. Picking it also carries on whatever the
 * workspace had paused, and so does saving a key of its own: a workspace that
 * can spend again has no reason to sit still.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { isCreditsProvider, LLM_PROVIDER_CHOICES } from '@truecourse/shared';
import type { LlmConfigUpdate } from '@truecourse/shared';
import type { LlmApiConfig } from '@truecourse/core/services/llm/provider-config';
import { log } from '@truecourse/core/lib/logger';
import {
  CreditsProviderUnavailableError,
  creditsOffered,
  operatorProvider,
  offeredProviderChoices,
  operatorClaudeCode,
  platformCreditsConfig,
  probeWorkspaceLlmConfig,
  workspaceLlmConfigStore,
} from '../services/workspace-llm.service.js';
import { creditsBalance, resumeWorkspaceJobs } from '../services/credits.service.js';
import { actorOf, captureAction, EVENTS } from '../observability/posthog.js';

const OPERATOR_MESSAGE =
  "This instance runs on the operator's Claude Code (TRUECOURSE_LLM_TRANSPORT=claude-code); the workspace provider is not used.";

const configSchema = z.object({
  provider: z.enum(LLM_PROVIDER_CHOICES),
  model: z.string().max(200).optional(),
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
  stored: LlmApiConfig | null,
): LlmApiConfig {
  const sameProvider = stored?.provider === input.provider;
  const candidate: LlmApiConfig = {
    provider: input.provider as LlmApiConfig['provider'],
    model: input.model ?? '',
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
      providers: offeredProviderChoices(),
      ...(operatorClaudeCode() ? { operator: operatorProvider() } : {}),
      ...(creditsOffered() ? { credits: { balance: await creditsBalance(orgId) } } : {}),
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
  const credits = isCreditsProvider(input.provider);
  // Credits are probed like anything else, against the block they really run
  // on — the platform's. Nothing of it is stored and nothing of it is answered.
  const candidate = credits
    ? platformCreditsConfig()
    : buildCandidate(input, await store.getConfig(orgId).catch(() => null));
  if (!candidate) {
    res.status(409).json({ error: new CreditsProviderUnavailableError().message });
    return;
  }
  if (!credits && !input.model?.trim()) {
    res.status(400).json({ error: 'A model is required for this provider.' });
    return;
  }

  // Bedrock may use ambient IAM credentials; every other provider needs a key.
  if (!credits && input.provider !== 'bedrock' && !candidate.apiKey) {
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
    res.status(400).json({
      error: credits
        ? 'The credits provider did not answer. Nothing was saved.'
        : `Provider test failed: ${(err as Error).message}`,
    });
    return;
  }

  // Credits keep the platform's model out of the row: the choice is the whole
  // of what is stored.
  await store.save(orgId, credits ? { provider: input.provider } : input);
  log.info(`[LLM] provider updated for ${orgId} → ${input.provider}`);
  const who = actorOf(req);
  if (who) {
    captureAction(EVENTS.llmProviderSaved, {
      ...who,
      properties: { provider: input.provider, ...(credits ? {} : { model: input.model }) },
    });
  }
  // A workspace that can spend again carries on what it had paused. A save to
  // credits only does so when there is a balance behind them.
  const spendable = credits ? (await creditsBalance(orgId)) > 0 : true;
  if (spendable) await resumeWorkspaceJobs(orgId);
  res.json({
    config: await store.getView(orgId),
    providers: offeredProviderChoices(),
    ...(creditsOffered() ? { credits: { balance: await creditsBalance(orgId) } } : {}),
  });
});

export default router;
