/**
 * Guard read-drivers over a HOSTED (PgGuardStore) store — the commit-aware,
 * de-filesystem behavior issue 07 adds. Exercises the driver functions directly
 * against a PGlite-backed guard store (+ Pg spec store for corpus presence, and a
 * analyze LATEST for the baseline-commit fallback), with an injected repo-doc
 * reader so heading joins never touch a local working tree.
 *
 * OSS (FileGuardStore) behavior is regression-covered by tests/server/guard-routes
 * and tests/core/guard-store; here we only assert the async staleness signature
 * still reflects the file store for a temp repo.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type EeDb } from '@truecourse/ee-db';
import { PgGuardStore, PgSpecStore } from '../../ee/packages/data-store/src/index';
import {
  setGuardStore,
  resetGuardStore,
  type RepoRef,
} from '../../packages/core/src/lib/guard-store';
import { setSpecStore, resetSpecStore } from '../../packages/core/src/lib/spec-store';
import { writeLatest } from '../../packages/core/src/lib/analysis-store';
import { setRepoDocReader } from '../../packages/core/src/lib/repo-doc-reader';
import {
  listGuardScenarios,
  readGuardScenarioSource,
  readGuardReport,
  readManifestForView,
  readGuardResultForView,
  readGuardHistoryForPr,
  computeGuardStaleness,
} from '../../packages/core/src/commands/guard-read';
import { setGuardGateHeadsLookup } from '../../packages/core/src/lib/guard-gate-pending';
import { guardManifestSections, type GuardGenerateReport } from '../../packages/shared/src/index';

const REPO = 'acme/api';
const DOC = 'docs/spec.md';
const DOC_CONTENT = '# Alpha\nbody a\n# Beta\nbody b\n';

const yaml = (id: string, section: string): string =>
  [
    'guard: 3',
    `id: ${id}`,
    `title: ${section} claim`,
    'binds:',
    `  - doc: ${DOC}`,
    `    section: ${section}`,
    '    fingerprint: "sha256:x"',
    'driver: cli',
    'steps:',
    '  - run: ["--help"]',
    '    expect:',
    '      exit: 0',
    '',
  ].join('\n');

const RECIPE = { build: 'pnpm build', entry: ['node', 'dist/index.js'] };

const REPORT = (over: Partial<GuardGenerateReport> = {}): GuardGenerateReport => ({
  generatedAt: '2026-07-06T00:00:00.000Z',
  status: 'ok',
  sectionsTotal: 1,
  sectionsChanged: 0,
  skippedUnchanged: 1,
  noChanges: false,
  written: [],
  coverageGaps: [],
  birthFindings: [],
  errors: [],
  extractionFailures: [],
  orphaned: [],
  ...over,
});

let client: PGlite;
let db: EeDb;
let guardStore: PgGuardStore;

/** Snapshot a scenario set (recipe + yaml + manifest) into the store at `commit`. */
async function saveSetFor(
  repoKey: string,
  commit: string,
  ids: Array<[string, string] | [string, string, 'passing' | 'failing']>,
): Promise<void> {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-guard-read-'));
  try {
    fs.writeFileSync(path.join(src, 'recipe.json'), JSON.stringify(RECIPE));
    fs.mkdirSync(path.join(src, 'core'), { recursive: true });
    const flows: unknown[] = [];
    for (const [id, section, status] of ids) {
      fs.writeFileSync(path.join(src, 'core', `${id}.yaml`), yaml(id, section));
      flows.push({
        flowId: `${DOC}#${section}`,
        flowFingerprint: 'sha256:x',
        bindings: [{ doc: DOC, anchor: section, fingerprint: 'sha256:x' }],
        scenarios: [{ id, surface: 'cli', ...(status ? { status } : {}) }],
        generationInputsHash: null,
        gaps: [],
      });
    }
    fs.writeFileSync(path.join(src, 'manifest.json'), JSON.stringify({ version: 3, flows }));
    await guardStore.saveScenarios({ repoKey, commitSha: commit } satisfies RepoRef, src);
  } finally {
    fs.rmSync(src, { recursive: true, force: true });
  }
}

