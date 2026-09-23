import { WRAP_UP_TURNS } from '../../packages/agent-loop/src/index.js';
import { PREPARATION_SESSION_BUDGET } from '../../packages/core/src/services/guard-setup/preparation-session.js';
/**
 * The `guard setup` core adapter — the half the engine deliberately does NOT
 * own: step 0 (is a provider configured — a CONFIG question), the pre-flight
 * SESSION estimate (six session kinds, cache- and settled-aware), the session
 * seams it builds and injects, the run's usage accounting, and the persisted
 * `guard/setup.json` the externals view and the setup report read back.
 *
 * The engine itself is covered in `tests/guard-generator/setup.test.ts`. Here
 * the SESSION DRIVER is stubbed at `createClaudeCodeSessionDriver` — the same
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
  legacyPreparationFingerprint,
  readGuardSetup,
  writeGuardSetup,
  dependenciesPath,
  guardAuthoredInterfacesPath,
  guardInterfacesPath,
} from '@truecourse/guard-runner';
import { setCacheEntry } from '@truecourse/llm';
import {
  proposeRecipe,
  recipeCacheKey,
  RECIPE_CACHE_NAME,
  legacyInterfacesFingerprint,
  legacySeedStepFingerprint,
  authFingerprint,
  legacyRecipeStepFingerprint,
  type GuardSetupSeedSession,
} from '@truecourse/guard-generator';
import type { GuardSetupReport, InterfacesFile } from '@truecourse/shared';

// The API transport, stubbed one step short of the provider: the saved config is
// still validated by the real builder (an unusable one throws exactly as it does in
// production), but the transport it yields records requests instead of calling out.
/**
 * The SESSION driver seam — the AMBIENT one, this process's own Claude Code.
 * The backend is replaced with a scripted driver, so a test can see that a run
 * with no injected driver built this one, and on which model.
 */
const { sessionDriver } = vi.hoisted(() => ({
  sessionDriver: {
    built: [] as { mode: string; model: string }[],
    script: null as null | ((call: { kind: string; emit: (body: unknown) => Promise<void> }) => unknown),
  },
}));
vi.mock('../../packages/core/src/services/llm/session-driver.js', async (importOriginal) => {
  const real =
    await importOriginal<typeof import('../../packages/core/src/services/llm/session-driver.js')>();
  const { stubDriver } = await import('./spec-scan-session-stub.js');
  return {
    ...real,
    createClaudeCodeSessionDriver: () => {
      sessionDriver.built.push({ mode: 'claude-code', model: 'opus' });
      const { driver } = stubDriver((call) => {
        if (!sessionDriver.script) throw new Error(`no scripted answer for ${call.kind}`);
        return sessionDriver.script(call) as never;
      });
      return { driver, mode: 'claude-code', attribution: { provider: 'anthropic', model: 'opus' } };
    },
  };
});

import {
  guardSetupInProcess,
  estimateGuardSetupCost,
  EstimateDeclined,
  GUARD_SETUP_STEPS,
} from '../../packages/core/src/commands/guard-setup.js';
import { StepTracker } from '../../packages/core/src/progress.js';
import { createStoredSessionRun, listStoredSessionRuns, sessionRunDir } from '../../packages/core/src/lib/sessions-store.js';
import { forbiddenDriver, outcome, stubDriver, toolResult } from './spec-scan-session-stub.js';
import { installMemoryKvCache, resetKvCacheStore } from '../helpers/memory-kv-cache.js';
import { installMemorySessionRuns, resetSessionRuns } from '../helpers/memory-session-runs.js';

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

