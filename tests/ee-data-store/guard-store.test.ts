/**
 * PgGuardStore over PGlite + real migrations — the guard analogue of the
 * verify/contract/pr-decisions suites. Exercises the public `GuardStore` interface:
 * run-state (baseline vs PR-head, readGuardRun by id, history), generate-result,
 * evidence through the content pool, the scenario corpus (walk → materialize →
 * browse), and the decisions ledger (repo vs `_pr/<n>` overlay).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq } from 'drizzle-orm';
import { schema, MIGRATIONS_DIR, content, type EeDb } from '@truecourse/ee-db';
import { PgGuardStore, contentScope } from '../../ee/packages/data-store/src/index';
import type { RepoRef } from '@truecourse/core/lib/guard-store';
import { EMPTY_GUARD_DECISIONS, type GuardGenerateReport, type GuardLatest } from '@truecourse/shared';

const REPO = 'acme/api';
const refAt = (sha: string): RepoRef => ({ repoKey: REPO, commitSha: sha });

async function makeDb(client: PGlite): Promise<EeDb> {
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db as unknown as EeDb;
}

function writeFile(root: string, rel: string, body: string): void {
  const f = path.join(root, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, body);
}

/** A minimal valid GuardLatest — one passing scenario over one section. */
function makeLatest(over: {
  runId: string;
  ranAt: string;
  branch?: string | null;
  commit?: string | null;
  summary?: GuardLatest['summary'];
}): GuardLatest {
  const binds = { doc: 'README.md', section: 'intro', fingerprint: 'sha256:abc' };
  return {
    run: {
      runId: over.runId,
      ranAt: over.ranAt,
      branch: over.branch ?? null,
      commit: over.commit ?? null,
      recipeFingerprint: 'sha256:rf',
      scenarioFormat: 1,
    },
    summary: over.summary ?? { total: 1, pass: 1, fail: 0, stale: 0, orphaned: 0, error: 0 },
    scenarios: [
      {
        id: 's1',
        title: 'does a thing',
        binds,
        outcome: 'pass',
        durationMs: 5,
        evidencePath: `.truecourse/guard/evidence/${over.runId}/s1`,
      },
    ],
    sections: [{ doc: 'README.md', section: 'intro', status: 'pass', scenarioIds: ['s1'] }],
  };
}

function makeReport(over: Partial<GuardGenerateReport> = {}): GuardGenerateReport {
  return {
    generatedAt: '2026-07-09T00:00:00.000Z',
    status: 'ok',
    sectionsTotal: 3,
    sectionsChanged: 1,
    skippedUnchanged: 2,
    noChanges: false,
    written: [],
    coverageGaps: [],
    birthFindings: [],
    errors: [],
    extractionFailures: [],
    orphaned: [],
    ...over,
  };
}

/** Count the deduped bodies stored under a content scope. */
async function scopeCount(db: EeDb, scope: string): Promise<number> {
  const rows = await db.select({ sha: content.sha }).from(content).where(eq(content.scope, scope));
  return rows.length;
}

const SCENARIO_YAML = `guard: 1
id: s1
title: shows help
binds:
  doc: README.md
  section: intro
  fingerprint: sha256:abc
driver: cli
steps:
  - run:
      - help
    expect:
      exit: 0
`;

const MANIFEST_JSON = JSON.stringify({
  guard: 1,
  sections: [
    {
      doc: 'README.md',
      anchor: 'intro',
      fingerprint: 'sha256:abc',
      scenarioIds: ['s1'],
      generationInputsHash: null,
    },
  ],
});

const RECIPE_JSON = JSON.stringify({ build: 'pnpm build', entry: ['node', 'cli.js'] });

/** Seed a `.truecourse/scenarios/` tree under `srcDir`; returns the scenarios dir. */
function seedScenarios(srcDir: string): string {
  const dir = path.join(srcDir, '.truecourse', 'scenarios');
  writeFile(dir, 'recipe.json', RECIPE_JSON);
  writeFile(dir, 'manifest.json', MANIFEST_JSON);
  writeFile(dir, 'core/help.yaml', SCENARIO_YAML);
  writeFile(dir, 'decisions.json', JSON.stringify(EMPTY_GUARD_DECISIONS)); // NOT a scenario body
  return dir;
}

