/**
 * The `guard setup` core adapter — the half the engine deliberately does NOT
 * own: step 0 (is a provider configured — a CONFIG question), the pre-flight
 * SESSION estimate (plan 03's retirement subpoint: six session kinds, cache- and
 * settled-aware), the session seams it builds and injects, the run's usage
 * accounting, and the persisted `guard/setup.json` the externals view and
 * `guard status` read back.
 *
 * The engine itself is covered in `tests/guard-generator/setup.test.ts`. Here
 * the SESSION DRIVER is stubbed at `createConfiguredSessionDriver` — the same
 * seam production resolves the transport at — so a run really goes through the
 * loop (tools, outcome schema, the fold) without a provider, and the transport
 * a run resolves is observable.
 */

import { describe, it, expect, afterEach, afterAll, beforeAll, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  recipePath,
  computeRecipeFingerprint,
  readGuardSetup,
  writeGuardSetup,
  dependenciesPath,
  guardAuthoredInterfacesPath,
  guardInterfacesPath,
} from '@truecourse/guard-runner';
import { setDefaultTransport, noProviderTransport } from '@truecourse/shared/llm';
import { setCacheEntry } from '@truecourse/llm';
import {
  proposeRecipe,
  recipeCacheKey,
  RECIPE_CACHE_NAME,
  interfacesFingerprint,
  computeSeedStepFingerprint,
  authFingerprint,
  ecosystemFingerprint,
  type GuardSetupSeedSession,
} from '@truecourse/guard-generator';
import type { GuardSetupReport, InterfacesFile } from '@truecourse/shared';

// The API transport, stubbed one step short of the provider: the saved config is
// still validated by the real builder (an unusable one throws exactly as it does in
// production), but the transport it yields records requests instead of calling out.
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

/**
 * The SESSION driver seam. The mock keeps the real transport RESOLUTION (the
 * saved selection, and a `--llm-transport` flag over it) and replaces only the
 * backend with a scripted one, so a test can still see which transport a run
 * resolved and which model it would have run on.
 */
