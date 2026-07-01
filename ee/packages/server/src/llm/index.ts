/**
 * Enterprise LLM provider wiring. Installs an AI-SDK transport (so hosted
 * scan/infer/verify/analyze run against Anthropic/OpenAI/Bedrock/Copilot rather
 * than a `claude` binary) and exposes the Models settings API. The active
 * provider comes ONLY from the encrypted Postgres config (set via the Models
 * page) — there is no CLI/.env provider fallback in EE. Until a provider is set,
 * there is simply no transport and LLM work errors loudly.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { AuthUser, EeServerRegistry } from '@truecourse/shared';
import { log } from '@truecourse/core/lib/logger';
import { captureEeException, upstreamStatusOf } from '../observability/sentry.js';
import { setDefaultTransport, noProviderTransport } from '@truecourse/shared/llm';
import { setShowResolvedStageModel } from '@truecourse/core/commands/spec-in-process';
import type { LlmTraceRecorder } from '@truecourse/shared';
import type { EeDb } from '@truecourse/ee-db';
import {
  createAiSdkTransport,
  type ProviderConfig,
  type LlmProviderKind,
} from '@truecourse/ee-llm';
import { LlmConfigStore } from './store.js';

const PROVIDERS: LlmProviderKind[] = ['anthropic', 'openai', 'bedrock', 'copilot'];

// `isLlmConfigured` + `NO_LLM_PROVIDER_MESSAGE` + `noProviderTransport` now live
// in @truecourse/shared/llm so the gate (which can't import ee-server) can fail
// loudly up front too. Re-exported for EE consumers that import from this module.
export { isLlmConfigured, NO_LLM_PROVIDER_MESSAGE } from '@truecourse/shared/llm';

function orgIdOf(req: Request): string | undefined {
  return (req as Request & { eeUser?: AuthUser }).eeUser?.organizationId ?? undefined;
}

// ---------------------------------------------------------------------------
// Settings API
// ---------------------------------------------------------------------------

const inputSchema = z.object({
  provider: z.enum(['anthropic', 'openai', 'bedrock', 'copilot']),
  model: z.string().min(1).max(200),
  fallbackModel: z.string().max(200).optional(),
  apiKey: z.string().min(1).max(2000).optional(),
  accessKeyId: z.string().max(200).optional(),
  baseURL: z.string().url().max(500).optional(),
  region: z.string().max(64).optional(),
  headers: z.record(z.string()).optional(),
});

type LlmConfigInputBody = z.infer<typeof inputSchema>;

/** Build the candidate config, merging the stored secret when the UI omits it. */
function buildCandidate(
  input: LlmConfigInputBody,
  stored: ProviderConfig | null,
): ProviderConfig {
  const sameProvider = stored?.provider === input.provider;
  const cfg: ProviderConfig = {
    provider: input.provider,
    model: input.model,
    fallbackModel: input.fallbackModel,
    baseURL: input.baseURL,
    headers: input.headers,
  };
  if (input.provider === 'bedrock') {
    cfg.region = input.region;
    cfg.accessKeyId = input.accessKeyId ?? (sameProvider ? stored?.accessKeyId : undefined);
    cfg.secretAccessKey = input.apiKey ?? (sameProvider ? stored?.secretAccessKey : undefined);
  } else {
    cfg.apiKey = input.apiKey ?? (sameProvider ? stored?.apiKey : undefined);
  }
  return cfg;
}

/** Validate the config with a tiny live call before persisting it. */
async function testConfig(cfg: ProviderConfig): Promise<void> {
  const transport = createAiSdkTransport(cfg);
  const text = await transport({
    system: 'You are a configuration probe.',
    user: 'Reply with exactly {"ok": true}.',
    responseFormat: 'json',
    timeoutMs: 30_000,
  });
  // A non-empty completion confirms the credentials + model resolve and respond.
  if (typeof text !== 'string' || text.trim() === '') {
    throw new Error('provider returned an empty response');
  }
}

