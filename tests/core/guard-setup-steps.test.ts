/**
 * SINGLE-STEP MODE — `guard setup --only-<step>`, driven through the core
 * adapter (`guardSetupInProcess({ only })`) because the merge of
 * `guard/setup.json` and the pre-flight estimate are its half of the feature.
 *
 * The rules under test:
 * - each flag runs ONLY its own step: steps before it replay from what they
 *   left on disk (the recipe from `recipe.json` — no discovery, no live
 *   endpoint probe), steps after it never start;
 * - a prior step nothing ever ran fails loud (`SetupStepNotReadyError`, naming
 *   the flag to run first) instead of quietly spending it here;
 * - `detect` always runs, so the detection snapshot is always this run's;
 * - the persisted report MERGES: the steps that did not run keep the previous
 *   report's rows, which is what keeps `guard status`, the externals view and
 *   skip-when-settled whole;
 * - the estimate gate prices only the chosen step.
 *
 * No LLM anywhere: every session seam is injected, exactly as
 * `tests/core/guard-setup.test.ts` does for the lanes it isolates.
 */

import { describe, it, expect, afterEach, afterAll, beforeAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { recipePath, readGuardSetup } from '@truecourse/guard-runner';
import { setDefaultTransport } from '@truecourse/shared/llm';
import type {
  GuardSetupAuthStep,
  GuardSetupCatalogSession,
  GuardSetupInterfacesStep,
  GuardSetupSeedSession,
} from '@truecourse/guard-generator';
import {
  guardSetupInProcess,
  estimateGuardSetupCost,
  SetupStepNotReadyError,
} from '../../packages/core/src/commands/guard-setup.js';

const FIXTURE = fileURLToPath(new URL('../fixtures/seed-draft', import.meta.url));

// Setup reads (and would write) the user-level LLM config; these run against a
// throwaway TRUECOURSE_HOME rather than the developer's real one.
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-setup-steps-home-'));
beforeAll(() => {
  process.env.TRUECOURSE_HOME = HOME;
});
afterAll(() => {
  delete process.env.TRUECOURSE_HOME;
  fs.rmSync(HOME, { recursive: true, force: true });
});

const repos: string[] = [];
beforeEach(() => setDefaultTransport(async () => 'ok'));
afterEach(() => {
  while (repos.length) fs.rmSync(repos.pop()!, { recursive: true, force: true });
  setDefaultTransport(undefined);
});

const DOC = 'docs/orgs.md';

/** The fixture app, copied out, with a corpus (setup runs AFTER `spec scan`). */
function fixtureRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-setup-steps-'));
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

/** The recipe setup will find, so step 1 reuses it rather than proposing one. */
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

/** The one analysis pass, stubbed: one external service and a one-table schema. */
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

/** Every session seam, recording which ones a run actually reached. */
function seams(): {
  reached: string[];
  catalogSession: GuardSetupCatalogSession;
  authorInterfaces: GuardSetupInterfacesStep;
  seedSession: GuardSetupSeedSession;
  verifyAuth: GuardSetupAuthStep;
} {
  const reached: string[] = [];
  return {
    reached,
    catalogSession: async () => {
      reached.push('catalog');
      return { status: 'ok', added: [], findings: [] };
    },
    authorInterfaces: async () => {
      reached.push('interfaces');
      return { status: 'ok' };
    },
    seedSession: async () => {
      reached.push('seed');
      return { status: 'skipped', reason: 'stubbed in this test' };
    },
    verifyAuth: async () => {
      reached.push('auth');
      return { status: 'skipped', reason: 'stubbed in this test' };
    },
  };
}

const stepKeys = (r: string): string[] => (readGuardSetup(r)?.steps ?? []).map((s) => s.key);

// ---------------------------------------------------------------------------
// --only-recipe
// ---------------------------------------------------------------------------

describe('--only-recipe', () => {
  it('runs the recipe step, keeps the free detect pass, and starts nothing after it', async () => {
    const r = fixtureRepo();
    writeRecipe(r);
    const s = seams();

    const { report } = await guardSetupInProcess(r, {
      only: 'recipe',
      interfaces: interfaces(),
      recipeRunner: neverCalled,
      ...s,
    });

    expect(report.status).toBe('ok');
    // The recipe step really ran: it probed a live route on the fixture server.
    expect(report.recipe).toMatchObject({ status: 'ok', outcome: 'exists' });
    expect(report.recipe.probes?.length).toBeGreaterThan(0);
    // Detect is free, so it always runs — and its snapshot is this run's.
    expect(report.detection?.externalServices.map((x) => x.service)).toEqual(['stripe']);
    // Nothing downstream started, and nothing downstream wrote a row.
    expect(s.reached).toEqual([]);
    expect(stepKeys(r)).toEqual(['recipe', 'detect']);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// --only-catalog — the recipe replays from recipe.json
// ---------------------------------------------------------------------------

describe('--only-catalog', () => {
  it('replays the recipe from disk — no discovery, no live probe — and stops after the catalog', async () => {
    const r = fixtureRepo();
    writeRecipe(r);
    const s = seams();

    const { report } = await guardSetupInProcess(r, {
      only: 'catalog',
      interfaces: interfaces(),
      recipeRunner: neverCalled,
      ...s,
    });

    // Replayed, not re-verified: a run that probed would carry probe rows.
    expect(report.recipe).toEqual({ status: 'ok', outcome: 'exists' });
    expect(report.recipe.probes).toBeUndefined();
    expect(s.reached).toEqual(['catalog']);
    // The replayed recipe step pushes NO row (the run that verified it owns
    // that row); detect and the chosen step do.
    expect(stepKeys(r)).toEqual(['detect', 'catalog']);
  }, 120_000);

  it('refuses when there is no recipe at all, naming --only-recipe', async () => {
    const r = fixtureRepo();
    const s = seams();

    const error = await guardSetupInProcess(r, {
      only: 'catalog',
      interfaces: interfaces(),
      recipeRunner: neverCalled,
      ...s,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SetupStepNotReadyError);
    expect((error as SetupStepNotReadyError).step).toBe('recipe');
    expect((error as SetupStepNotReadyError).message).toContain('--only-recipe');
    // Nothing was spent, and no half-written record was left behind.
    expect(s.reached).toEqual([]);
    expect(readGuardSetup(r)).toBeNull();
  }, 120_000);
});

// ---------------------------------------------------------------------------
// a prior soft step nobody ran
// ---------------------------------------------------------------------------

describe('a prior step not yet run', () => {
  it('--only-seed before any catalog run throws for the catalog step', async () => {
    const r = fixtureRepo();
    writeRecipe(r);
    const s = seams();

    const error = await guardSetupInProcess(r, {
      only: 'seed',
      interfaces: interfaces(),
      recipeRunner: neverCalled,
      ...s,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SetupStepNotReadyError);
    expect((error as SetupStepNotReadyError).step).toBe('catalog');
    expect((error as SetupStepNotReadyError).message).toContain('--only-catalog');
    expect(s.reached).toEqual([]);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// the merge — a single-step run keeps every other step's record
// ---------------------------------------------------------------------------

describe('the persisted report', () => {
  it('carries the untouched steps forward, and --refresh forces only the chosen one', async () => {
    const r = fixtureRepo();
    writeRecipe(r);
    const whole = seams();
    await guardSetupInProcess(r, {
      interfaces: interfaces(),
      recipeRunner: neverCalled,
      ...whole,
    });
    const before = readGuardSetup(r);
    expect(before?.steps.map((x) => x.key)).toEqual([
      'recipe',
      'detect',
      'catalog',
      'interfaces',
      'seed',
      'auth',
    ]);
    expect(whole.reached).toEqual(['catalog', 'interfaces', 'seed', 'auth']);

    // One step, forced: --refresh with --only-<step> re-runs that step alone.
    const single = seams();
    await guardSetupInProcess(r, {
      only: 'seed',
      refresh: true,
      interfaces: interfaces(),
      recipeRunner: neverCalled,
      ...single,
    });

    expect(single.reached).toEqual(['seed']);
    const after = readGuardSetup(r);
    // The whole spine survives…
    expect(after?.steps.map((x) => x.key)).toEqual([
      'recipe',
      'detect',
      'catalog',
      'interfaces',
      'seed',
      'auth',
    ]);
    // …with the untouched rows carried forward verbatim (their fingerprints are
    // what skip-when-settled reads on the next bare run)…
    const row = (report: typeof after, key: string) => report?.steps.find((x) => x.key === key);
    expect(row(after, 'recipe')).toEqual(row(before, 'recipe'));
    expect(row(after, 'catalog')).toEqual(row(before, 'catalog'));
    expect(row(after, 'auth')).toEqual(row(before, 'auth'));
    // …and the detection snapshot re-derived, because detect always runs.
    expect(after?.detection?.database).toEqual({ type: 'sqlite', driver: 'prisma', tables: 1 });
  }, 120_000);
});

// ---------------------------------------------------------------------------
// the estimate gate prices the chosen step alone
// ---------------------------------------------------------------------------

describe('estimateGuardSetupCost({ only })', () => {
  it('prices only the chosen step, never the ones that will not run', async () => {
    const r = fixtureRepo();

    const whole = await estimateGuardSetupCost(r);
    const seedOnly = await estimateGuardSetupCost(r, { only: 'seed' });

    expect((whole.stages ?? []).length).toBeGreaterThan(1);
    expect((seedOnly.stages ?? []).map((s) => s.stage)).toEqual(['guard-setup.seed']);
    // The interfaces step owns TWO kinds — the reconcile session and the
    // authoring run (this fixture has no screens, so only the first is quoted)
    // — and no other step's kind may appear.
    const interfacesOnly = await estimateGuardSetupCost(r, { only: 'interfaces', replace: true });
    expect((interfacesOnly.stages ?? []).length).toBeGreaterThan(0);
    for (const stage of interfacesOnly.stages ?? []) {
      expect(['guard-setup.reconcile-interfaces', 'guard-interfaces.web-tasks']).toContain(
        stage.stage,
      );
    }
  });
});