const { sessionDriver } = vi.hoisted(() => ({
  sessionDriver: {
    built: [] as { transport?: string; mode: string; model: string }[],
    script: null as null | ((call: { kind: string; emit: (body: unknown) => Promise<void> }) => unknown),
  },
}));
vi.mock('../../packages/core/src/services/llm/session-driver.js', async (importOriginal) => {
  const real =
    await importOriginal<typeof import('../../packages/core/src/services/llm/session-driver.js')>();
  const { effectiveLlmMode, readApiLlmConfig } = await import(
    '../../packages/core/src/config/global-config.js'
  );
  const { stubDriver } = await import('./spec-scan-session-stub.js');
  return {
    ...real,
    createConfiguredSessionDriver: (opts: { transport?: 'cli' | 'api' } = {}) => {
      const mode = effectiveLlmMode(opts.transport);
      const model = mode === 'api' ? (readApiLlmConfig()?.model ?? '(unconfigured)') : 'opus';
      sessionDriver.built.push({ transport: opts.transport, mode, model });
      const { driver } = stubDriver((call) => {
        if (!sessionDriver.script) throw new Error(`no scripted answer for ${call.kind}`);
        return sessionDriver.script(call) as never;
      });
      return { driver, mode, attribution: { provider: mode === 'api' ? 'openai' : 'anthropic', model } };
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
import { StepTracker } from '../../packages/core/src/progress.js';
import { listSessionRuns } from '../../packages/core/src/lib/sessions-store.js';
import { forbiddenDriver, outcome, stubDriver, toolResult } from './spec-scan-session-stub.js';

/** One assistant turn, priced — what the loop counts `spent.turns`/tokens off. */
const assistantTurn = (text: string, tokens = 1_000): { type: 'assistant-turn'; text: string; usage: Record<string, unknown> } => ({
  type: 'assistant-turn',
  text,
  usage: {
    inputTokens: tokens,
    outputTokens: 20,
    cacheReadTokens: 0,
    cacheCreateTokens: 0,
    costUsd: 0.01,
    costSource: 'computed',
  },
});

const FIXTURE = fileURLToPath(new URL('../fixtures/seed-draft', import.meta.url));
const PROPOSABLE_FIXTURE = fileURLToPath(
  new URL('../fixtures/recipe-propose/speced-api-mini', import.meta.url),
);

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
  sessionDriver.built.length = 0;
  sessionDriver.script = null;
});

const DOC = 'docs/orgs.md';

function writeCorpus(dir: string): void {
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
}

function fixtureRepo(from: string = FIXTURE): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-core-setup-'));
  repos.push(dir);
  fs.cpSync(from, dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(dir, DOC), '## orgs\nAn org owner can list their orgs.\n');
  writeCorpus(dir);
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

const interfaces = () => async () => ({
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

/** The seed/auth seams stubbed out: those sessions are covered by their own lanes. */
const inertSeams = {
  authorInterfaces: async () => ({ status: 'skipped' as const, reason: 'stubbed in this test' }),
  seedSession: (async () => ({ status: 'skipped', reason: 'stubbed in this test' })) as GuardSetupSeedSession,
  verifyAuth: async () => ({ status: 'skipped' as const, reason: 'stubbed in this test' }),
};

/** A dependency-catalog session that checks its draft and produces it. */
function scriptCatalogSession(entries = [{ name: 'app-database', class: 'seedable', evidence: 'schema.prisma' }]): void {
  sessionDriver.script = async (call) => {
    await call.emit(assistantTurn('checking the draft'));
    await call.emit(toolResult('check_catalog', 'The draft is valid.'));
    await call.emit(assistantTurn('producing the draft'));
    return outcome({ entries, findings: [] });
  };
}

/**
 * A tracker that keeps every distinct detail each step showed, in order — the
 * live line the terminal checklist and the dashboard popup both paint.
 */
function detailRecorder(): { tracker: StepTracker; details: Map<string, string[]> } {
  const details = new Map<string, string[]>();
  const tracker = new StepTracker((payload) => {
    for (const step of payload.steps ?? []) {
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
// The pre-flight estimate — six SESSION kinds (plan 03, retirement subpoint)
// ---------------------------------------------------------------------------

describe('estimateGuardSetupCost', () => {
  const byKind = (estimate: { stages?: { stage: string }[] }): Record<string, Record<string, unknown>> =>
    Object.fromEntries((estimate.stages ?? []).map((s) => [s.stage, s as Record<string, unknown>]));

  it('prices the setup SESSIONS, not one-shot stages', async () => {
    const r = fixtureRepo();

    const stages = byKind(await estimateGuardSetupCost(r));

    // The retired one-shot stage ids are gone for good; every stage is a SESSION kind.
    expect(stages.guardRecipe).toBeUndefined();
    expect(stages.guardSeed).toBeUndefined();
    expect(
      Object.keys(stages).every(
        (k) => k.startsWith('guard-setup.') || k === 'guard-interfaces.web-tasks',
      ),
    ).toBe(true);
  });

  // A repo with no recipe pays for the seed session; the repair session is priced
  // at ZERO expected turns when the deterministic proposer can answer, because the
  // loop only runs on the failure path.
  it('prices the seed session, and the repair only as a ceiling when the proposer answers', async () => {
    const proposable = fixtureRepo(PROPOSABLE_FIXTURE);
    expect(proposeRecipe(proposable).ok).toBe(true);

    const stages = byKind(await estimateGuardSetupCost(proposable));

    expect(stages['guard-setup.seed'].calls).toBeGreaterThan(0);
    expect(stages['guard-setup.seed'].callsRange).toMatchObject({ low: 0 });
    // Expected zero, ceiling non-zero: a verify failure is unknowable offline.
    expect(stages['guard-setup.recipe-repair'].calls).toBe(0);
    expect(
      (stages['guard-setup.recipe-repair'].callsRange as { high: number }).high,
    ).toBeGreaterThan(0);
    expect(stages['guard-setup.recipe-repair'].bound).toMatch(/loop only on the failure path/);
  });

  it('prices a repair session for a repo whose manifests decide nothing', async () => {
    const r = fixtureRepo();
    expect(proposeRecipe(r).ok).toBe(false);

    const stages = byKind(await estimateGuardSetupCost(r));

    expect(stages['guard-setup.recipe-repair'].calls).toBeGreaterThan(0);
  });

  // A settled proposal in the `guard/recipe` cache is a HIT the session era keeps:
  // nothing is priced for a repair that will not run.
  it('prices nothing for a repair whose proposal is already cached', async () => {
    const r = fixtureRepo();
    await setCacheEntry(r, RECIPE_CACHE_NAME, recipeCacheKey(computeRecipeFingerprint(r)), {
      build: 'true',
      entry: ['node', 'bin.mjs'],
    });

    const stages = byKind(await estimateGuardSetupCost(r));

    expect(stages['guard-setup.recipe-repair']).toBeUndefined();
  });

  // Idempotence, priced: a fully prepared and settled repo costs nothing, so the
  // confirm prompt is skipped entirely.
  it('prices NOTHING for a prepared repo whose spine is settled', async () => {
    const r = settledRepo();

    expect((await estimateGuardSetupCost(r)).stages).toEqual([]);
  });

  it('prices every session again under --refresh', async () => {
    const r = settledRepo();

    const stages = byKind(await estimateGuardSetupCost(r, { refresh: true }));

    expect(Object.keys(stages).sort()).toContain('guard-setup.recipe-repair');
    expect(Object.keys(stages).sort()).toContain('guard-setup.seed');
  });

  // `--replace` re-authors places that already carry tasks, so the work item count
  // is EVERY screen, not just the unauthored ones.
  it('--replace prices every screen, not just the unauthored ones', async () => {
    const r = settledRepo();

    const plain = await estimateGuardSetupCost(r);
    const replaced = await estimateGuardSetupCost(r, { replace: true });

    const authoring = (e: Awaited<ReturnType<typeof estimateGuardSetupCost>>): number =>
      (e.stages ?? []).find((s) => s.stage === 'guard-interfaces.web-tasks')?.calls ?? 0;
    expect(authoring(plain)).toBe(0);
    expect(authoring(replaced)).toBeGreaterThan(0);
  });

  // ONE MODEL for every session: in API mode the configured flagship, in
  // Claude Code mode the pinned tier — never the old per-stage tier mix.
  it('prices one model for every session — the configured one in API mode', async () => {
    const r = fixtureRepo();
    useApiMode();

    const estimate = await estimateGuardSetupCost(r, { mode: 'api' });

    expect([...new Set((estimate.stages ?? []).map((s) => s.model))]).toEqual(['gpt-5.5']);
  });

  it('keeps a saved provider model out of Claude Code mode', async () => {
    const r = fixtureRepo();
    writeGlobalConfig({
      llm: {
        transport: 'claude-code',
        api: { provider: 'openai', model: 'gpt-5.5', apiKey: 'sk-test' },
      },
    });

    const estimate = await estimateGuardSetupCost(r);

    expect([...new Set((estimate.stages ?? []).map((s) => s.model))]).toEqual(['opus']);
  });
});

/**
 * A repo where every step is already done AND recorded as settled: a committed
 * recipe with a seed, both interface halves, and a `guard/setup.json` whose rows
 * carry the fingerprints this tree computes.
 */
function settledRepo(): string {
  const r = fixtureRepo();
  writeRecipe(r, { seed: { command: 'node mine.mjs', provides: { fixtures: { org: ['id'] } } } });
  const derived: InterfacesFile = {
    version: 2,
    generatedAt: '2026-08-19T00:00:00.000Z',
    recipeFingerprint: 'sha256:recipe',
    interfaces: [],
    resources: { web: [{ id: 'root', kind: 'screen', title: '/', address: '/' }] },
    source: { web: 'tree' },
  };
  fs.mkdirSync(path.dirname(guardInterfacesPath(r)), { recursive: true });
  fs.writeFileSync(guardInterfacesPath(r), JSON.stringify(derived));
  fs.writeFileSync(
    guardAuthoredInterfacesPath(r),
    JSON.stringify({
      version: 2,
      generatedAt: '2026-08-19T00:00:00.000Z',
      recipeFingerprint: 'sha256:recipe',
      interfaces: [
        {
          id: 'web/open-root',
          type: 'web',
          title: 'Open the root screen',
          entry: { method: 'GET', path: '/' },
          steps: [{ kind: 'activate', target: 'button "Open"' }],
          at: 'root',
          fingerprint: 'sha256:web',
        },
      ],
    }),
  );
  const report: GuardSetupReport = {
    ranAt: '2026-08-19T00:00:00.000Z',
    status: 'ok',
    recipe: { status: 'ok', outcome: 'exists' },
    steps: [
      { key: 'recipe', status: 'ok', inputFingerprint: ecosystemFingerprint(r) },
      { key: 'detect', status: 'ok', inputFingerprint: '' },
      // The catalog fingerprint folds the detection snapshot, which only an
      // analysis pass can produce — the estimate only asks whether a row settled.
      { key: 'catalog', status: 'ok', inputFingerprint: 'settled-catalog' },
      { key: 'interfaces', status: 'ok', inputFingerprint: interfacesFingerprint(r) },
      { key: 'seed', status: 'ok', inputFingerprint: computeSeedStepFingerprint(r) },
      { key: 'auth', status: 'ok', inputFingerprint: authFingerprint(r) },
    ],
  };
  writeGuardSetup(r, report);
  return r;
}

// ---------------------------------------------------------------------------
// The driver
// ---------------------------------------------------------------------------

describe('guardSetupInProcess', () => {
  beforeEach(() => setDefaultTransport(async () => 'ok'));

  it('persists guard/setup.json with the detection snapshot and the step spine', async () => {
    const r = fixtureRepo();
    writeRecipe(r);
    scriptCatalogSession();

    const { report, reportPath } = await guardSetupInProcess(r, {
      interfaces: interfaces(),
      ...inertSeams,
    });

    expect(report.status).toBe('ok');
    expect(reportPath).toBe(path.join(r, '.truecourse', 'guard', 'setup.json'));
    // Read BACK through the store reader — this is what the externals view and
    // `guard status` do, so the file has to satisfy the schema, not just be written.
    const persisted = readGuardSetup(r);
    expect(persisted?.detection?.externalServices.map((s) => s.service)).toEqual(['stripe']);
    expect(persisted?.detection?.database).toEqual({ type: 'sqlite', driver: 'prisma', tables: 1 });
    expect(persisted?.externals?.declared).toEqual(['stripe']);
    expect(persisted?.steps.map((s) => s.key)).toEqual([
      'recipe',
      'detect',
      'catalog',
      'interfaces',
      'seed',
      'auth',
    ]);
  }, 120_000);

  // The run's spend, in the loop's own units: the sessions block says how much of
  // the (zero, here) one-shot bill was really agent sessions.
  it('records the session spend under `usage.sessions`', async () => {
    const r = fixtureRepo();
    writeRecipe(r);
    scriptCatalogSession();

    const { report } = await guardSetupInProcess(r, { interfaces: interfaces(), ...inertSeams });

    // Nothing one-shot ran: the whole spend is sessions.
    expect(report.usage?.calls).toBe(0);
    expect(report.usage?.sessions?.count).toBeGreaterThan(0);
    expect(report.usage?.sessions?.turns).toBeGreaterThan(0);
    // The catalog row names the sessions-store run its session ran under.
    const catalog = report.steps.find((s) => s.key === 'catalog');
    expect(catalog?.status).toBe('ok');
    expect(catalog?.sessionRunId).toBeTruthy();
    expect(listSessionRuns(r).map((run) => run.runId)).toContain(catalog?.sessionRunId);
    // The catalog fold really landed the entry.
    expect(JSON.parse(fs.readFileSync(dependenciesPath(r), 'utf-8')).dependencies).toEqual([
      expect.objectContaining({ name: 'app-database', class: 'seedable' }),
    ]);
  }, 120_000);

  // A run that spends nothing carries no usage block at all — the honest zero.
  // The second run of the SAME repo is the settled one: the first recorded the
  // fingerprints (the catalog's folds the detection snapshot, so only a real run
  // can compute it), and nothing moved in between.
  it('omits `usage` from a settled re-run, and builds no driver for it', async () => {
    const r = settledRepo();
    scriptCatalogSession();
    const first = await guardSetupInProcess(r, { interfaces: interfaces(), ...inertSeams });
    expect(first.report.usage?.sessions?.count).toBe(1);
    sessionDriver.built.length = 0;
    sessionDriver.script = null;

    const { report } = await guardSetupInProcess(r, { interfaces: interfaces(), ...inertSeams });

    expect(report.steps.find((s) => s.key === 'catalog')).toMatchObject({
      status: 'skipped',
      reason: 'unchanged',
    });
    expect(report.usage).toBeUndefined();
    // Lazy to the end: a settled run never builds a backend it will not call.
    expect(sessionDriver.built).toEqual([]);
    // …and never opens a second sessions-store run.
    expect(listSessionRuns(r)).toHaveLength(1);
  }, 120_000);

  // Setup's steps are minutes of real work behind one label each. The phase inside
  // the step is what a watching user has to see, or the run reads as hung.
  it('streams the live phase of each step onto the tracker', async () => {
    const r = fixtureRepo();
    writeRecipe(r);
    scriptCatalogSession();
    const { tracker, details } = detailRecorder();

    await guardSetupInProcess(r, { tracker, interfaces: interfaces(), ...inertSeams });

    // Step 1 reuses the committed recipe, so what it spends its time on is the
    // live probe: booting the server and calling a real route on it.
    expect(details.get('recipe')?.[0]).toBe('probing a live route');
    // The analysis pass is reported against whichever step first needs it — here
    // step 2, because step 1 never had to derive a route surface.
    expect(details.get('detect')?.[0]).toBe('analyzing the repository');
    // The catalog session is the one long thing inside step 3.
    expect(details.get('catalog')?.[0]).toBe('classifying the dependency catalog');
  }, 120_000);

  it('persists the FAILED record too, so the next reader knows setup did not hold', async () => {
    const r = fixtureRepo();
    writeRecipe(r, { serve: ['node', path.join(r, 'missing.mjs')], readyTimeoutMs: 4000 });

    const { report } = await guardSetupInProcess(r, {
      interfaces: interfaces(),
      recipeRunner: neverCalled,
      ...inertSeams,
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
        ...inertSeams,
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
        ...inertSeams,
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

describe('guardSetupInProcess — the transport the sessions run on', () => {
  // No installed default: the run has to answer the provider question from the
  // saved config alone, exactly as it does on a machine that never ran anything else.
  beforeEach(() => setDefaultTransport(undefined));

  // The failure this pins: setup read the MODEL from the API config but not the
  // TRANSPORT, so it spawned `claude --model gpt-5.5` — a deterministic error. The
  // configured model must ride the configured transport, and the suite-wide
  // tripwire binary means a run that reached for `claude` could not have gotten here.
  it('runs its sessions on the configured API transport — nothing spawns `claude`', async () => {
    const r = fixtureRepo();
    writeRecipe(r);
    useApiMode();
    scriptCatalogSession();

    const { report } = await guardSetupInProcess(r, { interfaces: interfaces(), ...inertSeams });

    expect(report.status).toBe('ok');
    expect(sessionDriver.built).toEqual([{ transport: undefined, mode: 'api', model: 'gpt-5.5' }]);
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
      ...inertSeams,
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
    scriptCatalogSession();

    const { report } = await guardSetupInProcess(r, {
      llm: 'api',
      interfaces: interfaces(),
      ...inertSeams,
    });

    expect(report.status).toBe('ok');
    expect(sessionDriver.built).toEqual([{ transport: 'api', mode: 'api', model: 'gpt-5.5' }]);
  }, 120_000);

  // The inverse, and the failure the flag exists to prevent: `api` is SAVED, the run
  // forces `cli`, and the sessions run on the Claude Code driver — which must be
  // handed the pinned tier, never `gpt-5.5`.
  it('keeps the api-configured model off the sessions under an explicit `cli` transport', async () => {
    const r = fixtureRepo();
    writeRecipe(r);
    useApiMode();
    scriptCatalogSession();
    // Step 0 demands the binary of exactly the runs that SPAWN it; node stands in
    // for the `claude` this run would otherwise be refused for not having.
    const tripwire = process.env.CLAUDE_CODE_BINARY;
    process.env.CLAUDE_CODE_BINARY = process.execPath;

    try {
      const { report } = await guardSetupInProcess(r, {
        llm: 'cli',
        interfaces: interfaces(),
        ...inertSeams,
      });

      expect(report.status).toBe('ok');
      expect(sessionDriver.built).toEqual([
        { transport: 'cli', mode: 'claude-code', model: 'opus' },
      ]);
      // And the API provider was never even built — one config, read once, or not at all.
      expect(apiTransport.configs).toEqual([]);
    } finally {
      if (tripwire === undefined) delete process.env.CLAUDE_CODE_BINARY;
      else process.env.CLAUDE_CODE_BINARY = tripwire;
    }
  }, 120_000);

  // Step 0 exists so a missing provider is found BEFORE the install, build, server
  // boot and analysis pass setup runs.
  it('refuses an explicit `cli` transport when `claude` is not on PATH, before step 1', async () => {
    const r = fixtureRepo();
    writeRecipe(r);
    let asked = false;

    const run = guardSetupInProcess(r, {
      llm: 'cli',
      interfaces: interfaces(),
      recipeRunner: neverCalled,
      ...inertSeams,
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

// ---------------------------------------------------------------------------
// Hosted injection — a caller that owns the driver, the transport and the key
// ---------------------------------------------------------------------------

describe('guardSetupInProcess — hosted injection', () => {
  // A hosted run answers the provider question itself: nothing is installed
  // process-wide and no global config is read.
  beforeEach(() => setDefaultTransport(undefined));

  /** Where a hosted run's sessions are keyed — never the (ephemeral) work tree. */
  function sessionsHome(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-core-setup-key-'));
    repos.push(dir);
    return dir;
  }

  const checklistOf = (run: { display?: { blocks: { kind: string }[] } }): { key: string; status: string }[] => {
    const block = run.display?.blocks.find((b) => b.kind === 'checklist');
    return (block as { items: { key: string; status: string }[] } | undefined)?.items ?? [];
  };

  it('runs the sessions on the injected driver, under the caller\'s sessions key', async () => {
    const r = fixtureRepo();
    writeRecipe(r);
    const key = sessionsHome();
    const { driver } = stubDriver(async (call) => {
      await call.emit(assistantTurn('checking the draft'));
      await call.emit(toolResult('check_catalog', 'The draft is valid.'));
      return outcome({
        entries: [{ name: 'app-database', class: 'seedable', evidence: 'schema.prisma' }],
        findings: [],
      });
    });

    const { report, sessionsRunDirs } = await guardSetupInProcess(r, {
      driver,
      transport: async () => 'ok',
      transportMode: 'api',
      sessionsKey: key,
      interfaces: interfaces(),
      ...inertSeams,
    });

    expect(report.status).toBe('ok');
    // The configured-driver seam was never reached — the caller's driver ran.
    expect(sessionDriver.built).toEqual([]);
    expect(report.usage?.sessions?.count).toBe(1);
    // The run lives under the KEY; the work tree keeps no sessions at all.
    const runs = listSessionRuns(key, 'guard-setup');
    expect(runs).toHaveLength(1);
    expect(listSessionRuns(r)).toEqual([]);
    expect(sessionsRunDirs[0].startsWith(key)).toBe(true);
    // …and the record quotes the injected driver's own attribution.
    expect(runs[0].llm).toEqual({ mode: 'api', provider: 'test', model: 'scripted' });
    expect(runs[0].status).toBe('completed');
  }, 120_000);

  // An eager run is VISIBLE from the moment it starts — including one that dies
  // before any session exists, which the lazy CLI shape leaves unrecorded.
  it('opens the run eagerly with the step checklist, and closes it failed with the reason', async () => {
    const r = fixtureRepo();
    writeRecipe(r, { serve: ['node', path.join(r, 'missing.mjs')], readyTimeoutMs: 4000 });
    const key = sessionsHome();
    const { tracker } = detailRecorder();

    const { report } = await guardSetupInProcess(r, {
      driver: forbiddenDriver('the recipe gate fails before any session'),
      transport: neverCalled,
      transportMode: 'claude-code',
      sessionsKey: key,
      eagerRun: true,
      tracker,
      interfaces: interfaces(),
      ...inertSeams,
    });

    expect(report.status).toBe('failed');
    const [run] = listSessionRuns(key, 'guard-setup');
    expect(run.sessions).toEqual([]);
    expect(run.status).toBe('failed');
    expect(run.error).toEqual({ message: report.reason, kind: 'setup' });
    expect(run.llm).toEqual({ mode: 'claude-code', provider: 'test', model: 'scripted' });
    // The checklist the terminal renders, mirrored for a surface that can only
    // read run.json: the step that died carries the error, later steps never ran.
    expect(checklistOf(run).map((i) => i.key)).toEqual([
      'recipe',
      'detect',
      'catalog',
      'interfaces',
      'seed',
      'auth',
    ]);
    expect(checklistOf(run)[0].status).toBe('error');
    expect(checklistOf(run)[1].status).toBe('pending');
  }, 60_000);
});
