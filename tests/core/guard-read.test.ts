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
  computeGuardStaleness,
} from '../../packages/core/src/commands/guard-read';
import type { GuardGenerateReport } from '../../packages/shared/src/index';

const REPO = 'acme/api';
const DOC = 'docs/spec.md';
const DOC_CONTENT = '# Alpha\nbody a\n# Beta\nbody b\n';

const yaml = (id: string, section: string): string =>
  [
    'guard: 1',
    `id: ${id}`,
    `title: ${section} claim`,
    'binds:',
    `  doc: ${DOC}`,
    `  section: ${section}`,
    '  fingerprint: "sha256:x"',
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
async function saveSet(commit: string, ids: Array<[string, string]>): Promise<void> {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-guard-read-'));
  try {
    fs.writeFileSync(path.join(src, 'recipe.json'), JSON.stringify(RECIPE));
    fs.mkdirSync(path.join(src, 'core'), { recursive: true });
    const sections: unknown[] = [];
    for (const [id, section] of ids) {
      fs.writeFileSync(path.join(src, 'core', `${id}.yaml`), yaml(id, section));
      sections.push({ doc: DOC, anchor: section, fingerprint: 'sha256:x', scenarioIds: [id], generationInputsHash: null });
    }
    fs.writeFileSync(path.join(src, 'manifest.json'), JSON.stringify({ guard: 1, sections }));
    await guardStore.saveScenarios({ repoKey: REPO, commitSha: commit } satisfies RepoRef, src);
  } finally {
    fs.rmSync(src, { recursive: true, force: true });
  }
}

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

describe('readGuardRecipeCard via listGuardScenarios — hosted (no working tree)', () => {
  it('is never falsely stale: no tree to fingerprint → stale null, recipe read at the ref', async () => {
    await saveSet('shaA1234567', [['a1', 'alpha']]);
    // A baseline run exists with a recorded fingerprint — the hosted card must
    // NOT compare a hash-of-nothing against it (that made stale permanently true).
    await guardStore.writeGuardLatest(REPO, {
      run: { runId: 'run-base', ranAt: '2026-07-07T00:00:00.000Z', branch: 'main', commit: 'basesha11111', recipeFingerprint: 'sha256:r', scenarioFormat: 1 },
      summary: { total: 1, pass: 1, fail: 0, stale: 0, orphaned: 0, error: 0 },
      scenarios: [{ id: 'a1', title: 'alpha claim', binds: { doc: DOC, section: 'alpha', fingerprint: 'sha256:x' }, outcome: 'pass', durationMs: 1 }],
      sections: [],
    });
    const inv = await listGuardScenarios(REPO, 'shaA1234567');
    expect(inv.recipe).not.toBeNull();
    expect(inv.recipe).toMatchObject({ build: RECIPE.build, entry: RECIPE.entry, stale: null });
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
      run: { runId: 'run1', ranAt: '2026-07-08T00:00:00.000Z', branch: 'main', commit: 'shaA1234567', recipeFingerprint: 'sha256:r', scenarioFormat: 1 },
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
      run: { runId: 'run-base', ranAt: '2026-07-07T00:00:00.000Z', branch: 'main', commit: 'basesha11111', recipeFingerprint: 'sha256:r', scenarioFormat: 1 },
      summary: { total: 1, pass: 1, fail: 0, stale: 0, orphaned: 0, error: 0 },
      scenarios: [{ id: 'a1', title: 'alpha claim', binds: { doc: DOC, section: 'alpha', fingerprint: 'sha256:x' }, outcome: 'pass', durationMs: 1 }],
      sections: [],
    });
    const s = await computeGuardStaleness(REPO, 'shaA1234567');
    expect(s).toMatchObject({ hasScenarios: true, hasRun: false, runStale: true });
  });

  it('run older than the generate → runStale (regenerated scenarios not yet re-run)', async () => {
    await saveSet('shaA1234567', [['a1', 'alpha']]);
    await guardStore.writeGuardResult({ repoKey: REPO, commitSha: 'shaA1234567' }, REPORT({ generatedAt: '2026-07-09T00:00:00.000Z' }));
    await guardStore.writeGuardRun(REPO, {
      run: { runId: 'run1', ranAt: '2026-07-08T00:00:00.000Z', branch: 'main', commit: 'shaA1234567', recipeFingerprint: 'sha256:r', scenarioFormat: 1 },
      summary: { total: 1, pass: 1, fail: 0, stale: 0, orphaned: 0, error: 0 },
      scenarios: [{ id: 'a1', title: 'alpha claim', binds: { doc: DOC, section: 'alpha', fingerprint: 'sha256:x' }, outcome: 'pass', durationMs: 1 }],
      sections: [],
    });
    const s = await computeGuardStaleness(REPO, 'shaA1234567');
    expect(s.runStale).toBe(true);
  });
});
