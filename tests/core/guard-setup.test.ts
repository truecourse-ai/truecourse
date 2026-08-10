/**
 * The `guard setup` core adapter — the half the engine deliberately does
 * NOT own: step 0 (is a provider configured — a CONFIG question), the bounded
 * pre-flight estimate, and the persisted `guard/setup.json` the externals view and
 * `guard status` read back.
 *
 * The engine itself is covered in `tests/guard-generator/setup.test.ts`; here it is
 * driven through injected runners so nothing spawns a model.
 */

import { describe, it, expect, afterEach, afterAll, beforeAll, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { recipePath, readGuardSetup } from '@truecourse/guard-runner';
import { setDefaultTransport, noProviderTransport } from '@truecourse/shared/llm';
import type { SeedProposal } from '@truecourse/guard-generator';

// The API transport, stubbed one step short of the provider: the saved config is
// still validated by the real builder (an unusable one throws exactly as it does in
// production), but the transport it yields records requests instead of calling out.
// That record is how these tests tell an API-mode run apart from one that fell
// through to spawning `claude`.
const { apiTransport } = vi.hoisted(() => ({
  apiTransport: {
    configs: [] as { provider: string; model: string }[],
    requests: [] as { stage: string; model?: string }[],
    reply: '',
  },
}));
vi.mock('../../packages/core/src/services/llm/install-transport.js', async (importOriginal) => {
  const real =
    await importOriginal<typeof import('../../packages/core/src/services/llm/install-transport.js')>();
  const { readApiLlmConfig } = await import('../../packages/core/src/config/global-config.js');
  return {
    ...real,
    createConfiguredApiTransport: () => {
      const cfg = real.buildProviderConfig(readApiLlmConfig());
      apiTransport.configs.push(cfg);
      return async (req: { stage: string; model?: string }) => {
        apiTransport.requests.push({ stage: req.stage, model: req.model });
        return apiTransport.reply;
      };
    },
  };
});

import {
  writeGlobalConfig,
  type GlobalApiLlmConfig,
} from '../../packages/core/src/config/global-config.js';
import {
  guardSetupInProcess,
  estimateGuardSetupCost,
  assertLlmProviderConfigured,
  NoLlmProviderError,
  EstimateDeclined,
  GUARD_SETUP_STEPS,
} from '../../packages/core/src/commands/guard-setup.js';
import { STAGE_DEFAULTS } from '../../packages/core/src/config/llm-models.js';
import { StepTracker } from '../../packages/core/src/progress.js';

const FIXTURE = fileURLToPath(new URL('../fixtures/seed-draft', import.meta.url));
/** Answers a stage from a script and logs the `--model` it was spawned with. */
const FAKE_CLAUDE = fileURLToPath(new URL('../fixtures/fake-claude/claude.mjs', import.meta.url));

// The LLM selection these tests write lives in the USER-level config, so they run
// against a throwaway TRUECOURSE_HOME — never the developer's real one.
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-core-setup-home-'));
beforeAll(() => {
  process.env.TRUECOURSE_HOME = HOME;
});
afterAll(() => {
  delete process.env.TRUECOURSE_HOME;
  fs.rmSync(HOME, { recursive: true, force: true });
});

/** Select API mode with a provider model no `claude` binary would ever accept. */
function useApiMode(over: Partial<GlobalApiLlmConfig> = {}): void {
  writeGlobalConfig({
    llm: {
      transport: 'api',
      api: { provider: 'openai', model: 'gpt-5.5', apiKey: 'sk-test', ...over },
    },
  });
}

const repos: string[] = [];
afterEach(() => {
  while (repos.length) fs.rmSync(repos.pop()!, { recursive: true, force: true });
  setDefaultTransport(undefined);
  fs.rmSync(path.join(HOME, 'config.json'), { force: true });
  apiTransport.configs.length = 0;
  apiTransport.requests.length = 0;
  apiTransport.reply = '';
});

const DOC = 'docs/orgs.md';

function fixtureRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-core-setup-'));
  repos.push(dir);
  fs.cpSync(FIXTURE, dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(dir, DOC), '## orgs\nAn org owner can list their orgs.\n');
  const corpus = path.join(dir, '.truecourse', 'specs', 'corpus.json');
  fs.mkdirSync(path.dirname(corpus), { recursive: true });
  fs.writeFileSync(
    corpus,
    JSON.stringify({
      version: 3,
      generatedAt: '2026-01-01T00:00:00Z',
      docs: [{ ref: DOC, kind: 'prd', lastTouched: '', areaTags: [] }],
      areas: [],
      relations: [],
      skippedDocs: [],
    }),
  );
  return dir;
}