describe('PgGuardStore — run state (pglite)', () => {
  let client: PGlite;
  let db: EeDb;
  let store: PgGuardStore;
  beforeEach(async () => {
    client = new PGlite();
    db = await makeDb(client);
    store = new PgGuardStore(db);
  });
  afterEach(async () => {
    await client.close();
  });

  it('reports materializesInPlace=false', () => {
    expect(store.materializesInPlace).toBe(false);
  });

  it('round-trips LATEST keyed by repo+commit; empty repo is null', async () => {
    expect(await store.readGuardLatest(REPO)).toBeNull();
    const latest = makeLatest({ runId: 'r1', ranAt: '2026-07-01T00:00:00.000Z', commit: 'c1' });
    await store.writeGuardLatest(REPO, latest);
    expect(await store.readGuardLatest(REPO)).toEqual(latest);
    // isolated by repo
    expect(await store.readGuardLatest('other/repo')).toBeNull();
  });

  it('readGuardLatest returns the newest baseline; a PR-head run never becomes the baseline', async () => {
    const base1 = makeLatest({ runId: 'r1', ranAt: '2026-07-01T00:00:00.000Z', commit: 'c1', branch: 'main' });
    await store.writeGuardLatest(REPO, base1);
    // A PR-head run for a different commit — writeGuardRun does NOT mark baseline.
    const prHead = makeLatest({ runId: 'r2', ranAt: '2026-07-05T00:00:00.000Z', commit: 'pr-head', branch: 'feature' });
    const written = await store.writeGuardRun(REPO, prHead);
    expect(written.runId).toBe('r2');
    expect(written.latest).toEqual(prHead);
    // baseline is still base1 (the PR head, though newer, is not a baseline row)
    expect(await store.readGuardLatest(REPO)).toEqual(base1);
    // A newer baseline supersedes.
    const base2 = makeLatest({ runId: 'r3', ranAt: '2026-07-08T00:00:00.000Z', commit: 'c2', branch: 'main' });
    await store.writeGuardLatest(REPO, base2);
    expect(await store.readGuardLatest(REPO)).toEqual(base2);
  });

  it('readGuardRun looks up any run by its id (baseline or PR-head); unknown/unsafe → null', async () => {
    const base = makeLatest({ runId: 'r1', ranAt: '2026-07-01T00:00:00.000Z', commit: 'c1' });
    await store.writeGuardLatest(REPO, base);
    const prHead = makeLatest({ runId: 'r2', ranAt: '2026-07-05T00:00:00.000Z', commit: 'pr-head' });
    await store.writeGuardRun(REPO, prHead);
    expect(await store.readGuardRun(REPO, 'r1')).toEqual(base);
    expect(await store.readGuardRun(REPO, 'r2')).toEqual(prHead);
    expect(await store.readGuardRun(REPO, 'nope')).toBeNull();
    expect(await store.readGuardRun(REPO, '../etc/passwd')).toBeNull();
  });

  it('readGuardRunForCommit returns the stored run for an exact commit (baseline or PR-head)', async () => {
    const base = makeLatest({ runId: 'r1', ranAt: '2026-07-01T00:00:00.000Z', commit: 'c1', branch: 'main' });
    await store.writeGuardLatest(REPO, base);
    const prHead = makeLatest({ runId: 'r2', ranAt: '2026-07-05T00:00:00.000Z', commit: 'pr-head', branch: 'feature' });
    await store.writeGuardRun(REPO, prHead);
    expect(await store.readGuardRunForCommit(REPO, 'c1')).toEqual(base);
    expect(await store.readGuardRunForCommit(REPO, 'pr-head')).toEqual(prHead);
  });

  it('readGuardRunForCommit returns null for an unknown commit or another repo', async () => {
    const prHead = makeLatest({ runId: 'r2', ranAt: '2026-07-05T00:00:00.000Z', commit: 'pr-head' });
    await store.writeGuardRun(REPO, prHead);
    expect(await store.readGuardRunForCommit(REPO, 'nope')).toBeNull();
    expect(await store.readGuardRunForCommit('other/repo', 'pr-head')).toBeNull();
  });

  it('a run with no commit keys distinctly by runId (no PK collision)', async () => {
    const a = makeLatest({ runId: 'r1', ranAt: '2026-07-01T00:00:00.000Z', commit: null });
    const b = makeLatest({ runId: 'r2', ranAt: '2026-07-02T00:00:00.000Z', commit: null });
    await store.writeGuardRun(REPO, a);
    await store.writeGuardRun(REPO, b);
    expect(await store.readGuardRun(REPO, 'r1')).toEqual(a);
    expect(await store.readGuardRun(REPO, 'r2')).toEqual(b);
  });

  it('history is the baseline runs oldest-first; appendGuardHistory is a derived no-op', async () => {
    await store.writeGuardLatest(REPO, makeLatest({ runId: 'r1', ranAt: '2026-07-01T00:00:00.000Z', commit: 'c1' }));
    await store.writeGuardRun(REPO, makeLatest({ runId: 'r2', ranAt: '2026-07-03T00:00:00.000Z', commit: 'pr' })); // excluded
    await store.writeGuardLatest(REPO, makeLatest({ runId: 'r3', ranAt: '2026-07-05T00:00:00.000Z', commit: 'c2' }));
    await store.appendGuardHistory(REPO, {
      runId: 'r9',
      ranAt: '2026-07-09T00:00:00.000Z',
      branch: null,
      commit: null,
      summary: { total: 0, pass: 0, fail: 0, stale: 0, orphaned: 0, error: 0 },
    });
    const history = await store.readGuardHistory(REPO);
    expect(history.runs.map((r) => r.runId)).toEqual(['r1', 'r3']);
    expect(history.runs[0]!.summary.total).toBe(1);
  });

  it('a same-commit rerun replaces the row: latest wins in history, old runId stops resolving', async () => {
    // Latest-wins is deliberate (mirrors PgVerifyStore's one-row-per-commit model,
    // unlike the OSS append-only history.json) — see the store's doc header.
    const r1 = makeLatest({ runId: 'r1', ranAt: '2026-07-01T00:00:00.000Z', commit: 'c1' });
    await store.writeGuardLatest(REPO, r1);
    const r2 = makeLatest({
      runId: 'r2',
      ranAt: '2026-07-02T00:00:00.000Z',
      commit: 'c1',
      summary: { total: 2, pass: 1, fail: 1, stale: 0, orphaned: 0, error: 0 },
    });
    await store.writeGuardLatest(REPO, r2);

    // History has exactly ONE entry for the commit, carrying R2's runId + summary.
    const history = await store.readGuardHistory(REPO);
    expect(history.runs).toHaveLength(1);
    expect(history.runs[0]!.runId).toBe('r2');
    expect(history.runs[0]!.summary).toEqual(r2.summary);
    // R1's data point is gone: its runId no longer resolves; R2's is the row.
    expect(await store.readGuardRun(REPO, 'r1')).toBeNull();
    expect(await store.readGuardRun(REPO, 'r2')).toEqual(r2);
    expect(await store.readGuardLatest(REPO)).toEqual(r2);
  });

  it('keys generate results per commit; commit-less read falls back to the newest', async () => {
    expect(await store.readGuardResult(REPO)).toBeNull();
    await store.writeGuardResult(refAt('c1'), makeReport({ sectionsChanged: 1 }));
    // "newest" orders by created_at (ms precision) — separate the two writes.
    await new Promise((r) => setTimeout(r, 5));
    await store.writeGuardResult(refAt('c2'), makeReport({ sectionsChanged: 4, generatedAt: '2026-07-10T00:00:00.000Z' }));
    // both commits' reports coexist and read back by commit
    expect((await store.readGuardResult(REPO, 'c1'))!.sectionsChanged).toBe(1);
    expect((await store.readGuardResult(REPO, 'c2'))!.sectionsChanged).toBe(4);
    expect(await store.readGuardResult(REPO, 'nope')).toBeNull();
    // no commit → the newest stored row
    expect((await store.readGuardResult(REPO))!.sectionsChanged).toBe(4);
    expect(await store.readGuardResult('other/repo')).toBeNull();
  });

  it('re-writing a commit upserts its row in place', async () => {
    await store.writeGuardResult(refAt('c1'), makeReport({ sectionsChanged: 1 }));
    await store.writeGuardResult(refAt('c1'), makeReport({ sectionsChanged: 2 }));
    expect((await store.readGuardResult(REPO, 'c1'))!.sectionsChanged).toBe(2);
  });

  it('rejects an empty commit SHA on writeGuardResult', async () => {
    await expect(store.writeGuardResult(refAt(''), makeReport())).rejects.toThrow(/commit SHA/i);
  });
});