function createLlmRouter(store: LlmConfigStore, recorder?: LlmTraceRecorder): Router {
  const router = Router();

  router.get('/config', async (req: Request, res: Response) => {
    try {
      const config = await store.getView();
      res.json({ config, providers: PROVIDERS });
    } catch (err) {
      log.error(`[ee-llm] get config failed (org ${orgIdOf(req) ?? 'unknown'}): ${(err as Error).message}`);
      captureEeException(err, {
        component: 'llm',
        orgId: orgIdOf(req),
        route: 'GET /api/ee/llm/config',
      });
      res.status(500).json({ error: 'failed to load config' });
    }
  });

  router.patch('/config', async (req: Request, res: Response) => {
    const parsed = inputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid config', details: parsed.error.flatten() });
      return;
    }
    const input = parsed.data;
    const stored = await store.getProviderConfig().catch(() => null);
    const candidate = buildCandidate(input, stored);

    // Bedrock may use ambient IAM creds; every other provider needs a key.
    if (input.provider !== 'bedrock' && !candidate.apiKey) {
      res.status(400).json({ error: 'An API key is required for this provider.' });
      return;
    }

    try {
      await testConfig(candidate);
    } catch (err) {
      // The provider-test failure (bad key, wrong model, outage) was previously
      // surfaced only to the browser and lost server-side — log + report it.
      const upstreamStatus = upstreamStatusOf(err);
      log.warn(
        `[ee-llm] provider test failed (${input.provider}${upstreamStatus ? ` ${upstreamStatus}` : ''}) for org ${orgIdOf(req) ?? 'unknown'}: ${(err as Error).message}`,
      );
      captureEeException(err, {
        component: 'llm',
        orgId: orgIdOf(req),
        provider: input.provider,
        upstreamStatus,
        route: 'PATCH /api/ee/llm/config',
        level: 'warning',
      });
      res.status(400).json({ error: `Provider test failed: ${(err as Error).message}` });
      return;
    }

    await store.save(input);
    // Make the new provider live immediately for this process.
    setDefaultTransport(createAiSdkTransport(candidate, { recorder }));
    log.info(`[ee-llm] provider updated → ${candidate.provider} (${candidate.model})`);
    res.json({ config: await store.getView() });
  });

  return router;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export interface RegisterLlmOptions {
  /** Shared ee-db (Postgres). EE is always Postgres; required. */
  db: EeDb;
  /** Master secret deriving the store's AES key; validated (>=32) by the caller. */
  masterSecret: string;
  /** LLM trace sink — installed transports record every call to it. Omit ⇒ no tracing. */
  recorder?: LlmTraceRecorder;
}

/**
 * Install the encrypted Postgres provider store + the Models API, and load the
 * stored provider as the active transport.
 *
 * EE has NO CLI/.env provider fallback: `DATABASE_URL` + `TRUECOURSE_SECRET_KEY`
 * are required (the caller fails boot if the secret is missing/weak), and the
 * provider comes only from the in-app store. Until one is set via the Models
 * page there is simply no transport — LLM work errors loudly rather than
 * silently using an ambient CLI/.env key.
 */
export async function registerLlmProviders(
  registry: EeServerRegistry,
  opts: RegisterLlmOptions,
): Promise<void> {
  // EE runs a single configured model for every stage (the AI-SDK transport
  // ignores the per-stage hint), so progress must NOT show the OSS per-stage
  // model tiers — they'd be misleading. Suppress the resolved-model fallback.
  setShowResolvedStageModel(false);
  const store = new LlmConfigStore(opts.db, opts.masterSecret);
  const recorder = opts.recorder;
  const stored = await store.getProviderConfig().catch((err) => {
    log.error(`[ee-llm] reading stored config failed: ${(err as Error).message}`);
    return null;
  });
  if (stored) {
    setDefaultTransport(createAiSdkTransport(stored, { recorder }));
    log.info(`[ee-llm] installed ${stored.provider} transport`);
  } else {
    // Install the loud no-op so LLM work fails clearly instead of falling back
    // to the local CLI. Cleared when a provider is configured below.
    setDefaultTransport(noProviderTransport);
    log.info('[ee-llm] no provider configured yet — LLM work errors until one is set via the Models page');
  }
  registry.registerRouter('/api/ee/llm', createLlmRouter(store, recorder));
}
