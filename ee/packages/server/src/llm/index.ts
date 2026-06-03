/**
 * Enterprise LLM provider wiring. Installs an AI-SDK transport (so hosted
 * scan/infer/verify/analyze run against Anthropic/OpenAI/Bedrock/Copilot rather
 * than a `claude` binary) and exposes the Models settings API. The active
 * provider comes from the encrypted Postgres config (set via the UI), falling
 * back to env vars. ee is always Postgres; no provider configured yet just
 * leaves the OSS CLI transport in place.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { EeServerRegistry } from '@truecourse/shared';
import { log } from '@truecourse/core/lib/logger';
import { setLlmTransport } from '@truecourse/llm';
import type { EeDb } from '@truecourse/ee-db';
import {
  createAiSdkTransport,
  type ProviderConfig,
  type LlmProviderKind,
} from '@truecourse/ee-llm';
import { LlmConfigStore } from './store.js';

const PROVIDERS: LlmProviderKind[] = ['anthropic', 'openai', 'bedrock', 'copilot'];

// ---------------------------------------------------------------------------
// Env fallback — for deploys that prefer env over the in-app Models page.
// ---------------------------------------------------------------------------

function loadEnvProviderConfig(): ProviderConfig | null {
  const provider = process.env.LLM_PROVIDER as LlmProviderKind | undefined;
  if (!provider || !PROVIDERS.includes(provider)) return null;
  const model = process.env.LLM_MODEL;
  if (!model) {
    log.warn('[ee-llm] LLM_PROVIDER set but LLM_MODEL missing — ignoring env config');
    return null;
  }
  const cfg: ProviderConfig = {
    provider,
    model,
    fallbackModel: process.env.LLM_FALLBACK_MODEL,
    baseURL: process.env.LLM_BASE_URL,
  };
  if (provider === 'bedrock') {
    cfg.region = process.env.AWS_REGION;
    cfg.accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    cfg.secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
    cfg.sessionToken = process.env.AWS_SESSION_TOKEN;
  } else if (provider === 'anthropic') {
    cfg.apiKey = process.env.ANTHROPIC_API_KEY;
  } else if (provider === 'openai') {
    cfg.apiKey = process.env.OPENAI_API_KEY;
  } else if (provider === 'copilot') {
    cfg.apiKey = process.env.COPILOT_API_KEY ?? process.env.GITHUB_COPILOT_TOKEN;
  }
  return cfg;
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
  await transport.complete({
    prompt: 'Reply with {"ok": true}.',
    schema: z.object({ ok: z.boolean() }),
    timeoutMs: 30_000,
  });
}

function createLlmRouter(store: LlmConfigStore, envManaged: boolean): Router {
  const router = Router();

  router.get('/config', async (_req: Request, res: Response) => {
    try {
      const config = await store.getView();
      res.json({ config, envManaged, providers: PROVIDERS });
    } catch (err) {
      log.error(`[ee-llm] get config failed: ${(err as Error).message}`);
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
      res.status(400).json({ error: `Provider test failed: ${(err as Error).message}` });
      return;
    }

    await store.save(input);
    // Make the new provider live immediately for this process.
    setLlmTransport(createAiSdkTransport(candidate));
    log.info(`[ee-llm] provider updated → ${candidate.provider} (${candidate.model})`);
    res.json({ config: await store.getView() });
  });

  return router;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export interface RegisterLlmOptions {
  /** Shared ee-db (Postgres) when hosted; null → no in-app Models store. */
  db: EeDb | null;
  masterSecret: string | null;
}

/**
 * Install the LLM provider transport + Models API. Returns true when the
 * in-app Models page should light up (i.e. the encrypted store is available).
 */
export async function registerLlmProviders(
  registry: EeServerRegistry,
  opts: RegisterLlmOptions,
): Promise<boolean> {
  const envCfg = loadEnvProviderConfig();

  // The master secret derives the AES key for every stored provider key, so a
  // weak one is refused loudly rather than silently producing a weak key.
  const masterSecret =
    opts.masterSecret && opts.masterSecret.length >= 32 ? opts.masterSecret : null;
  if (opts.masterSecret && !masterSecret) {
    log.error(
      '[ee-llm] TRUECOURSE_SECRET_KEY must be at least 32 characters — refusing to enable the encrypted provider store',
    );
  }

  if (opts.db && masterSecret) {
    const store = new LlmConfigStore(opts.db, masterSecret);
    const stored = await store.getProviderConfig().catch((err) => {
      log.error(`[ee-llm] reading stored config failed: ${(err as Error).message}`);
      return null;
    });
    const active = stored ?? envCfg;
    if (active) {
      setLlmTransport(createAiSdkTransport(active));
      log.info(`[ee-llm] installed ${active.provider} transport`);
    } else {
      log.info(
        '[ee-llm] no provider configured yet — using the CLI default until set via the Models page',
      );
    }
    registry.registerRouter('/api/ee/llm', createLlmRouter(store, !!envCfg));
    return true;
  }

  if (envCfg) {
    setLlmTransport(createAiSdkTransport(envCfg));
    log.info(
      `[ee-llm] installed ${envCfg.provider} transport from env (set DATABASE_URL + TRUECOURSE_SECRET_KEY to manage providers in-app)`,
    );
    return false;
  }

  return false;
}