function writeRecipe(r: string, over: Record<string, unknown> = {}): void {
  const recipe = {
    build: 'true',
    api: {
      serve: ['node', path.join(r, 'server.mjs')],
      healthPath: '/health',
      env: { SEED_STORE: path.join(r, 'store.json') },
      ...over,
    },
  };
  const target = recipePath(r);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(recipe, null, 2) + '\n');
}

const PROPOSAL: SeedProposal = {
  scriptPath: 'scripts/guard-seed.mjs',
  scriptContent: [
    "import fs from 'node:fs'",
    'const org = { id: 42, slug: "acme" }',
    'fs.writeFileSync(process.env.SEED_STORE, JSON.stringify({ orgs: [org] }))',
    'fs.writeFileSync(process.env.GUARD_SEED_OUT, JSON.stringify({ fixtures: { org } }))',
    '',
  ].join('\n'),
  seed: { command: 'node scripts/guard-seed.mjs', provides: { fixtures: { org: ['id', 'slug'] } } },
};

const interfaces = () =>
  async () => ({
    interfaces: [],
    externalServices: [
      { service: 'stripe', category: 'payment' as const, evidence: [], baseUrlEnv: 'STRIPE_BASE_URL' },
    ],
    database: {
      type: 'sqlite',
      driver: 'prisma',
      tables: [{ name: 'Org', columns: [{ name: 'id', type: 'Int', isPrimaryKey: true }] }],
      relations: [],
      appImports: [],
    },
    datastoreUrls: [],
  });

const neverCalled = async (): Promise<never> => {
  throw new Error('no model in tests');
};

/**
 * A tracker that keeps every distinct detail each step showed, in order — the
 * live line the terminal checklist and the dashboard popup both paint.
 */
function detailRecorder(): { tracker: StepTracker; details: Map<string, string[]> } {
  const details = new Map<string, string[]>();
  const tracker = new StepTracker((payload) => {
    for (const step of payload.steps ?? []) {
      // Pending steps hide their detail in both surfaces; don't record what
      // nobody renders.
      if (!step.detail || step.status === 'pending') continue;
      const seen = details.get(step.key) ?? [];
      if (seen[seen.length - 1] !== step.detail) seen.push(step.detail);
      details.set(step.key, seen);
    }
  }, GUARD_SETUP_STEPS.map((s) => ({ ...s })));
  return { tracker, details };
}

// ---------------------------------------------------------------------------
// Step 0 — the provider check
// ---------------------------------------------------------------------------

describe('assertLlmProviderConfigured', () => {
  it('refuses the EE no-provider sentinel', () => {
    expect(() => assertLlmProviderConfigured(noProviderTransport)).toThrow(NoLlmProviderError);
  });

  it('accepts a real transport', () => {
    expect(() => assertLlmProviderConfigured(async () => 'ok')).not.toThrow();
  });

  // The installed default is the process-wide answer when no transport is injected.
  it('refuses when the process default IS the sentinel', () => {
    setDefaultTransport(noProviderTransport);
    expect(() => assertLlmProviderConfigured()).toThrow(NoLlmProviderError);
  });

  it('accepts an installed real default', () => {
    setDefaultTransport(async () => 'ok');
    expect(() => assertLlmProviderConfigured()).not.toThrow();
  });

  // Claude Code mode is the one mode that needs the binary — and the suite-wide
  // tripwire points CLAUDE_CODE_BINARY at a path that does not exist.
  it('demands the `claude` binary when nothing else answers', () => {
    expect(() => assertLlmProviderConfigured()).toThrow(/not installed or not on your PATH/);
  });
});

// ---------------------------------------------------------------------------
// The bounded estimate
// ---------------------------------------------------------------------------