describe('PgGuardStore — evidence (pglite + Postgres content)', () => {
  let client: PGlite;
  let db: EeDb;
  let store: PgGuardStore;
  beforeEach(async () => {
    client = new PGlite();
    db = await makeDb(client);
    store = new PgGuardStore(db);
  });
  afterEach(async () => {
    await client.close();
  });

  it('writes evidence onto the run row and reads it back by id and by evidence dir', async () => {
    await store.writeGuardRun(REPO, makeLatest({ runId: 'r1', ranAt: '2026-07-01T00:00:00.000Z', commit: 'c1' }));
    const rel = await store.writeGuardEvidence(REPO, 'r1', 's1', {
      'transcript.txt': 'ran help, exit 0',
      'meta.json': '{"ok":true}',
    });
    expect(rel).toBe('.truecourse/guard/evidence/r1/s1');

    // by (runId, scenarioId, file)
    expect(await store.readGuardEvidence(REPO, 'r1', 's1', 'transcript.txt')).toBe('ran help, exit 0');
    // by the evidence directory pointer (a birth finding's evidencePath)
    expect(await store.readGuardEvidenceAt(REPO, rel, 'meta.json')).toBe('{"ok":true}');
    // absent file → null (both readers)
    expect(await store.readGuardEvidence(REPO, 'r1', 's1', 'missing.txt')).toBeNull();
    expect(await store.readGuardEvidenceAt(REPO, rel, 'missing.txt')).toBeNull();
    // unsafe segments → null, never a read
    expect(await store.readGuardEvidence(REPO, '../x', 's1', 'transcript.txt')).toBeNull();
    expect(await store.readGuardEvidenceAt(REPO, '../../etc', 'passwd')).toBeNull();
    expect(await store.readGuardEvidenceAt(REPO, rel, '../escape')).toBeNull();
    // bodies are content-addressed under the evidence scope
    expect(await scopeCount(db, contentScope.guardEvidence(REPO))).toBe(2);
  });

  it('sanitizes the scenario id in both the pointer and the manifest key (dotted id round-trips)', async () => {
    await store.writeGuardRun(REPO, makeLatest({ runId: 'r1', ranAt: '2026-07-01T00:00:00.000Z', commit: 'c1' }));
    const rel = await store.writeGuardEvidence(REPO, 'r1', 'quick.start/1', { 'log.txt': 'hi' });
    expect(rel).toBe('.truecourse/guard/evidence/r1/quick.start_1');
    expect(await store.readGuardEvidence(REPO, 'r1', 'quick.start/1', 'log.txt')).toBe('hi');
    expect(await store.readGuardEvidenceAt(REPO, rel, 'log.txt')).toBe('hi');
  });

  it('rejects an unsafe evidence file name on write', async () => {
    await store.writeGuardRun(REPO, makeLatest({ runId: 'r1', ranAt: '2026-07-01T00:00:00.000Z', commit: 'c1' }));
    await expect(store.writeGuardEvidence(REPO, 'r1', 's1', { '../evil': 'x' })).rejects.toThrow(/unsafe/i);
  });

  it('throws when there is no run row to attach evidence to', async () => {
    await expect(store.writeGuardEvidence(REPO, 'r-none', 's1', { 'log.txt': 'x' })).rejects.toThrow(
      /no guard run/i,
    );
  });

  it('same-commit rerun under a new runId resets the evidence manifest (no stale serving)', async () => {
    await store.writeGuardRun(REPO, makeLatest({ runId: 'r1', ranAt: '2026-07-01T00:00:00.000Z', commit: 'c1' }));
    await store.writeGuardEvidence(REPO, 'r1', 's1', { 'transcript.txt': 'first run' });
    // Rerun the SAME commit under a new runId — the row's run_id is overwritten
    // and its evidence manifest resets to {}.
    await store.writeGuardRun(REPO, makeLatest({ runId: 'r2', ranAt: '2026-07-02T00:00:00.000Z', commit: 'c1' }));

    // R1-addressed reads go null (no row carries run_id=r1 anymore)…
    expect(await store.readGuardEvidence(REPO, 'r1', 's1', 'transcript.txt')).toBeNull();
    expect(await store.readGuardEvidenceAt(REPO, '.truecourse/guard/evidence/r1/s1', 'transcript.txt')).toBeNull();
    // …and R2-addressed reads are null too: the previous run's transcript is never
    // served under the new runId (the blobs stay in `content`, just unreferenced).
    expect(await store.readGuardEvidence(REPO, 'r2', 's1', 'transcript.txt')).toBeNull();
    expect(await store.readGuardEvidenceAt(REPO, '.truecourse/guard/evidence/r2/s1', 'transcript.txt')).toBeNull();
    // R2's own evidence write then works normally.
    await store.writeGuardEvidence(REPO, 'r2', 's1', { 'transcript.txt': 'second run' });
    expect(await store.readGuardEvidence(REPO, 'r2', 's1', 'transcript.txt')).toBe('second run');
  });

  it('a same-runId re-upsert (e.g. baseline-marking after writeGuardRun) keeps evidence', async () => {
    const latest = makeLatest({ runId: 'r1', ranAt: '2026-07-01T00:00:00.000Z', commit: 'c1' });
    await store.writeGuardRun(REPO, latest);
    await store.writeGuardEvidence(REPO, 'r1', 's1', { 'transcript.txt': 'kept' });
    // The same run's snapshot is re-upserted (writeGuardLatest marking baseline) —
    // same runId, so the evidence manifest must NOT be clobbered.
    await store.writeGuardLatest(REPO, latest);
    expect(await store.readGuardEvidence(REPO, 'r1', 's1', 'transcript.txt')).toBe('kept');
  });

  it('merges concurrent evidence writes for the same run atomically (no lost entries)', async () => {
    await store.writeGuardRun(REPO, makeLatest({ runId: 'r1', ranAt: '2026-07-01T00:00:00.000Z', commit: 'c1' }));
    // Two scenarios' evidence lands concurrently — the jsonb `||` merge must keep both.
    await Promise.all([
      store.writeGuardEvidence(REPO, 'r1', 's1', { 'transcript.txt': 'first scenario' }),
      store.writeGuardEvidence(REPO, 'r1', 's2', { 'transcript.txt': 'second scenario' }),
    ]);
    expect(await store.readGuardEvidence(REPO, 'r1', 's1', 'transcript.txt')).toBe('first scenario');
    expect(await store.readGuardEvidence(REPO, 'r1', 's2', 'transcript.txt')).toBe('second scenario');
  });
});