const saveSet = (
  commit: string,
  ids: Array<[string, string] | [string, string, 'passing' | 'failing']>,
): Promise<void> => saveSetFor(REPO, commit, ids);

/**
 * A temp repo whose analyze LATEST anchors the guard baseline at `commit` —
 * the shape a hosted repo has after its default-branch verify. Caller removes it.
 */
async function makeBaselineRepo(commit: string): Promise<string> {
  const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-guard-baseline-'));
  await writeLatest(tmpRepo, {
    head: 'run.json',
    analysis: {
      id: 'r1',
      createdAt: '2026-07-01T00:00:00.000Z',
      branch: 'main',
      commitHash: commit,
      architecture: 'monolith',
      metadata: { isDiffAnalysis: false },
      status: 'completed',
    },
    graph: {
      services: [],
      serviceDependencies: [],
      layers: [],
      modules: [],
      methods: [],
      moduleDeps: [],
      methodDeps: [],
      databases: [],
      databaseConnections: [],
      flows: [],
    },
    violations: [],
  });
  return tmpRepo;
}

/** A stored run at `commit` with a single passing scenario. */
const RUN = (runId: string, commit: string, ranAt = '2026-07-08T00:00:00.000Z') => ({
  run: { runId, ranAt, branch: 'main', commit, recipeFingerprint: 'sha256:r', scenarioFormat: 3 },
  summary: { total: 1, pass: 1, fail: 0, stale: 0, orphaned: 0, error: 0 },
  scenarios: [
    {
      id: 'a1',
      title: 'alpha claim',
      binds: { doc: DOC, section: 'alpha', fingerprint: 'sha256:x' },
      outcome: 'pass' as const,
      durationMs: 1,
    },
  ],
  sections: [],
});

beforeEach(async () => {
  client = new PGlite();
  db = drizzle(client, { schema }) as unknown as EeDb;
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  guardStore = new PgGuardStore(db);
  setGuardStore(guardStore);
  setSpecStore(new PgSpecStore(db));
  // Heading joins read docs through this seam, never the local FS.
  setRepoDocReader(async (_repoKey, docPath) => (docPath === DOC ? DOC_CONTENT : null));
});

afterEach(async () => {
  resetGuardStore();
  resetSpecStore();
  setRepoDocReader(async () => null);
  await client.close();
});

