/**
 * Guard dashboard read routes over a HOSTED store (PgGuardStore + PgSpecStore).
 * The same Express routes, over the Postgres stores and an injected repo-doc
 * reader — so the guard tabs render Pg-backed data with NO local
 * filesystem access, scope to a commit via `?ref=`, and answer an empty envelope
 * (never baseline data) when no run is stored at that commit.
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
import { PgGuardStore, PgSpecStore } from '../../packages/data-store/src/index';
import { PgGuardOverlayStore } from '../../packages/data-store/src/index';
// Import the store setters from the PACKAGE (dist) specifiers — the SAME module
// instances the dashboard route uses, so setGuardStore actually swaps the store
// the route reads (source and dist are distinct singletons).
import { setGuardStore, resetGuardStore } from '@truecourse/core/lib/guard-store';
import { setSpecStore, resetSpecStore } from '@truecourse/core/lib/spec-store';
import { setGuardOverlayStore, resetGuardOverlayStore } from '@truecourse/core/lib/guard-overlays';
import { setRepoDocReader } from '@truecourse/core/lib/repo-doc-reader';
import { resolveProjectForRequest } from '@truecourse/core/config/current-project';
import { createTestApp, TEST_ORG } from '../helpers/test-app';
import { setupTestFixture, teardownTestFixture, type TestFixture } from '../helpers/test-fixture';
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

async function saveSet(commit: string, ids: Array<[string, string]>, scope?: string): Promise<void> {
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
    await guardStore.saveScenarios({ repoKey, commitSha: commit, ...(scope ? { scope } : {}) }, src);
  } finally {
    fs.rmSync(src, { recursive: true, force: true });
  }
}

const url = (suffix: string) => `/api/repos/${fixture.project.slug}/guard/${suffix}`;

beforeEach(async () => {
  fixture = await setupTestFixture();
  app = createTestApp();
  // The hosted store keys by the SAME canonical path the route resolves: the Pg
  // store matches keys by exact string, so the key has to be that path.
  repoKey = (await resolveProjectForRequest(TEST_ORG, fixture.project.slug)).path;
  client = new PGlite();
  db = drizzle(client, { schema }) as unknown as Db;
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  guardStore = new PgGuardStore(db);
  setGuardStore(guardStore);
  specStore = new PgSpecStore(db);
  setSpecStore(specStore);
  // Every guard read that composes a scratch tree materializes the repository's
  // overlays into it, so the row store must be there even with nothing registered.
  setGuardOverlayStore(new PgGuardOverlayStore(db, 'master-secret-at-least-32-chars-long!!'));
  setRepoDocReader(async (_repoKey, docPath) => (docPath === DOC ? DOC_CONTENT : null));
});

afterEach(async () => {
  resetGuardStore();
  resetSpecStore();
  resetGuardOverlayStore();
  setRepoDocReader(async () => null);
  await client.close();
  await teardownTestFixture(fixture.project.slug);
});

describe('Guard routes — hosted, commit-scoped', () => {
  it('scenarios?ref= returns the PR head set with headings joined via the doc reader (no FS)', async () => {
    await saveSet(HEAD, [['a1', 'alpha']]);
    await saveSet(OTHER, [['z9', 'beta']]);
    const res = await request(app).get(url(`scenarios?ref=${HEAD}`)).expect(200);
    expect(res.body.scenarios.map((s: { id: string }) => s.id)).toEqual(['a1']);
    expect(res.body.scenarios[0].headingText).toBe('Alpha');
  });

  it('latest?ref= returns the run stored at that commit', async () => {
    await guardStore.writeGuardRun(repoKey, runAt(HEAD, 'a1', 'fail'));
    const res = await request(app).get(url(`latest?ref=${HEAD}`)).expect(200);
    expect(res.body.latest.run.commit).toBe(HEAD);
    expect(res.body.latest.scenarios[0].outcome).toBe('fail');
  });

  it('latest?ref= with no run at that commit returns an empty envelope, NOT the baseline', async () => {
    // A baseline run exists — it must not leak into another commit's view.
    await guardStore.writeGuardLatest(repoKey, runAt('baselinesha', 'a1', 'pass'));
    const res = await request(app).get(url(`latest?ref=${HEAD}`)).expect(200);
    expect(res.body).toEqual({ latest: null });
  });

  it('staleness?ref= reflects Pg state (scenarios present, never run → runStale)', async () => {
    await saveSet(HEAD, [['a1', 'alpha']]);
    const res = await request(app).get(url(`staleness?ref=${HEAD}`)).expect(200);
    expect(res.body).toMatchObject({ hasScenarios: true, hasRun: false, runStale: true });
  });

  it("status without ref reads the default branch's set — a newer regen in a pull request's scope never shadows the repo view", async () => {
    // Anchor the repo view at `baselinesha` — the generate the hosted job
    // writes on the default branch.
    await guardStore.writeGuardResult(
      { repoKey, commitSha: 'baselinesha' },
      {
        generatedAt: '2026-07-01T00:00:00.000Z',
        status: 'ok',
        sectionsTotal: 1,
        sectionsChanged: 1,
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
    await saveSet('baselinesha', [['a1', 'alpha']]);
    await new Promise((r) => setTimeout(r, 5)); // strictly newer createdAt for the PR row
    // A PR regen persisted a NEWER, larger set + a report at its head, under its own scope.
    await saveSet(HEAD, [['z1', 'alpha'], ['z2', 'beta']], 'pr/7');
    await guardStore.writeGuardResult(
      { repoKey, commitSha: HEAD, scope: 'pr/7' },
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
    // The baseline's own report, never the PR head's newer one.
    expect(res.body.lastGenerate).toMatchObject({ generatedAt: '2026-07-01T00:00:00.000Z' });
  });

  it('status counts the sections of every doc the guard stores name', async () => {
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
    );
    await saveSet('baselinesha', [['a1', 'alpha']]);
    setRepoDocReader(async (_repoKey, docPath) => (docPath === DOC ? DOC_CONTENT : null));
    const res = await request(app).get(url('status')).expect(200);
    // Alpha (proven) + Beta, both sections of the doc the scenarios bind; the
    // one without a scenario reads as blocked.
    expect(res.body.sections).toMatchObject({ total: 2, byStatus: { succeeded: 1, blocked: 1 } });
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

describe('Guard routes — versions of the scenario set', () => {
  it('lists the default branch’s versions newest first with their provenance, and diffs two of them', async () => {
    await saveSet('gen1', [['a1', 'alpha']]);
    await new Promise((r) => setTimeout(r, 5));
    await saveSet('gen2', [['a1', 'alpha'], ['b1', 'beta']]);
    await new Promise((r) => setTimeout(r, 5));
    // A pull request's regenerate under its own scope is not in the default list.
    await saveSet('prhead', [['z1', 'zeta']], 'pr/7');

    const list = await request(app).get(url('versions')).expect(200);
    expect(list.body.versions.map((v: { commitSha: string }) => v.commitSha)).toEqual(['gen2', 'gen1']);
    expect(list.body.versions[0]).toMatchObject({ artifact: 'scenarios', scope: 'default', fileCount: 4 });
    const scoped = await request(app).get(url('versions?scope=pr%2F7')).expect(200);
    expect(scoped.body.versions.map((v: { commitSha: string }) => v.commitSha)).toEqual(['prhead']);
    await request(app).get(url('versions?artifact=nope')).expect(400);

    const [to, from] = list.body.versions as Array<{ id: string }>;
    const diff = await request(app).get(url(`versions/diff?from=${from!.id}&to=${to!.id}`)).expect(200);
    expect(diff.body.from.id).toBe(from!.id);
    expect(diff.body.diff.flows.added).toEqual([`${DOC}#beta`]);
    expect(diff.body.diff.sections.gained).toEqual([{ doc: DOC, anchor: 'beta' }]);
    await request(app).get(url('versions/diff?from=nope&to=' + to!.id)).expect(404);
    await request(app).get(url('versions/diff')).expect(400);
  });

  it('restores an older version as a new one, and the repo view reads it', async () => {
    await saveSet('gen1', [['a1', 'alpha']]);
    await new Promise((r) => setTimeout(r, 5));
    await saveSet('gen2', [['a1', 'alpha'], ['b1', 'beta']]);
    const list = await request(app).get(url('versions')).expect(200);
    const older = list.body.versions[1] as { id: string };

    await new Promise((r) => setTimeout(r, 5));
    const restored = await request(app).post(url(`versions/${older.id}/restore`)).expect(200);
    expect(restored.body.version).toMatchObject({ commitSha: 'gen1', fileCount: 3 });
    expect(restored.body.version.id).not.toBe(older.id);

    const after = await request(app).get(url('versions')).expect(200);
    expect(after.body.versions).toHaveLength(3);
    const scenarios = await request(app).get(url('scenarios')).expect(200);
    expect(scenarios.body.scenarios.map((s: { id: string }) => s.id)).toEqual(['a1']);
    await request(app).post(url('versions/nope/restore')).expect(404);
  });
});