describe('PgGuardStore — birth-finding (result) evidence (pglite + Postgres content)', () => {
  let client: PGlite;
  let db: EeDb;
  let store: PgGuardStore;
  beforeEach(async () => {
    client = new PGlite();
    db = await makeDb(client);
    store = new PgGuardStore(db);
  });
  afterEach(async () => {
    await client.close();
  });

  it('persists birth evidence onto the guardResults row; readGuardEvidenceAt resolves it without a run row', async () => {
    // The generate report row must exist first — evidence merges onto it.
    await store.writeGuardResult(refAt('c1'), makeReport());
    await store.writeGuardResultEvidence(refAt('c1'), 's5', {
      'transcript.txt': 'birth run failed at step 2',
      'diff.txt': 'expected exit 0, got 1',
    });

    // A birth finding's evidencePath embeds a GENERATE runId that never created a
    // guard_runs row (birth runs are `persist: false`) — the read must fall back to
    // the guardResults evidence manifest.
    const evPath = '.truecourse/guard/evidence/gen-run-1/s5';
    expect(await store.readGuardEvidenceAt(REPO, evPath, 'transcript.txt')).toBe('birth run failed at step 2');
    expect(await store.readGuardEvidenceAt(REPO, evPath, 'diff.txt')).toBe('expected exit 0, got 1');
    // absent file → null
    expect(await store.readGuardEvidenceAt(REPO, evPath, 'missing.txt')).toBeNull();
    // unsafe file segment → null, never a read
    expect(await store.readGuardEvidenceAt(REPO, evPath, '../escape')).toBeNull();
    // bodies are content-addressed under the evidence scope
    expect(await scopeCount(db, contentScope.guardEvidence(REPO))).toBe(2);
    // isolated by repo
    expect(await store.readGuardEvidenceAt('other/repo', evPath, 'transcript.txt')).toBeNull();
  });

  it('the run-row read still wins for a real run; birth evidence resolves only via the fallback', async () => {
    // A real run + its evidence (the guard_runs path).
    await store.writeGuardRun(REPO, makeLatest({ runId: 'r1', ranAt: '2026-07-01T00:00:00.000Z', commit: 'c1' }));
    await store.writeGuardEvidence(REPO, 'r1', 's1', { 'transcript.txt': 'run evidence' });
    // A birth finding on the same commit's report, under a distinct generate runId.
    await store.writeGuardResult(refAt('c1'), makeReport());
    await store.writeGuardResultEvidence(refAt('c1'), 's9', { 'transcript.txt': 'birth evidence' });

    expect(
      await store.readGuardEvidenceAt(REPO, '.truecourse/guard/evidence/r1/s1', 'transcript.txt'),
    ).toBe('run evidence');
    expect(
      await store.readGuardEvidenceAt(REPO, '.truecourse/guard/evidence/gen-2/s9', 'transcript.txt'),
    ).toBe('birth evidence');
  });

  it('a matching run row is authoritative — a key missing there never falls back to result evidence', async () => {
    // Run row r1 exists but holds no evidence for s1 (e.g. the evidence write failed).
    await store.writeGuardRun(REPO, makeLatest({ runId: 'r1', ranAt: '2026-07-01T00:00:00.000Z', commit: 'c1' }));
    // A report-level manifest happens to hold the same <scenarioSeg>/<file> key.
    await store.writeGuardResult(refAt('c1'), makeReport());
    await store.writeGuardResultEvidence(refAt('c1'), 's1', { 'transcript.txt': 'birth evidence' });

    // The r1 read is a miss, not the stale birth transcript — fallback only fires
    // when NO run row matches the runId.
    expect(
      await store.readGuardEvidenceAt(REPO, '.truecourse/guard/evidence/r1/s1', 'transcript.txt'),
    ).toBeNull();
  });

  it('sanitizes a dotted scenario segment and round-trips through the manifest key', async () => {
    await store.writeGuardResult(refAt('c1'), makeReport());
    // The evidencePath already carries the SANITIZED segment (dots kept, slash → _).
    await store.writeGuardResultEvidence(refAt('c1'), 'quick.start_1', { 'log.txt': 'hi' });
    expect(
      await store.readGuardEvidenceAt(REPO, '.truecourse/guard/evidence/g1/quick.start_1', 'log.txt'),
    ).toBe('hi');
  });

  it('rejects an unsafe evidence file name on write', async () => {
    await store.writeGuardResult(refAt('c1'), makeReport());
    await expect(store.writeGuardResultEvidence(refAt('c1'), 's1', { '../evil': 'x' })).rejects.toThrow(/unsafe/i);
  });

  it('throws when the commit has no generate report row to attach evidence to', async () => {
    await expect(store.writeGuardResultEvidence(refAt('nope'), 's1', { 'log.txt': 'x' })).rejects.toThrow(
      /no guard result/i,
    );
  });

  it('rejects an empty commit SHA on writeGuardResultEvidence', async () => {
    await expect(store.writeGuardResultEvidence(refAt(''), 's1', { 'log.txt': 'x' })).rejects.toThrow(/commit SHA/i);
  });
});