describe('listGuardScenarios — commit-scoped (hosted)', () => {
  it('returns exactly the scenario set stored at the requested ref (no newest-set leak)', async () => {
    await saveSet('shaA1234567', [['a1', 'alpha']]);
    // A newer, different set at another commit must NOT bleed into ref A's view.
    await saveSet('shaB1234567', [['b1', 'beta'], ['b2', 'gamma']]);

    const a = await listGuardScenarios(REPO, 'shaA1234567');
    expect(a.scenarios.map((s) => s.id)).toEqual(['a1']);
    // Heading text joined via the injected reader (no FS).
    expect(a.scenarios[0]?.headingText).toBe('Alpha');

    const b = await listGuardScenarios(REPO, 'shaB1234567');
    expect(b.scenarios.map((s) => s.id).sort()).toEqual(['b1', 'b2']);
  });

  it('carries the status each test was COMMITTED with — a red test reads red before any run', async () => {
    // Guard commits a test that failed its birth execution, so the inventory has
    // to say so without `guard/LATEST.json`: a fresh clone lists its red tests as
    // red, and a later run outcome (joined client-side) simply wins over it.
    await saveSet('shaC1234567', [
      ['a1', 'alpha', 'failing'],
      ['b1', 'beta', 'passing'],
    ]);
    const view = await listGuardScenarios(REPO, 'shaC1234567');
    const byId = new Map(view.scenarios.map((s) => [s.id, s]));
    expect(byId.get('a1')?.status).toBe('failing');
    expect(byId.get('b1')?.status).toBe('passing');
  });

  it('with no ref, resolves the analyze baseline commit (never the newest stored set)', async () => {
    // The baseline anchor is the analyze LATEST, keyed by a temp repo path.
    const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-guard-baseline-'));
    try {
      await writeLatest(tmpRepo, {
        head: 'run.json',
        analysis: {
          id: 'r1',
          createdAt: '2026-07-01T00:00:00.000Z',
          branch: 'main',
          commitHash: 'baseline9999',
          architecture: 'monolith',
          metadata: { isDiffAnalysis: false },
          status: 'completed',
        },
        graph: {
          services: [],
          serviceDependencies: [],
          layers: [],
          modules: [],
          methods: [],
          moduleDeps: [],
          methodDeps: [],
          databases: [],
          databaseConnections: [],
          flows: [],
        },
        violations: [],
      });
      // A newest set at a PR head, and the real baseline set — no ref must pick baseline.
      const srcSave = async (commit: string, ids: Array<[string, string]>) => {
        const src = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-guard-read-'));
        fs.writeFileSync(path.join(src, 'recipe.json'), JSON.stringify(RECIPE));
        fs.mkdirSync(path.join(src, 'core'), { recursive: true });
        for (const [id, section] of ids) fs.writeFileSync(path.join(src, 'core', `${id}.yaml`), yaml(id, section));
        await guardStore.saveScenarios({ repoKey: tmpRepo, commitSha: commit }, src);
        fs.rmSync(src, { recursive: true, force: true });
      };
      await srcSave('baseline9999', [['base1', 'alpha']]);
      await srcSave('prhead0000', [['pr1', 'beta']]);

      const inv = await listGuardScenarios(tmpRepo);
      expect(inv.scenarios.map((s) => s.id)).toEqual(['base1']);
    } finally {
      fs.rmSync(tmpRepo, { recursive: true, force: true });
    }
  });
});