describe('estimateGuardSetupCost', () => {
  it('prices the recipe proposal and the seed draft for an unprepared repo', async () => {
    const r = fixtureRepo();

    const estimate = await estimateGuardSetupCost(r);

    const byStage = Object.fromEntries((estimate.stages ?? []).map((s) => [s.stage, s]));
    expect(byStage.guardRecipe.calls).toBe(1);
    expect(byStage.guardSeed.calls).toBe(1);
    // A ceiling: each stage buys one evidence retry.
    expect(byStage.guardRecipe.callsRange).toEqual({ low: 0, high: 2 });
  });

  // Idempotence, priced: a prepared repo costs nothing, so the confirm is skipped.
  it('prices NOTHING for a repo that already has a recipe and a seed', async () => {
    const r = fixtureRepo();
    writeRecipe(r, { seed: { command: 'node mine.mjs', provides: { fixtures: { org: ['id'] } } } });

    expect((await estimateGuardSetupCost(r)).stages).toEqual([]);
  });

  it('prices both again under --refresh', async () => {
    const r = fixtureRepo();
    writeRecipe(r, { seed: { command: 'node mine.mjs', provides: { fixtures: { org: ['id'] } } } });

    const estimate = await estimateGuardSetupCost(r, { refresh: true });

    expect((estimate.stages ?? []).map((s) => s.stage).sort()).toEqual(['guardRecipe', 'guardSeed']);
  });

  // One config, one reading: in API mode every stage runs on the configured
  // provider model, and the estimate quotes exactly what the run will spend on.
  it('prices the configured provider model in API mode', async () => {
    const r = fixtureRepo();
    useApiMode();

    const estimate = await estimateGuardSetupCost(r);

    expect([...new Set((estimate.stages ?? []).map((s) => s.model))]).toEqual(['gpt-5.5']);
  });

  // The other half of that rule: a saved provider model belongs to API mode ONLY.
  // In Claude Code mode the stages keep their tier aliases — `claude --model
  // gpt-5.5` is a deterministic failure.
  it('keeps a saved provider model out of Claude Code mode', async () => {
    const r = fixtureRepo();
    writeGlobalConfig({
      llm: {
        transport: 'claude-code',
        api: { provider: 'openai', model: 'gpt-5.5', apiKey: 'sk-test' },
      },
    });

    const estimate = await estimateGuardSetupCost(r);

    expect((estimate.stages ?? []).map((s) => s.model)).toEqual(['sonnet', 'opus']);
  });
});

// ---------------------------------------------------------------------------
// The driver
// ---------------------------------------------------------------------------