describe('PgGuardStore — scenario corpus (pglite + Postgres content)', () => {
  let client: PGlite;
  let db: EeDb;
  let store: PgGuardStore;
  let srcDir: string;
  beforeEach(async () => {
    client = new PGlite();
    db = await makeDb(client);
    store = new PgGuardStore(db);
    srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-guard-src-'));
  });
  afterEach(async () => {
    await client.close();
    fs.rmSync(srcDir, { recursive: true, force: true });
  });

  it('walks the on-disk tree (yaml + recipe + manifest; not decisions), then browses it', async () => {
    const dir = seedScenarios(srcDir);
    const res = await store.saveScenarios(refAt('c1'), dir);
    expect(res.fileCount).toBe(3); // help.yaml + recipe.json + manifest.json (decisions.json excluded)

    // list is `.truecourse/scenarios/`-prefixed, yaml-only, sorted
    expect(await store.listScenarioFiles(REPO)).toEqual(['.truecourse/scenarios/core/help.yaml']);
    // read a scenario yaml by its repo-relative path
    expect(await store.readScenarioFile(REPO, '.truecourse/scenarios/core/help.yaml')).toBe(SCENARIO_YAML);
    // out-of-corpus / unknown → null
    expect(await store.readScenarioFile(REPO, 'somewhere/else.yaml')).toBeNull();
    expect(await store.readScenarioFile(REPO, '.truecourse/scenarios/nope.yaml')).toBeNull();
    // manifest + recipe read through the set
    expect((await store.readManifest(REPO))!.sections[0]!.anchor).toBe('intro');
    expect(await store.readRecipeRaw(REPO)).toBe(RECIPE_JSON);
    // three unique bodies stored content-addressed under the guard scope
    expect(await scopeCount(db, contentScope.guard(REPO))).toBe(3);
  });

  it('rejects an empty commit SHA on saveScenarios', async () => {
    await expect(store.saveScenarios(refAt(''), seedScenarios(srcDir))).rejects.toThrow(/commit SHA/i);
  });

  it('loadScenarios materializes + parses exactly that commit’s set', async () => {
    await store.saveScenarios(refAt('c1'), seedScenarios(srcDir));
    const loaded = await store.loadScenarios(refAt('c1'));
    expect(loaded.errors).toEqual([]);
    expect(loaded.scenarios.map((s) => s.id)).toEqual(['s1']);
    expect(loaded.scenarios[0]!.binds.doc).toBe('README.md');
    // an unknown commit is empty — exact-commit semantics, no latest fallback
    expect(await store.loadScenarios(refAt('nope'))).toEqual({ scenarios: [], errors: [] });
    // leaves no temp dir behind
    expect(fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('tc-guard-scenarios-'))).toEqual([]);
  });

  it('empty repo: load/list/read are empty, manifest/recipe null', async () => {
    expect(await store.loadScenarios(refAt('c1'))).toEqual({ scenarios: [], errors: [] });
    expect(await store.listScenarioFiles(REPO)).toEqual([]);
    expect(await store.readManifest(REPO)).toBeNull();
    expect(await store.readRecipeRaw(REPO)).toBeNull();
  });

  it('keys sets per commit: both coexist, reads take a commit, no commit → newest set', async () => {
    await store.saveScenarios(refAt('c1'), seedScenarios(srcDir));
    // "newest" orders by created_at (ms precision) — separate the two saves.
    await new Promise((r) => setTimeout(r, 5));
    // c2 drops the yaml (a smaller tree) — both sets must remain readable.
    const src2 = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-guard-src2-'));
    const dir2 = path.join(src2, '.truecourse', 'scenarios');
    writeFile(dir2, 'recipe.json', RECIPE_JSON.replace('pnpm build', 'pnpm build:v2'));
    await store.saveScenarios(refAt('c2'), dir2);

    // by commit
    expect(await store.listScenarioFiles(REPO, 'c1')).toEqual(['.truecourse/scenarios/core/help.yaml']);
    expect(await store.listScenarioFiles(REPO, 'c2')).toEqual([]);
    expect(await store.readScenarioFile(REPO, '.truecourse/scenarios/core/help.yaml', 'c1')).toBe(SCENARIO_YAML);
    expect(await store.readScenarioFile(REPO, '.truecourse/scenarios/core/help.yaml', 'c2')).toBeNull();
    expect(await store.readRecipeRaw(REPO, 'c1')).toBe(RECIPE_JSON);
    expect(await store.readRecipeRaw(REPO, 'c2')).toContain('build:v2');
    expect((await store.readManifest(REPO, 'c1'))!.sections).toHaveLength(1);
    expect(await store.readManifest(REPO, 'c2')).toBeNull(); // c2 has no manifest.json
    // no commit → the newest stored set (c2)
    expect(await store.listScenarioFiles(REPO)).toEqual([]);
    expect(await store.readRecipeRaw(REPO)).toContain('build:v2');
    // loads stay per-commit
    expect((await store.loadScenarios(refAt('c1'))).scenarios.map((s) => s.id)).toEqual(['s1']);
    expect((await store.loadScenarios(refAt('c2'))).scenarios).toEqual([]);
    fs.rmSync(src2, { recursive: true, force: true });
  });

  it('dedupes unchanged bodies across commits', async () => {
    const dir = seedScenarios(srcDir);
    await store.saveScenarios(refAt('c1'), dir);
    expect(await scopeCount(db, contentScope.guard(REPO))).toBe(3);
    // The identical tree at a new commit adds a manifest row but no new objects.
    await store.saveScenarios(refAt('c2'), dir);
    expect(await scopeCount(db, contentScope.guard(REPO))).toBe(3);
    // Change exactly one file → exactly one new object.
    writeFile(dir, 'core/help.yaml', SCENARIO_YAML.replace('shows help', 'shows help v2'));
    await store.saveScenarios(refAt('c3'), dir);
    expect(await scopeCount(db, contentScope.guard(REPO))).toBe(4);
  });
});