describe('listGuardScenarios — PR-head baseline fallback (hosted)', () => {
  it('a head with no stored set falls back to the baseline set, labelled by scenariosCommit', async () => {
    // The PR-gate shape: the set lives at the baseline; the head persisted nothing.
    const repo = await makeBaselineRepo('baseline9999');
    try {
      await saveSetFor(repo, 'baseline9999', [['a1', 'alpha']]);

      const inv = await listGuardScenarios(repo, 'prhead0000');
      expect(inv.scenarios.map((s) => s.id)).toEqual(['a1']);
      expect(inv.scenariosCommit).toBe('baseline9999');
      // The recipe card rides the same fallback (one saved set).
      expect(inv.recipe).toMatchObject({ surfaces: { cli: { build: RECIPE.build, entry: RECIPE.entry } } });
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it('a head WITH its own set never falls back, and labels itself', async () => {
    const repo = await makeBaselineRepo('baseline9999');
    try {
      await saveSetFor(repo, 'baseline9999', [['a1', 'alpha']]);
      await saveSetFor(repo, 'prhead0000', [['pr1', 'beta']]);

      const inv = await listGuardScenarios(repo, 'prhead0000');
      expect(inv.scenarios.map((s) => s.id)).toEqual(['pr1']);
      expect(inv.scenariosCommit).toBe('prhead0000');
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it('a head miss with NO baseline stays empty (no newest-set leak)', async () => {
    // REPO has no analyze LATEST → no baseline anchor; another commit's set
    // must not leak into an unknown ref's view.
    await saveSet('shaA1234567', [['a1', 'alpha']]);
    const inv = await listGuardScenarios(REPO, 'unknownsha12');
    expect(inv.scenarios).toEqual([]);
    expect(inv.recipe).toBeNull();
  });
});

describe('readGuardRecipeCard via listGuardScenarios — hosted (no working tree)', () => {
  it('is never falsely stale: no tree to fingerprint → stale null, recipe read at the ref', async () => {
    await saveSet('shaA1234567', [['a1', 'alpha']]);
    // A baseline run exists with a recorded fingerprint — the hosted card must
    // NOT compare a hash-of-nothing against it (that made stale permanently true).
    await guardStore.writeGuardLatest(REPO, {
      run: { runId: 'run-base', ranAt: '2026-07-07T00:00:00.000Z', branch: 'main', commit: 'basesha11111', recipeFingerprint: 'sha256:r', scenarioFormat: 3 },
      summary: { total: 1, pass: 1, fail: 0, stale: 0, orphaned: 0, error: 0 },
      scenarios: [{ id: 'a1', title: 'alpha claim', binds: { doc: DOC, section: 'alpha', fingerprint: 'sha256:x' }, outcome: 'pass', durationMs: 1 }],
      sections: [],
    });
    const inv = await listGuardScenarios(REPO, 'shaA1234567');
    expect(inv.recipe).not.toBeNull();
    expect(inv.recipe).toMatchObject({
      surfaces: { cli: { build: RECIPE.build, entry: RECIPE.entry } },
      stale: null,
    });
    // A recipe with neither an `api` nor a `web` block prepares neither surface —
    // the card carries no entry for them rather than an empty one.
    expect(inv.recipe!.surfaces.api).toBeUndefined();
    expect(inv.recipe!.surfaces.web).toBeUndefined();
  });

  it('surfaces api.services (datastore orchestration) on the card', async () => {
    const apiRecipe = {
      build: 'pnpm build',
      api: {
        serve: ['node', 'server.js'],
        services: { up: 'docker compose up -d --wait', down: 'docker compose down' },
      },
    };
    const src = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-guard-read-'));
    try {
      fs.writeFileSync(path.join(src, 'recipe.json'), JSON.stringify(apiRecipe));
      fs.writeFileSync(path.join(src, 'manifest.json'), JSON.stringify({ version: 3, flows: [] }));
      await guardStore.saveScenarios({ repoKey: REPO, commitSha: 'shaSvc123456' }, src);
    } finally {
      fs.rmSync(src, { recursive: true, force: true });
    }
    const inv = await listGuardScenarios(REPO, 'shaSvc123456');
    expect(inv.recipe).toMatchObject({
      surfaces: {
        api: {
          serve: ['node', 'server.js'],
          services: { up: 'docker compose up -d --wait', down: 'docker compose down' },
        },
      },
    });
    // Its own `api` block: the server is the api surface's, so nothing marks it
    // as borrowed from a web surface this recipe does not even declare.
    expect(inv.recipe!.surfaces.api!.sharedWithWeb).toBeUndefined();
  });

  /**
   * THE SHARED SERVER. The runner serves ONE surface for both web steps and
   * `request` steps, so a recipe with a `web` block and no `api` block still has
   * an api server — the web block's. The card says so rather than telling an api
   * reader that nothing is declared, which is the opposite of what runs.
   */
  it('gives the api surface the WEB block’s server when the recipe declares no api block', async () => {
    const webRecipe = {
      build: 'pnpm build',
      entry: ['node', 'dist/index.js'],
      web: { build: 'pnpm build:web', serve: ['node', 'dist/web.js'], healthPath: '/health', readyTimeoutMs: 60000 },
    };
    const src = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-guard-read-'));
    try {
      fs.writeFileSync(path.join(src, 'recipe.json'), JSON.stringify(webRecipe));
      fs.writeFileSync(path.join(src, 'manifest.json'), JSON.stringify({ version: 3, flows: [] }));
      await guardStore.saveScenarios({ repoKey: REPO, commitSha: 'shaWeb123456' }, src);
    } finally {
      fs.rmSync(src, { recursive: true, force: true });
    }
    const inv = await listGuardScenarios(REPO, 'shaWeb123456');
    const surfaces = inv.recipe!.surfaces;
    // The api surface reads the web block's fields, marked as the web surface's.
    expect(surfaces.api).toEqual({
      build: 'pnpm build:web',
      serve: ['node', 'dist/web.js'],
      healthPath: '/health',
      readyTimeoutMs: 60000,
      sharedWithWeb: true,
    });
    // …and the web surface reads the same server as ITS own — unmarked.
    expect(surfaces.web).toEqual({
      build: 'pnpm build:web',
      serve: ['node', 'dist/web.js'],
      healthPath: '/health',
      readyTimeoutMs: 60000,
    });
    // Nothing was invented in recipe.json: no api block exists to read back.
    expect(surfaces.api!.services).toBeUndefined();
  });
});

describe('hosted repo-level view with NO baseline — empty, never the newest set', () => {
  it('listGuardScenarios with no ref and no baseline returns empty (a PR set must not leak)', async () => {
    // Only a PR head's set is stored; the repo has no analyze baseline yet.
    await saveSet('prheadonly12', [['pr1', 'alpha']]);
    const inv = await listGuardScenarios(REPO);
    expect(inv).toEqual({ recipe: null, scenarios: [] });
  });

  it('readGuardReport with no ref and no baseline returns null (a PR report must not leak)', async () => {
    await guardStore.writeGuardResult({ repoKey: REPO, commitSha: 'prheadonly12' }, REPORT());
    expect(await readGuardReport(REPO)).toBeNull();
  });

  it('readGuardScenarioSource with no ref and no baseline returns null', async () => {
    await saveSet('prheadonly12', [['pr1', 'alpha']]);
    expect(await readGuardScenarioSource(REPO, 'pr1')).toBeNull();
  });

  it('computeGuardStaleness with no ref and no baseline is all-false (no newest-set probe)', async () => {
    await saveSet('prheadonly12', [['pr1', 'alpha']]);
    expect(await computeGuardStaleness(REPO)).toEqual({
      generateStale: false,
      runStale: false,
      hasCorpus: false,
      hasScenarios: false,
      hasGenerated: false,
      hasRun: false,
    });
  });
});

describe('readGuardHistoryForPr — the PR run timeline (hosted)', () => {
  afterEach(() => setGuardGateHeadsLookup(null));

  it('lists one run per pushed head (skipping unstored heads), never the baseline', async () => {
    // The gate ran three heads for PR 22; the middle push errored before storing
    // a run. A baseline run exists too — it must never appear in the PR timeline.
    setGuardGateHeadsLookup(async (repoKey, pr) =>
      repoKey === REPO && pr === 22 ? ['head2222alpha', 'headnorun999', 'head1111alpha'] : [],
    );
    await guardStore.writeGuardRun(REPO, RUN('run-h1', 'head1111alpha', '2026-07-08T00:00:00.000Z'));
    await guardStore.writeGuardRun(REPO, RUN('run-h2', 'head2222alpha', '2026-07-09T00:00:00.000Z'));
    await guardStore.writeGuardLatest(REPO, RUN('run-base', 'basesha11111', '2026-07-07T00:00:00.000Z'));

    const h = await readGuardHistoryForPr(REPO, 22);
    // Oldest-first, the GuardHistory convention (the panel orders for display).
    expect(h.runs.map((r) => r.runId)).toEqual(['run-h1', 'run-h2']);
    expect(h.runs.map((r) => r.commit)).toEqual(['head1111alpha', 'head2222alpha']);
  });

  it('no lookup installed (OSS) → empty, never a store-wide probe', async () => {
    await guardStore.writeGuardRun(REPO, RUN('run-h1', 'head1111alpha', '2026-07-08T00:00:00.000Z'));
    expect(await readGuardHistoryForPr(REPO, 22)).toEqual({ runs: [] });
  });
});

describe('readGuardScenarioSource — commit-scoped (hosted)', () => {
  it('reads the YAML source at the requested ref', async () => {
    await saveSet('shaA1234567', [['a1', 'alpha']]);
    const src = await readGuardScenarioSource(REPO, 'a1', 'shaA1234567');
    expect(src?.id).toBe('a1');
    expect(src?.content).toContain('id: a1');
    // A ref with no such scenario → null (no cross-commit leak).
    expect(await readGuardScenarioSource(REPO, 'a1', 'othersha1234')).toBeNull();
  });
});

describe('coverage/status view reads — PR-head baseline fallback (hosted)', () => {
  it('readGuardReport at an unreported head falls back to the baseline report', async () => {
    const repo = await makeBaselineRepo('baseline9999');
    try {
      await guardStore.writeGuardResult({ repoKey: repo, commitSha: 'baseline9999' }, REPORT());
      const report = await readGuardReport(repo, 'prhead0000');
      expect(report).not.toBeNull();
      expect(report?.generatedAt).toBe('2026-07-06T00:00:00.000Z');
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it('readManifestForView falls back to the baseline manifest; a head hit wins', async () => {
    const repo = await makeBaselineRepo('baseline9999');
    try {
      await saveSetFor(repo, 'baseline9999', [['a1', 'alpha']]);
      // Head miss → the baseline's manifest.
      const viaFallback = await readManifestForView(repo, 'prhead0000');
      expect(guardManifestSections(viaFallback).map((s) => s.anchor)).toEqual(['alpha']);
      // A head with its own set never falls back.
      await saveSetFor(repo, 'prhead0000', [['pr1', 'beta']]);
      const atHead = await readManifestForView(repo, 'prhead0000');
      expect(guardManifestSections(atHead).map((s) => s.anchor)).toEqual(['beta']);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it('readGuardResultForView falls back to the baseline result', async () => {
    const repo = await makeBaselineRepo('baseline9999');
    try {
      await guardStore.writeGuardResult({ repoKey: repo, commitSha: 'baseline9999' }, REPORT());
      const result = await readGuardResultForView(repo, 'prhead0000');
      expect(result?.generatedAt).toBe('2026-07-06T00:00:00.000Z');
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it('none of the view reads leak across commits when no baseline exists', async () => {
    await guardStore.writeGuardResult({ repoKey: REPO, commitSha: 'shaA1234567' }, REPORT());
    await saveSet('shaA1234567', [['a1', 'alpha']]);
    expect(await readGuardReport(REPO, 'unknownsha12')).toBeNull();
    expect(await readManifestForView(REPO, 'unknownsha12')).toBeNull();
    expect(await readGuardResultForView(REPO, 'unknownsha12')).toBeNull();
  });
});

describe('repo-level view reads (no ref) — baseline-anchored, never newest (hosted)', () => {
  // Force distinct createdAt rows: the Pg store orders commit-less reads by
  // createdAt DESC, so the second write must be strictly newer to reproduce
  // the "a PR's regen shadows the repo view" failure deterministically.
  const tick = () => new Promise((r) => setTimeout(r, 5));

  it('readManifestForView with no ref reads the baseline manifest, not a newer PR set', async () => {
    const repo = await makeBaselineRepo('baseline9999');
    try {
      await saveSetFor(repo, 'baseline9999', [['a1', 'alpha']]);
      await tick();
      // A PR regen persisted a NEWER set at its head — it must not shadow the repo view.
      await saveSetFor(repo, 'prhead0000', [['pr1', 'beta']]);

      const manifest = await readManifestForView(repo);
      expect(guardManifestSections(manifest).map((s) => s.anchor)).toEqual(['alpha']);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it('readGuardResultForView with no ref reads the baseline report, not a newer PR report', async () => {
    const repo = await makeBaselineRepo('baseline9999');
    try {
      await guardStore.writeGuardResult({ repoKey: repo, commitSha: 'baseline9999' }, REPORT());
      await tick();
      await guardStore.writeGuardResult(
        { repoKey: repo, commitSha: 'prhead0000' },
        REPORT({ generatedAt: '2026-07-10T00:00:00.000Z' }),
      );

      const result = await readGuardResultForView(repo);
      expect(result?.generatedAt).toBe('2026-07-06T00:00:00.000Z');
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it('with no ref and NO baseline, both view reads are absent (a PR row must not leak)', async () => {
    // Only PR-head rows are stored; REPO has no analyze LATEST → no baseline anchor.
    await saveSet('prheadonly12', [['pr1', 'alpha']]);
    await guardStore.writeGuardResult({ repoKey: REPO, commitSha: 'prheadonly12' }, REPORT());

    expect(await readManifestForView(REPO)).toBeNull();
    expect(await readGuardResultForView(REPO)).toBeNull();
  });
});

describe('readGuardReport — commit-scoped (hosted)', () => {
  it('reads the generate report at the ref and joins live section headings', async () => {
    await guardStore.writeGuardResult({ repoKey: REPO, commitSha: 'shaA1234567' }, REPORT({
      birthFindings: [{ doc: DOC, anchor: 'alpha', title: 'alpha finding', step: 1, expected: 'x', actual: 'y' }],
    }));
    const report = await readGuardReport(REPO, 'shaA1234567');
    expect(report?.birthFindings[0]).toMatchObject({ anchor: 'alpha', headingText: 'Alpha' });
    // A different ref has no report.
    expect(await readGuardReport(REPO, 'othersha1234')).toBeNull();
  });
});

describe('computeGuardStaleness — hosted (store-composed, no FS)', () => {
  it('nothing stored at the ref → all-false', async () => {
    expect(await computeGuardStaleness(REPO, 'shaA1234567')).toEqual({
      generateStale: false,
      runStale: false,
      hasCorpus: false,
      hasScenarios: false,
      hasGenerated: false,
      hasRun: false,
    });
  });

  it('corpus present but never generated → generateStale + hasCorpus', async () => {
    await new PgSpecStore(db).saveSpec({ repoKey: REPO, commitSha: 'shaA1234567' }, 'corpus', { keptDocs: [] });
    const s = await computeGuardStaleness(REPO, 'shaA1234567');
    expect(s).toMatchObject({ hasCorpus: true, hasGenerated: false, generateStale: true });
  });

  it('scenarios present but never run → runStale + hasScenarios', async () => {
    await saveSet('shaA1234567', [['a1', 'alpha']]);
    const s = await computeGuardStaleness(REPO, 'shaA1234567');
    expect(s).toMatchObject({ hasScenarios: true, hasRun: false, runStale: true });
  });

  it('generated + run present and fresh → both dots dark', async () => {
    await saveSet('shaA1234567', [['a1', 'alpha']]);
    await new PgSpecStore(db).saveSpec({ repoKey: REPO, commitSha: 'shaA1234567' }, 'corpus', { keptDocs: [] });
    await guardStore.writeGuardResult({ repoKey: REPO, commitSha: 'shaA1234567' }, REPORT());
    await guardStore.writeGuardRun(REPO, {
      run: { runId: 'run1', ranAt: '2026-07-08T00:00:00.000Z', branch: 'main', commit: 'shaA1234567', recipeFingerprint: 'sha256:r', scenarioFormat: 3 },
      summary: { total: 1, pass: 1, fail: 0, stale: 0, orphaned: 0, error: 0 },
      scenarios: [{ id: 'a1', title: 'alpha claim', binds: { doc: DOC, section: 'alpha', fingerprint: 'sha256:x' }, outcome: 'pass', durationMs: 1 }],
      sections: [],
    });
    const s = await computeGuardStaleness(REPO, 'shaA1234567');
    expect(s).toMatchObject({ hasCorpus: true, hasScenarios: true, hasGenerated: true, hasRun: true, generateStale: false, runStale: false });
  });

  it('an explicit ref with no run at that commit reports hasRun:false — no baseline-run fallback', async () => {
    await saveSet('shaA1234567', [['a1', 'alpha']]);
    // A baseline run exists at ANOTHER commit — it must not make the PR head look run.
    await guardStore.writeGuardLatest(REPO, {
      run: { runId: 'run-base', ranAt: '2026-07-07T00:00:00.000Z', branch: 'main', commit: 'basesha11111', recipeFingerprint: 'sha256:r', scenarioFormat: 3 },
      summary: { total: 1, pass: 1, fail: 0, stale: 0, orphaned: 0, error: 0 },
      scenarios: [{ id: 'a1', title: 'alpha claim', binds: { doc: DOC, section: 'alpha', fingerprint: 'sha256:x' }, outcome: 'pass', durationMs: 1 }],
      sections: [],
    });
    const s = await computeGuardStaleness(REPO, 'shaA1234567');
    expect(s).toMatchObject({ hasScenarios: true, hasRun: false, runStale: true });
  });

  it('a PR head with only a gate run falls back to the baseline for the generate-side stores', async () => {
    // The PR-gate shape: corpus + scenarios + generate result live at the
    // BASELINE commit; the head stores only the gate's run. The staleness gate
    // must see the baseline inputs (per-store fallback) AND the head's run.
    const repo = await makeBaselineRepo('baseline9999');
    try {
      await saveSetFor(repo, 'baseline9999', [['a1', 'alpha']]);
      await new PgSpecStore(db).saveSpec({ repoKey: repo, commitSha: 'baseline9999' }, 'corpus', { keptDocs: [] });
      await guardStore.writeGuardResult({ repoKey: repo, commitSha: 'baseline9999' }, REPORT());
      await guardStore.writeGuardRun(repo, RUN('run-pr', 'prhead0000'));

      expect(await computeGuardStaleness(repo, 'prhead0000')).toEqual({
        generateStale: false,
        runStale: false,
        hasCorpus: true,
        hasScenarios: true,
        hasGenerated: true,
        hasRun: true,
      });
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it('falls back per store: a head-rescanned corpus wins while scenarios still come from the baseline', async () => {
    const repo = await makeBaselineRepo('baseline9999');
    try {
      // The PR re-scanned specs (corpus stored at the head) but never regenerated
      // scenarios — corpus reads at the head, scenarios fall back independently.
      await new PgSpecStore(db).saveSpec({ repoKey: repo, commitSha: 'prhead0000' }, 'corpus', { keptDocs: [] });
      await saveSetFor(repo, 'baseline9999', [['a1', 'alpha']]);

      const s = await computeGuardStaleness(repo, 'prhead0000');
      expect(s).toMatchObject({ hasCorpus: true, hasScenarios: true });
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it('the run NEVER falls back: baseline scenarios show, but an ungated head stays hasRun:false', async () => {
    const repo = await makeBaselineRepo('baseline9999');
    try {
      await saveSetFor(repo, 'baseline9999', [['a1', 'alpha']]);
      // A baseline run exists — it must not make the ungated PR head look run.
      await guardStore.writeGuardLatest(repo, RUN('run-base', 'baseline9999', '2026-07-07T00:00:00.000Z'));

      const s = await computeGuardStaleness(repo, 'prhead0000');
      expect(s).toMatchObject({ hasScenarios: true, hasRun: false, runStale: true });
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it('run older than the generate → runStale (regenerated scenarios not yet re-run)', async () => {
    await saveSet('shaA1234567', [['a1', 'alpha']]);
    await guardStore.writeGuardResult({ repoKey: REPO, commitSha: 'shaA1234567' }, REPORT({ generatedAt: '2026-07-09T00:00:00.000Z' }));
    await guardStore.writeGuardRun(REPO, {
      run: { runId: 'run1', ranAt: '2026-07-08T00:00:00.000Z', branch: 'main', commit: 'shaA1234567', recipeFingerprint: 'sha256:r', scenarioFormat: 3 },
      summary: { total: 1, pass: 1, fail: 0, stale: 0, orphaned: 0, error: 0 },
      scenarios: [{ id: 'a1', title: 'alpha claim', binds: { doc: DOC, section: 'alpha', fingerprint: 'sha256:x' }, outcome: 'pass', durationMs: 1 }],
      sections: [],
    });
    const s = await computeGuardStaleness(REPO, 'shaA1234567');
    expect(s.runStale).toBe(true);
  });
});