const repos: string[] = [];
beforeEach(() => {
  installMemoryKvCache();
  installMemorySessionRuns();
});
afterEach(() => {
  resetKvCacheStore();
  resetSessionRuns();
  while (repos.length) fs.rmSync(repos.pop()!, { recursive: true, force: true });
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
  preparationSession: async () => ({ status: 'skipped' as const, reason: 'stubbed in this test' }),
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
 * live line the dashboard popup paints.
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

// ---------------------------------------------------------------------------
// The pre-flight estimate — six SESSION kinds
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

  it('prices readable enrichment despite an unchanged settled fingerprint', async () => {
    const r = settledRepo();
    const file = guardAuthoredInterfacesPath(r);
    const authored = JSON.parse(fs.readFileSync(file, 'utf-8'));
    delete authored.resources.web[0].readables;
    fs.writeFileSync(file, JSON.stringify(authored));
    const stages = byKind(await estimateGuardSetupCost(r));
    expect(stages['guard-interfaces.web-tasks'].calls).toBeGreaterThan(0);
  });

  it('includes private preparation authoring and its hard budget in a targeted estimate', async () => {
    const r = fixtureRepo();
    const estimate = await estimateGuardSetupCost(r, { only: 'preparations' });
    expect(estimate.stages?.map(s => s.stage)).toEqual(['guard-setup.preparation-observations', 'guard-setup.preparations']);
    const review = estimate.stages![0];
    expect(review.label).toBe('Reviewing baseline observation scope');
    expect(review.calls).toBeGreaterThan(0);
    expect(review.estimatedTokens).toBeGreaterThan(0);
    expect(review.callsRange?.high).toBe(20 + WRAP_UP_TURNS);
    const stage = estimate.stages![1];
    expect(stage.calls).toBeGreaterThan(0);
    expect(stage.estimatedTokens).toBeGreaterThan(0);
    expect(stage.label).toBe('Preparing private test data');
    expect(stage.callsRange?.high).toBe(PREPARATION_SESSION_BUDGET.turns * (PREPARATION_SESSION_BUDGET.maxResumes + 1) + WRAP_UP_TURNS);
    const settled = settledRepo();
    expect((await estimateGuardSetupCost(settled, { only: 'preparations' })).stages).toEqual([]);
    expect((await estimateGuardSetupCost(settled, { only: 'preparations', refresh: true })).stages?.map(s => s.stage))
      .toEqual(['guard-setup.preparation-observations', 'guard-setup.preparations']);
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

  // ONE MODEL for every session: the one the run's own driver names, and the
  // pinned Claude Code tier when the caller names none.
  it('prices one model for every session — the one the caller names', async () => {
    const r = fixtureRepo();

    const named = await estimateGuardSetupCost(r, { sessionModel: 'gpt-5.5' });
    expect([...new Set((named.stages ?? []).map((s) => s.model))]).toEqual(['gpt-5.5']);

    const ambient = await estimateGuardSetupCost(r);
    expect([...new Set((ambient.stages ?? []).map((s) => s.model))]).toEqual(['opus']);
  });
});

/**
 * A repo where every step is already done AND recorded as settled: a stored
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
      resources: { web: [{ ...derived.resources!.web[0], readables: { markers: [], elements: [], controls: [], rows: [] } }] },
      interfaces: [
        {
          id: 'web/open-root',
          type: 'web',
          title: 'Open the root screen',
          entry: { method: 'GET', path: '/' },
          steps: [{ kind: 'activate', target: { role: 'button', name: 'Open' } }],
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
      { key: 'recipe', status: 'ok', inputFingerprint: legacyRecipeStepFingerprint(r) },
      { key: 'detect', status: 'ok', inputFingerprint: '' },
      // The catalog fingerprint folds the detection snapshot, which only an
      // analysis pass can produce — the estimate only asks whether a row settled.
      { key: 'catalog', status: 'ok', inputFingerprint: 'settled-catalog' },
      // A spine an older build wrote: no named inputs, so each row is checked
      // against the step's OLD fingerprint once and settles.
      { key: 'interfaces', status: 'ok', inputFingerprint: legacyInterfacesFingerprint(r) },
      { key: 'seed', status: 'ok', inputFingerprint: legacySeedStepFingerprint(r) },
      { key: 'preparations', status: 'ok', inputFingerprint: legacyPreparationFingerprint(r) },
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
    // Read BACK through the store reader — this is what the externals view and the
    // setup report do, so the file has to satisfy the schema, not just be written.
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
      'preparations',
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

    // Every LLM call a run makes is a turn of a session, so that is the whole
    // of what `usage` says.
    expect(report.usage?.calls).toBeUndefined();
    expect(report.usage?.costUsd).toBe(report.usage?.sessions?.costUsd);
    expect(report.usage?.sessions?.count).toBeGreaterThan(0);
    expect(report.usage?.sessions?.turns).toBeGreaterThan(0);
    // The catalog row names the sessions-store run its session ran under.
    const catalog = report.steps.find((s) => s.key === 'catalog');
    expect(catalog?.status).toBe('ok');
    expect(catalog?.sessionRunId).toBeTruthy();
    expect((await listStoredSessionRuns(r)).map((run) => run.runId)).toContain(catalog?.sessionRunId);
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
    expect(await listStoredSessionRuns(r)).toHaveLength(1);
  }, 120_000);

  // Setup's steps are minutes of real work behind one label each. The phase inside
  // the step is what a watching user has to see, or the run reads as hung.
  it('streams the live phase of each step onto the tracker', async () => {
    const r = fixtureRepo();
    writeRecipe(r);
    scriptCatalogSession();
    const { tracker, details } = detailRecorder();

    await guardSetupInProcess(r, { tracker, interfaces: interfaces(), ...inertSeams });

    // Step 1 reuses the existing recipe, so what it spends its time on is the
    // analysis pass its needs comparison reads, then the live probe: booting
    // the server and calling a real route on it.
    expect(details.get('recipe')?.[0]).toBe('analyzing the repository');
    expect(details.get('recipe')?.some((line) => line.endsWith('probing a live route'))).toBe(true);
    // The pass is reported against whichever step first needs it, and step 2
    // reads the same memoized one back — so it announces nothing of its own.
    expect(details.get('detect') ?? []).not.toContain('analyzing the repository');
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
});

// ---------------------------------------------------------------------------
// API mode — the saved selection, and the per-run override
// ---------------------------------------------------------------------------

describe('guardSetupInProcess — the transport the sessions run on', () => {
  // The failure this pins: setup read the MODEL from the API config but not the
  // TRANSPORT, so it spawned `claude --model gpt-5.5` — a deterministic error. The
  // configured model must ride the configured transport.
  it('runs its sessions on this process\u2019s own Claude Code when the caller injects none', async () => {
    const r = fixtureRepo();
    writeRecipe(r);
    scriptCatalogSession();

    const { report } = await guardSetupInProcess(r, { interfaces: interfaces(), ...inertSeams });

    expect(report.status).toBe('ok');
    expect(sessionDriver.built).toEqual([{ mode: 'claude-code', model: 'opus' }]);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// Hosted injection — a caller that owns the driver, the transport and the key
// ---------------------------------------------------------------------------

describe('guardSetupInProcess — hosted injection', () => {
  // A hosted run answers the provider question itself: no global config is read.

  /** Where a hosted run's sessions are keyed — never the (ephemeral) work tree. */
  function sessionsHome(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-core-setup-key-'));
    repos.push(dir);
    return dir;
  }

  type ChecklistRow = { key: string; status: string; sessionKinds?: string[] };
  const checklistOf = (run: { display?: { blocks: { kind: string }[] } }): ChecklistRow[] => {
    const block = run.display?.blocks.find((b) => b.kind === 'checklist');
    return (block as { items: ChecklistRow[] } | undefined)?.items ?? [];
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
    const runs = await listStoredSessionRuns(key, 'guard-setup');
    expect(runs).toHaveLength(1);
    expect(await listStoredSessionRuns(r)).toEqual([]);
    expect(sessionsRunDirs).toEqual([sessionRunDir(key, 'guard-setup', runs[0].runId)]);
    // …and the record quotes the injected driver's own attribution.
    expect(runs[0].llm).toEqual({ mode: 'api', provider: 'test', model: 'scripted' });
    expect(runs[0].status).toBe('completed');
  }, 120_000);

  it.each([false, true])('keeps interface sessions inside setup, injected run=%s', async (injected) => {
    const r = fixtureRepo();
    writeRecipe(r);
    const key = sessionsHome();
    const parent = injected ? await createStoredSessionRun(key, { command: 'guard-setup', gitRef: 'abc' }) : undefined;
    fs.mkdirSync(path.dirname(guardInterfacesPath(r)), { recursive: true });
    fs.writeFileSync(guardInterfacesPath(r), JSON.stringify({
      version: 2, generatedAt: '2026-09-10T00:00:00Z',
      recipeFingerprint: computeRecipeFingerprint(r), interfaces: [],
      resources: { web: [{ id: 'root', kind: 'screen', title: 'Home', address: '/' }] },
    }));
    const { tracker } = detailRecorder();
    const onRunStarted = vi.fn();
    const { driver } = stubDriver(async (call) => {
      expect(call.kind).toBe('guard-interfaces.web-tasks');
      await call.emit(toolResult('check_draft'));
      return outcome({ interfaces: [], unresolved: ['No actions on this screen'] });
    });
    const { report, sessionsRunDirs } = await guardSetupInProcess(r, {
      ...inertSeams, authorInterfaces: undefined,
      catalogSession: async () => ({ status: 'ok', added: [], findings: [] }),
      driver, transportMode: 'api', sessionsKey: key,
      sessionRun: parent, tracker, onRunStarted, interfaces: interfaces(),
      seedSession: async () => {
        // Interfaces must not close the run before setup's later steps execute.
        expect((await listStoredSessionRuns(key))[0].status).toBe('running');
        return { status: 'skipped', reason: 'stubbed in this test' };
      },
    });
    const runs = await listStoredSessionRuns(key);
    expect(runs).toHaveLength(1);
    const [run] = runs;
    expect(run.command).toBe('guard-setup');
    expect(run.status).toBe(injected ? 'running' : 'completed');
    expect(run.sessions).toHaveLength(1);
    expect(run.sessions[0].kind).toBe('guard-interfaces.web-tasks');
    expect(checklistOf(run).find(row => row.key === 'interfaces')?.sessionKinds).toContain(run.sessions[0].kind);
    expect(report.steps.find(step => step.key === 'interfaces')?.sessionRunId).toBe(run.runId);
    expect(report.usage?.sessions?.count).toBe(1);
    expect(sessionsRunDirs).toEqual([sessionRunDir(key, 'guard-setup', run.runId)]);
    expect(onRunStarted).toHaveBeenCalledTimes(1);
    expect(onRunStarted.mock.calls[0][0].command).toBe('guard-setup');
    expect(await listStoredSessionRuns(r)).toEqual([]);
  }, 120_000);

  // An eager run is VISIBLE from the moment it starts — including one that dies
  // at the recipe gate, which a lazy, driver-first run leaves unrecorded. The
  // dead server reaches a boot repair first, and the session it could not run
  // is part of the record.
  it('opens the run eagerly with the step checklist, and closes it failed with the reason', async () => {
    const r = fixtureRepo();
    writeRecipe(r, { serve: ['node', path.join(r, 'missing.mjs')], readyTimeoutMs: 4000 });
    const key = sessionsHome();
    const { tracker } = detailRecorder();

    const { report } = await guardSetupInProcess(r, {
      driver: forbiddenDriver('the recipe gate fails before any session'),
      transportMode: 'claude-code',
      sessionsKey: key,
      eagerRun: true,
      tracker,
      interfaces: interfaces(),
      ...inertSeams,
    });

    expect(report.status).toBe('failed');
    const [run] = await listStoredSessionRuns(key, 'guard-setup');
    expect(run.sessions.map((s) => [s.kind, s.status])).toEqual([
      ['guard-setup.recipe-repair', 'failed'],
    ]);
    expect(run.status).toBe('failed');
    expect(run.error).toEqual({ message: report.reason, kind: 'setup' });
    expect(run.llm).toEqual({ mode: 'claude-code', provider: 'test', model: 'scripted' });
    // The checklist the run record carries, for a surface that can only read
    // run.json: the step that died carries the error, later steps never ran.
    expect(checklistOf(run).map((i) => i.key)).toEqual([
      'recipe',
      'detect',
      'catalog',
      'interfaces',
      'seed',
      'preparations',
      'auth',
    ]);
    expect(checklistOf(run)[0].status).toBe('error');
    expect(checklistOf(run)[1].status).toBe('pending');
    // Each step claims the session kinds that do its work, so a surface reading
    // run.json files every session under its step instead of after the list.
    expect(checklistOf(run).map((i) => [i.key, i.sessionKinds])).toEqual([
      ['recipe', ['guard-setup.recipe-repair']],
      ['detect', []],
      ['catalog', ['guard-setup.dependency-catalog']],
      ['interfaces', ['guard-setup.reconcile-interfaces', 'guard-interfaces.web-tasks']],
      ['seed', ['guard-setup.seed']],
      ['preparations', ['guard-setup.preparation-observations', 'guard-setup.preparations']],
      ['auth', ['guard-setup.auth-proof']],
    ]);
  }, 60_000);
});