describe('PgGuardStore — decisions (pglite)', () => {
  let client: PGlite;
  let store: PgGuardStore;
  beforeEach(async () => {
    client = new PGlite();
    store = new PgGuardStore(await makeDb(client));
  });
  afterEach(async () => {
    await client.close();
  });

  const claim = (title: string) => ({
    version: 1 as const,
    dismissedClaims: [
      { doc: 'README.md', anchor: 'intro', title, dismissedAt: '2026-07-09T00:00:00.000Z' },
    ],
  });

  it('absent decisions read as EMPTY_GUARD_DECISIONS (never null), for repo + PR scopes', async () => {
    expect(await store.readGuardDecisions(REPO)).toEqual(EMPTY_GUARD_DECISIONS);
    expect(await store.readGuardDecisions(REPO, '_pr/7')).toEqual(EMPTY_GUARD_DECISIONS);
  });

  it('routes the repo row and a PR overlay to independent scopes', async () => {
    await store.writeGuardDecisions(REPO, claim('repo-claim'));
    await store.writeGuardDecisions(REPO, claim('pr-claim'), '_pr/7');
    expect((await store.readGuardDecisions(REPO)).dismissedClaims[0]!.title).toBe('repo-claim');
    expect((await store.readGuardDecisions(REPO, '_pr/7')).dismissedClaims[0]!.title).toBe('pr-claim');
    // two PRs are independent
    await store.writeGuardDecisions(REPO, claim('pr8'), '_pr/8');
    expect((await store.readGuardDecisions(REPO, '_pr/8')).dismissedClaims[0]!.title).toBe('pr8');
    // repo row untouched by the overlays
    expect((await store.readGuardDecisions(REPO)).dismissedClaims).toHaveLength(1);
  });

  it('delete drops only the addressed scope and is idempotent', async () => {
    await store.writeGuardDecisions(REPO, claim('repo-claim'));
    await store.writeGuardDecisions(REPO, claim('pr-claim'), '_pr/7');
    await store.deleteGuardDecisions(REPO, '_pr/7');
    expect(await store.readGuardDecisions(REPO, '_pr/7')).toEqual(EMPTY_GUARD_DECISIONS);
    expect((await store.readGuardDecisions(REPO)).dismissedClaims[0]!.title).toBe('repo-claim');
    // deleting an absent scope is a no-op
    await expect(store.deleteGuardDecisions(REPO, '_pr/7')).resolves.toBeUndefined();
  });
});
