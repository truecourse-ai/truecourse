/**
 * The versioned guard series: every save is a new version with its
 * provenance, a version is addressable by id whatever its scope, a rollback
 * is a copy that becomes current (with the report it was paired with copied
 * beside it, both saying what they restored), and retention trims a series
 * while the content pool is swept of what no surviving version references.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq, sql } from 'drizzle-orm';
import { schema, MIGRATIONS_DIR, content, guardResults, guardScenarioSets, workspaceSpecSets, type Db } from '@truecourse/db';
import type { GuardGenerateReport } from '@truecourse/shared';
import {
  ContentStore,
  PgGuardStore,
  PgSpecStore,
  VERSION_RETENTION,
  contentScope,
  sweepRepoVersions,
  sweepStoredVersions,
} from '../../packages/data-store/src/index';
import { sweepCutoff } from '../../packages/data-store/src/retention';

const REPO = 'acme/api';
const ORG = 'org_acme';

let client: PGlite;
let db: Db;
let store: PgGuardStore;

beforeEach(async () => {
  client = new PGlite();
  const d = drizzle(client, { schema });
  await migrate(d, { migrationsFolder: MIGRATIONS_DIR });
  db = d as unknown as Db;
  store = new PgGuardStore(db);
});
afterEach(async () => {
  await client.close();
});

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 5));

/** Save a scenario set holding one yaml whose body is `body`. */
async function saveSet(commit: string, body: string, opts: { scope?: string; run?: string; model?: string } = {}): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-guard-versions-'));
  try {
    fs.mkdirSync(path.join(dir, 'core'));
    fs.writeFileSync(path.join(dir, 'core', 'one.yaml'), body);
    const { versionId } = await store.saveScenarios(
      { repoKey: REPO, commitSha: commit, ...(opts.scope ? { scope: opts.scope } : {}) },
      dir,
      { producedByRun: opts.run ?? null, model: opts.model ?? null },
    );
    return versionId;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** A generate report stamped `generatedAt`, written at `commit` beside the set just saved there. */
async function saveReport(commit: string, generatedAt: string, evidence: Record<string, string> = {}): Promise<void> {
  const report: GuardGenerateReport = {
    generatedAt,
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
  };
  await store.writeGuardResult({ repoKey: REPO, commitSha: commit }, report, { producedByRun: `gen-${commit}`, model: 'opus' });
  if (Object.keys(evidence).length > 0) {
    await store.writeGuardResultEvidence({ repoKey: REPO, commitSha: commit }, 'birth', evidence);
  }
}

const bodiesInPool = async (scope: string): Promise<string[]> =>
  (await db.select({ body: content.body }).from(content).where(eq(content.scope, scope))).map((r) => r.body).sort();

/** Backdate a version row and the bodies it put, so retention and the sweep see them as old. */
async function backdate(versionId: string, days: number): Promise<void> {
  const stamp = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  await db.update(guardScenarioSets).set({ createdAt: stamp }).where(eq(guardScenarioSets.id, versionId));
  await db.execute(sql`update content set created_at = ${stamp} where scope = ${contentScope.guard(REPO)}`);
}

describe('guard versions', () => {
  it('lists a series newest first with its provenance, reads one by id whatever its scope', async () => {
    const v1 = await saveSet('c1', 'one', { run: 'run-1', model: 'opus' });
    await tick();
    const v2 = await saveSet('c2', 'two', { run: 'run-2', model: 'sonnet' });
    await tick();
    const pr = await saveSet('head', 'pr', { scope: 'pr/7', run: 'run-3' });

    const versions = await store.listGuardVersions(REPO, 'scenarios');
    expect(versions.map((v) => [v.id, v.commitSha, v.producedByRun, v.model, v.fileCount])).toEqual([
      [v2, 'c2', 'run-2', 'sonnet', 1],
      [v1, 'c1', 'run-1', 'opus', 1],
    ]);
    expect(versions[0]!.createdAt).toMatch(/Z$/);
    expect(await store.listGuardVersions(REPO, 'scenarios', { limit: 1 })).toHaveLength(1);
    expect((await store.listGuardVersions(REPO, 'scenarios', { scope: 'pr/7' })).map((v) => v.id)).toEqual([pr]);

    // By id, across scopes; the current one when nothing is named.
    expect(await store.readGuardVersion(REPO, 'scenarios', pr)).toMatchObject({ scope: 'pr/7', producedByRun: 'run-3' });
    expect(await store.readScenarioFile(REPO, '.truecourse/scenarios/core/one.yaml', { id: v1 })).toBe('one');
    expect(await store.readScenarioFile(REPO, '.truecourse/scenarios/core/one.yaml', { id: pr })).toBe('pr');
    expect(await store.readScenarioFile(REPO, '.truecourse/scenarios/core/one.yaml')).toBe('two');
    expect(await store.readGuardVersion(REPO, 'scenarios', 'nope')).toBeNull();
    expect(await store.readGuardVersion('other/repo', 'scenarios', v1)).toBeNull();
  });

  it('a rollback is a new version holding the old files, and it becomes current', async () => {
    const v1 = await saveSet('c1', 'one');
    await tick();
    await saveSet('c2', 'two');
    await tick();

    const restored = await store.restoreGuardScenarioSet(REPO, v1, { producedByRun: null, model: null });
    expect(restored).toMatchObject({ artifact: 'scenarios', commitSha: 'c1', scope: 'default', fileCount: 1, restoredFrom: v1 });
    expect(restored!.id).not.toBe(v1);
    expect(await store.readScenarioFile(REPO, '.truecourse/scenarios/core/one.yaml')).toBe('one');
    const versions = await store.listGuardVersions(REPO, 'scenarios');
    expect(versions.map((v) => [v.commitSha, v.restoredFrom])).toEqual([['c1', v1], ['c2', null], ['c1', null]]);
    expect(await store.readGuardVersion(REPO, 'scenarios', restored!.id)).toMatchObject({ restoredFrom: v1 });
    expect(await store.restoreGuardScenarioSet(REPO, 'nope')).toBeNull();
  });

  it('a rollback brings back the report its set was born with, evidence and all', async () => {
    // Two generates at ONE commit — the shape a decision-triggered regenerate has.
    const v1 = await saveSet('c1', 'one');
    await saveReport('c1', '2026-01-01T00:00:00Z', { 'transcript.md': 'born with one' });
    await tick();
    await saveSet('c1', 'two');
    await saveReport('c1', '2026-01-02T00:00:00Z');
    await tick();
    // A report a run produced is nobody's copy.
    const [current] = await store.listGuardVersions(REPO, 'report');
    expect(current).toMatchObject({ restoredFrom: null, producedByRun: 'gen-c1', fileCount: null });

    await store.restoreGuardScenarioSet(REPO, v1);

    // The newest report at the commit — what the repo view reads — is the
    // copy of the first generate's, not the second's, and it says so.
    expect((await store.readGuardResult(REPO, { commitSha: 'c1' }))?.generatedAt).toBe('2026-01-01T00:00:00Z');
    const reports = await store.listGuardVersions(REPO, 'report');
    expect(reports).toHaveLength(3);
    expect(reports[0]).toMatchObject({ restoredFrom: reports[2]!.id, producedByRun: null });
    // The copy carries the evidence manifest, so the transcripts stay referenced and readable.
    const [copy] = await db.select({ evidence: guardResults.evidence }).from(guardResults).where(eq(guardResults.id, reports[0]!.id));
    expect(Object.keys(copy!.evidence as Record<string, string>)).toEqual(['birth/transcript.md']);
    expect(await store.readGuardEvidenceAt(REPO, '.truecourse/guard/evidence/gen-x/birth', 'transcript.md')).toBe('born with one');
  });

  it('retention keeps the newest versions and anything young, and sweeps the pool behind the rest', async () => {
    // One more than retention keeps, every one of them old enough to go.
    const ids: string[] = [];
    for (let i = 0; i <= VERSION_RETENTION.keep; i += 1) {
      ids.push(await saveSet(`c${i}`, `body-${i}`));
      await tick();
    }
    for (const id of ids) await backdate(id, VERSION_RETENTION.keepDays + 1);

    const swept = await sweepRepoVersions(db, REPO);
    expect(swept.versions).toBe(1);
    // The oldest went, with its body; the newest `keep` stayed.
    expect((await store.listGuardVersions(REPO, 'scenarios')).map((v) => v.commitSha)).not.toContain('c0');
    expect(await bodiesInPool(contentScope.guard(REPO))).not.toContain('body-0');
    expect(swept.bodies).toEqual({ guard: 1, evidence: 0 });

    // A save applies retention itself: the young version stays, and the one it
    // pushed beyond the count goes.
    await saveSet('young', 'body-young');
    const after = (await store.listGuardVersions(REPO, 'scenarios')).map((v) => v.commitSha);
    expect(after).toHaveLength(VERSION_RETENTION.keep);
    expect(after[0]).toBe('young');
    expect(after).not.toContain('c1');
  });

  it('never sweeps a body younger than the grace period, even when nothing references it', async () => {
    await saveSet('c1', 'one');
    // An orphan put a moment ago — a save whose version row is on its way.
    await db.insert(content).values({
      scope: contentScope.guard(REPO),
      sha: 'sha256-orphan',
      body: 'in flight',
      createdAt: new Date().toISOString(),
    });
    await sweepRepoVersions(db, REPO);
    expect(await bodiesInPool(contentScope.guard(REPO))).toContain('in flight');
  });

  it('a save that re-puts an old orphaned body renews its grace, so a concurrent sweep leaves it', async () => {
    const v1 = await saveSet('c1', 'one');
    await tick();
    await saveSet('c2', 'two');
    // The first version is gone (an earlier deployment's upsert, say) and its
    // body is an old orphan the boot sweep is about to take.
    await db.delete(guardScenarioSets).where(eq(guardScenarioSets.id, v1));
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    await db.execute(sql`update content set created_at = ${old} where scope = ${contentScope.guard(REPO)}`);
    // A save re-references that exact body: it is put again before its row lands...
    await saveSet('c3', 'one');
    // ...and a sweep that computed its live set BEFORE that row (an empty one
    // here) must not take it: the re-put moved the body inside the grace.
    await new ContentStore(db).gc(contentScope.guard(REPO), new Set(), sweepCutoff());
    expect(await bodiesInPool(contentScope.guard(REPO))).toContain('one');
    expect(await store.readScenarioFile(REPO, '.truecourse/scenarios/core/one.yaml')).toBe('one');
  });

  it('the boot sweep covers every repository and every workspace', async () => {
    await saveSet('c1', 'one');
    const spec = new PgSpecStore(db);
    await spec.saveWorkspaceSpecDocs({ workspaceOrgId: ORG }, { 'context/s/a.md': 'alpha' });
    // Orphans an earlier deployment left in both pools, old enough to sweep.
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    await db.insert(content).values([
      { scope: contentScope.guard(REPO), sha: 'sha256-o1', body: 'stale guard body', createdAt: old },
      { scope: contentScope.workspaceSpec(ORG), sha: 'sha256-o2', body: 'stale spec body', createdAt: old },
    ]);
    const swept = await sweepStoredVersions(db);
    expect(swept).toEqual({ versions: 0, bodies: { guard: 1, evidence: 0, spec: 1 } });
    expect(await bodiesInPool(contentScope.workspaceSpec(ORG))).toEqual(
      expect.arrayContaining(['alpha']),
    );
    expect(await bodiesInPool(contentScope.workspaceSpec(ORG))).not.toContain('stale spec body');
    expect(await db.select().from(workspaceSpecSets)).toHaveLength(1);
  });
});
