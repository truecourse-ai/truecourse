/**
 * Guard dashboard read routes over a HOSTED store (PgGuardStore + PgSpecStore).
 * The same OSS Express routes, but with the enterprise stores installed and an
 * injected repo-doc reader — so the guard tabs render Pg-backed data with NO local
 * filesystem access, scope to the PR head via `?ref=`, and surface an explicit
 * pending/empty envelope (never baseline data) when no run is stored at that head.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { type Express } from 'express';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type Db } from '@truecourse/db';
import { PgGuardStore, PgSpecStore } from '../../ee/packages/data-store/src/index';
// Import the store setters from the PACKAGE (dist) specifiers — the SAME module
// instances the dashboard route uses, so setGuardStore actually swaps the store
// the route reads (source and dist are distinct singletons).
import { setGuardStore, resetGuardStore } from '@truecourse/core/lib/guard-store';
import { setSpecStore, resetSpecStore } from '@truecourse/core/lib/spec-store';
import { setRepoDocReader } from '@truecourse/core/lib/repo-doc-reader';
import { setGuardGatePendingLookup } from '@truecourse/core/lib/guard-gate-pending';
import { resolveProjectForRequest } from '@truecourse/core/config/current-project';
import { createTestApp } from '../helpers/test-app';
import { writeLatest } from '@truecourse/core/lib/analysis-store';
import { setupTestFixture, teardownTestFixture, type TestFixture } from '../helpers/test-db';
import type { GuardLatest } from '../../packages/shared/src/index';

const DOC = 'docs/spec.md';
const DOC_CONTENT = '# Alpha\nbody a\n# Beta\nbody b\n';
const HEAD = 'prhead1234567';
const OTHER = 'otherhead9999';

const yaml = (id: string, section: string): string =>
  [
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

const runAt = (commit: string, id: string, outcome: GuardLatest['scenarios'][number]['outcome']): GuardLatest => ({
  run: { runId: `run-${commit}`, ranAt: '2026-07-08T00:00:00.000Z', branch: 'main', commit, recipeFingerprint: 'sha256:r' },
  summary: { total: 1, pass: outcome === 'pass' ? 1 : 0, fail: outcome === 'fail' ? 1 : 0, stale: 0, orphaned: 0, error: 0 },
  scenarios: [{ id, title: `${id} claim`, binds: { doc: DOC, section: 'alpha', fingerprint: 'sha256:x' }, outcome, durationMs: 2 }],
  sections: [],
});

let client: PGlite;
let db: Db;
let guardStore: PgGuardStore;
let specStore: PgSpecStore;
let app: Express;
let fixture: TestFixture;
let repoKey: string;

async function saveSet(commit: string, ids: Array<[string, string]>): Promise<void> {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-guard-hosted-'));
  try {
    fs.writeFileSync(path.join(src, 'recipe.json'), JSON.stringify({ build: 'pnpm build', entry: ['node', 'dist/index.js'] }));
    fs.mkdirSync(path.join(src, 'core'), { recursive: true });
    const flows: unknown[] = [];
    for (const [id, section] of ids) {
      fs.writeFileSync(path.join(src, 'core', `${id}.yaml`), yaml(id, section));
      flows.push({
        flowId: `${DOC}#${section}`,
        flowFingerprint: 'sha256:x',
        bindings: [{ doc: DOC, anchor: section, fingerprint: 'sha256:x' }],
        scenarios: [{ id, surface: 'cli' }],
        generationInputsHash: null,
        gaps: [],
      });
    }
    fs.writeFileSync(path.join(src, 'manifest.json'), JSON.stringify({ flows }));
    await guardStore.saveScenarios({ repoKey, commitSha: commit }, src);
  } finally {
    fs.rmSync(src, { recursive: true, force: true });
  }
}

const url = (suffix: string) => `/api/repos/${fixture.project.slug}/guard/${suffix}`;

beforeEach(async () => {
  fixture = await setupTestFixture();
  app = createTestApp();
  // The hosted store keys by the SAME canonical path the route resolves (the Pg
  // store matches keys by exact string, unlike the FS store's symlink-following).
  repoKey = (await resolveProjectForRequest(fixture.project.slug)).path;
  client = new PGlite();
  db = drizzle(client, { schema }) as unknown as Db;
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  guardStore = new PgGuardStore(db);
  setGuardStore(guardStore);
  specStore = new PgSpecStore(db);
  setSpecStore(specStore);
  setRepoDocReader(async (_repoKey, docPath) => (docPath === DOC ? DOC_CONTENT : null));
});

afterEach(async () => {
  resetGuardStore();
  resetSpecStore();
  setRepoDocReader(async () => null);
  setGuardGatePendingLookup(null);
  await client.close();
  await teardownTestFixture(fixture.project.slug);
});

describe('Guard routes — hosted, PR-scoped', () => {
  it('scenarios?ref= returns the PR head set with headings joined via the doc reader (no FS)', async () => {
    await saveSet(HEAD, [['a1', 'alpha']]);
    await saveSet(OTHER, [['z9', 'beta']]);
    const res = await request(app).get(url(`scenarios?ref=${HEAD}`)).expect(200);
    expect(res.body.scenarios.map((s: { id: string }) => s.id)).toEqual(['a1']);
    expect(res.body.scenarios[0].headingText).toBe('Alpha');
  });

  it('latest?ref= returns the run stored at that head', async () => {
    await guardStore.writeGuardRun(repoKey, runAt(HEAD, 'a1', 'fail'));
    const res = await request(app).get(url(`latest?ref=${HEAD}`)).expect(200);
    expect(res.body.pending).toBeNull();
    expect(res.body.latest.run.commit).toBe(HEAD);
    expect(res.body.latest.scenarios[0].outcome).toBe('fail');
  });

  it('latest?ref= with no run at the head returns an empty envelope, NOT the baseline', async () => {
    // A baseline run exists — it must not leak into a PR-head view.
    await guardStore.writeGuardLatest(repoKey, runAt('baselinesha', 'a1', 'pass'));
    const res = await request(app).get(url(`latest?ref=${HEAD}`)).expect(200);
    expect(res.body).toEqual({ latest: null, pending: null });
  });

  it('latest?ref= labels an in-flight gate via the pending lookup', async () => {
    setGuardGatePendingLookup(async (_repo, headSha) =>
      headSha === HEAD ? { status: 'running', jobId: 'job_abc' } : null,
    );
    const res = await request(app).get(url(`latest?ref=${HEAD}`)).expect(200);
    expect(res.body).toEqual({ latest: null, pending: { status: 'running', jobId: 'job_abc' } });
  });

  it('staleness?ref= reflects Pg state (scenarios present, never run → runStale)', async () => {
    await saveSet(HEAD, [['a1', 'alpha']]);
    const res = await request(app).get(url(`staleness?ref=${HEAD}`)).expect(200);
    expect(res.body).toMatchObject({ hasScenarios: true, hasRun: false, runStale: true });
  });

  it('status without ref reads the baseline set — a newer PR regen never shadows the repo view', async () => {
    // Anchor the repo baseline (the analyze LATEST commit) at `baselinesha`.
    await writeLatest(repoKey, {
      head: 'run.json',
      analysis: {
        id: 'r1',
        createdAt: '2026-07-01T00:00:00.000Z',
        branch: 'main',
        commitHash: 'baselinesha',
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
    await saveSet('baselinesha', [['a1', 'alpha']]);
    await new Promise((r) => setTimeout(r, 5)); // strictly newer createdAt for the PR row
    // A PR regen persisted a NEWER, larger set + a report at its head.
    await saveSet(HEAD, [['z1', 'alpha'], ['z2', 'beta']]);
    await guardStore.writeGuardResult(
      { repoKey, commitSha: HEAD },
      {
        generatedAt: '2026-07-09T00:00:00.000Z',
        status: 'ok',
        sectionsTotal: 2,
        sectionsChanged: 2,
        skippedUnchanged: 0,
        noChanges: false,
        written: [],
        coverageGaps: [],
        birthFindings: [],
        errors: [],
        extractionFailures: [],
        orphaned: [],
      },
    );

    const res = await request(app).get(url('status')).expect(200);
    // The baseline manifest (1 section), not the PR head's newer 2-section set.
    expect(res.body.coverage).toMatchObject({ totalSections: 1 });
    // No generate report exists at the baseline — the PR head's must not leak.
    expect(res.body.lastGenerate).toBeNull();
  });

  it('status counts sections of every corpus doc from the stored corpus, not only the docs with scenarios', async () => {
    const OTHER_DOC = 'docs/other.md';
    // The baseline generate report anchors the repo view's commit, as the hosted job writes it.
    await guardStore.writeGuardResult(
      { repoKey, commitSha: 'baselinesha' },
      {
        generatedAt: '2026-07-09T00:00:00.000Z',
        status: 'ok',
        sectionsTotal: 2,
        sectionsChanged: 2,
        skippedUnchanged: 0,
        noChanges: false,
        written: [],
        coverageGaps: [],
        birthFindings: [],
        errors: [],
        extractionFailures: [],
        orphaned: [],
      },
      { baseline: true },
    );
    await saveSet('baselinesha', [['a1', 'alpha']]);
    // The scan's corpus lives in the spec store; a hosted repo has no corpus.json.
    await specStore.saveSpec({ repoKey, commitSha: 'baselinesha' }, 'corpus', {
      version: 3,
      generatedAt: '2026-01-01T00:00:00Z',
      docs: [
        { ref: DOC, kind: 'prd', lastTouched: '2026-01-01T00:00:00Z', areaTags: ['cli'] },
        { ref: OTHER_DOC, kind: 'prd', lastTouched: '2026-01-01T00:00:00Z', areaTags: ['cli'] },
      ],
      areas: [{ id: 'cli', product: 'cli', concern: 'cli', docRefs: [DOC, OTHER_DOC], overlaps: [] }],
    });
    setRepoDocReader(async (_repoKey, docPath) =>
      docPath === DOC ? DOC_CONTENT : docPath === OTHER_DOC ? '# Gamma\nbody c\n' : null,
    );
    const res = await request(app).get(url('status')).expect(200);
    // Alpha (proven) + Beta from the doc the scenarios bind, Gamma from the doc
    // nothing binds yet; the two without a scenario read as blocked.
    expect(res.body.sections).toMatchObject({ total: 3, byStatus: { succeeded: 1, blocked: 2 } });
  });

  it('coverage?ref= paints sections from the PR head run (not the baseline)', async () => {
    await guardStore.writeGuardLatest(repoKey, runAt('baselinesha', 'a1', 'pass'));
    await guardStore.writeGuardRun(repoKey, runAt(HEAD, 'a1', 'fail'));
    const res = await request(app).get(url(`coverage?doc=${encodeURIComponent(DOC)}&ref=${HEAD}`)).expect(200);
    const alpha = res.body.sections.find((s: { anchor: string }) => s.anchor === 'alpha');
    expect(alpha.status).toBe('fail');
    expect(res.body.runId).toBe(`run-${HEAD}`);
  });
});