describe('guardSetupInProcess', () => {
  beforeEach(() => setDefaultTransport(async () => 'ok'));

  it('persists guard/setup.json with the detection snapshot', async () => {
    const r = fixtureRepo();
    writeRecipe(r);
    let seedCalls = 0;

    const { report, reportPath } = await guardSetupInProcess(r, {
      interfaces: interfaces(),
      recipeRunner: neverCalled,
      seedRunner: async () => {
        seedCalls++;
        return PROPOSAL;
      },
    });

    expect(seedCalls).toBe(1);
    expect(report.status).toBe('ok');
    expect(reportPath).toBe(path.join(r, '.truecourse', 'guard', 'setup.json'));
    // Read BACK through the store reader — this is what the externals view and
    // `guard status` do, so the file has to satisfy the schema, not just be written.
    const persisted = readGuardSetup(r);
    expect(persisted?.detection?.externalServices.map((s) => s.service)).toEqual(['stripe']);
    expect(persisted?.detection?.database).toEqual({ type: 'sqlite', driver: 'prisma', tables: 1 });
    expect(persisted?.externals?.declared).toEqual(['stripe']);
  }, 120_000);

  // Setup's steps are minutes of real work behind one label each. The phase inside
  // the step is what a watching user has to see, or the run reads as hung.
  it('streams the live phase of each step onto the tracker', async () => {
    const r = fixtureRepo();
    writeRecipe(r);
    const { tracker, details } = detailRecorder();

    await guardSetupInProcess(r, {
      tracker,
      interfaces: interfaces(),
      recipeRunner: neverCalled,
      seedRunner: async () => PROPOSAL,
    });

    // Step 1 reuses the committed recipe, so what it spends its time on is the
    // live probe: booting the server and calling a real route on it.
    expect(details.get('recipe')?.[0]).toBe('probing a live route');
    // The analysis pass is reported against whichever step first needs it — here
    // step 2, because step 1 never had to derive a route surface.
    expect(details.get('detect')?.[0]).toBe('analyzing the repository');
    // The seed: the model call, then the engine really running what it wrote. Each
    // phase states the one it replaced and how long that took.
    expect(details.get('seed')?.slice(0, 3)).toEqual([
      'drafting the seed script',
      expect.stringMatching(/^draft \d+s · verifying: seed script$/),
      expect.stringMatching(/^seed script \d+s · verifying: server boot$/),
    ]);
  }, 120_000);

  it('persists the FAILED record too, so the next reader knows setup did not hold', async () => {
    const r = fixtureRepo();
    writeRecipe(r, { serve: ['node', path.join(r, 'missing.mjs')], readyTimeoutMs: 4000 });

    const { report } = await guardSetupInProcess(r, {
      interfaces: interfaces(),
      recipeRunner: neverCalled,
      seedRunner: neverCalled,
    });

    expect(report.status).toBe('failed');
    expect(readGuardSetup(r)?.status).toBe('failed');
  }, 60_000);

  it('aborts on a declined estimate without touching the repo', async () => {
    const r = fixtureRepo();
    writeRecipe(r);
    const before = fs.readFileSync(recipePath(r), 'utf-8');

    await expect(
      guardSetupInProcess(r, {
        interfaces: interfaces(),
        recipeRunner: neverCalled,
        seedRunner: neverCalled,
        onLlmEstimate: async () => false,
      }),
    ).rejects.toBeInstanceOf(EstimateDeclined);

    expect(fs.readFileSync(recipePath(r), 'utf-8')).toBe(before);
    expect(readGuardSetup(r)).toBeNull();
  });

  // Never ask to spend, then fail: step 0 runs BEFORE the estimate gate.
  it('fails the provider check before the estimate is even offered', async () => {
    const r = fixtureRepo();
    setDefaultTransport(noProviderTransport);
    let asked = false;

    await expect(
      guardSetupInProcess(r, {
        recipeRunner: neverCalled,
        seedRunner: neverCalled,
        onLlmEstimate: async () => {
          asked = true;
          return true;
        },
      }),
    ).rejects.toBeInstanceOf(NoLlmProviderError);

    expect(asked).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// API mode — the saved selection, and the per-run override
// ---------------------------------------------------------------------------

describe('guardSetupInProcess — API mode', () => {
  // No installed default: the run has to answer the provider question from the
  // saved config alone, exactly as it does on a machine that never ran anything else.
  beforeEach(() => setDefaultTransport(undefined));

  // The failure this pins: setup read the MODEL from the API config but not the
  // TRANSPORT, so it spawned `claude --model gpt-5.5` — a deterministic error. The
  // configured model must ride the configured transport, and the suite-wide
  // tripwire binary means a run that reached for `claude` could not have gotten here.
  it('drives the configured API transport, model and all — nothing spawns `claude`', async () => {
    const r = fixtureRepo();
    writeRecipe(r);
    useApiMode();
    apiTransport.reply = JSON.stringify(PROPOSAL);

    const { report } = await guardSetupInProcess(r, {
      interfaces: interfaces(),
      recipeRunner: neverCalled,
    });

    expect(report.status).toBe('ok');
    expect(report.seed?.status).toBe('ok');
    expect(apiTransport.configs).toEqual([
      expect.objectContaining({ provider: 'openai', model: 'gpt-5.5' }),
    ]);
    expect(apiTransport.requests).toEqual([{ stage: 'guard.seed', model: 'gpt-5.5' }]);
  }, 120_000);

  // The gate is the API configuration itself: unusable ⇒ the same no-provider
  // refusal a missing binary raises, named after what is actually wrong, and raised
  // before anyone is asked to spend.
  it('refuses an unusable API configuration before the estimate', async () => {
    const r = fixtureRepo();
    useApiMode({ apiKey: undefined, apiKeyEnv: 'TC_TEST_MISSING_KEY' });
    let asked = false;

    const run = guardSetupInProcess(r, {
      recipeRunner: neverCalled,
      seedRunner: neverCalled,
      onLlmEstimate: async () => {
        asked = true;
        return true;
      },
    });

    await expect(run).rejects.toThrow(NoLlmProviderError);
    await expect(run).rejects.toThrow(/`TC_TEST_MISSING_KEY` is unset/);
    expect(asked).toBe(false);
  });

  // `--llm-transport api` overrides the saved selection, like every sibling
  // command: Claude Code is selected and no binary exists, yet the run goes through.
  it('honors an explicit `api` transport over the saved Claude Code selection', async () => {
    const r = fixtureRepo();
    writeRecipe(r);
    writeGlobalConfig({
      llm: {
        transport: 'claude-code',
        api: { provider: 'openai', model: 'gpt-5.5', apiKey: 'sk-test' },
      },
    });
    apiTransport.reply = JSON.stringify(PROPOSAL);

    const { report } = await guardSetupInProcess(r, {
      llm: 'api',
      interfaces: interfaces(),
      recipeRunner: neverCalled,
    });

    expect(report.seed?.status).toBe('ok');
    expect(apiTransport.requests).toEqual([{ stage: 'guard.seed', model: 'gpt-5.5' }]);
  }, 120_000);

  // The inverse, and the failure the flag exists to prevent: `api` is SAVED, the run
  // forces `cli`, and the stage spawns `claude` — so the argv must carry the Claude
  // tier, never `--model gpt-5.5` (a provider model name `claude` exits 1 on).
  it('keeps the api-configured model off the claude argv under an explicit `cli` transport', async () => {
    const r = fixtureRepo();
    writeRecipe(r);
    useApiMode();
    const io = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-core-setup-fake-'));
    const script = path.join(io, 'script.json');
    const log = path.join(io, 'calls.ndjson');
    fs.writeFileSync(script, JSON.stringify({ 'guard.seed': [{ reply: PROPOSAL }] }));
    // Stands in for the suite-wide tripwire binary for this case only, and hands it
    // back after — an unstubbed runner must never reach the real `claude`.
    const tripwire = process.env.CLAUDE_CODE_BINARY;
    process.env.CLAUDE_CODE_BINARY = FAKE_CLAUDE;
    process.env.FAKE_CLAUDE_SCRIPT = script;
    process.env.FAKE_CLAUDE_LOG = log;

    try {
      const { report } = await guardSetupInProcess(r, {
        llm: 'cli',
        interfaces: interfaces(),
        recipeRunner: neverCalled,
      });

      expect(report.seed?.status).toBe('ok');
      const calls = fs
        .readFileSync(log, 'utf-8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { stage: string; model: string });
      expect(calls).toEqual([
        { stage: 'guard.seed', model: STAGE_DEFAULTS['guard.seed'], match: null },
      ]);
      // And the provider was never even built — one config, read once, or not at all.
      expect(apiTransport.configs).toEqual([]);
    } finally {
      if (tripwire === undefined) delete process.env.CLAUDE_CODE_BINARY;
      else process.env.CLAUDE_CODE_BINARY = tripwire;
      delete process.env.FAKE_CLAUDE_SCRIPT;
      delete process.env.FAKE_CLAUDE_LOG;
      fs.rmSync(io, { recursive: true, force: true });
    }
  }, 120_000);

  // Step 0 exists so a missing provider is found BEFORE the install, build, server
  // boot and analysis pass setup runs. An explicit `cli` flag resolves a REAL
  // transport, so a gate that only looks for the binary when nothing resolved would
  // let this run reach for a `claude` that isn't there minutes later — here the
  // suite-wide tripwire binary is exactly that missing `claude`.
  it('refuses an explicit `cli` transport when `claude` is not on PATH, before step 1', async () => {
    const r = fixtureRepo();
    writeRecipe(r);
    let asked = false;

    const run = guardSetupInProcess(r, {
      llm: 'cli',
      interfaces: interfaces(),
      recipeRunner: neverCalled,
      seedRunner: neverCalled,
      onLlmEstimate: async () => {
        asked = true;
        return true;
      },
    });

    await expect(run).rejects.toThrow(NoLlmProviderError);
    await expect(run).rejects.toThrow(/not installed or not on your PATH/);
    // Nothing ran: not the estimate, and no step wrote a report.
    expect(asked).toBe(false);
    expect(readGuardSetup(r)).toBeNull();
  });
});
