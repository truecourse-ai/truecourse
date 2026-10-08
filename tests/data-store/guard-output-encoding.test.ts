/** Guard outputs preserve arbitrary captured text across storage, history and rollback. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq } from 'drizzle-orm';
import { content, guardResults, guardRuns, MIGRATIONS_DIR, schema, type Db } from '@truecourse/db';
import { guardHistoryEntryOf, type GuardGenerateReport, type GuardLatest } from '@truecourse/shared';
import { PgGuardStore } from '../../packages/data-store/src/guard-store';
import { ContentStore, contentScope } from '../../packages/data-store/src/content-store';
import { sweepRepoContent } from '../../packages/data-store/src/version-sweep';

const REPO = 'acme/pdf';
const REF = { repoKey: REPO, commitSha: 'c1' };
const OUTPUT = '%PDF-1.7\nstream\n\u0000\ud800 bytes \udfff\nendstream';
const report = (reason = OUTPUT): GuardGenerateReport => ({
  generatedAt: '2026-01-01T00:00:00Z', status: 'ok', noChanges: false, written: [],
  coverageGaps: [{ flowId: 'download', kind: 'no-interface', reason }],
  birthFindings: [], errors: [], extractionFailures: [],
});
const latest = (actual = OUTPUT): GuardLatest => ({
  run: { runId: 'baseline-1', ranAt: '2026-01-01T00:00:00Z', branch: 'main', commit: 'c1', recipeFingerprint: 'sha256:r' },
  summary: { total: 1, pass: 0, fail: 1, stale: 0, orphaned: 0, error: 0, blocked: 0 },
  scenarios: [{ id: 'download', title: 'download PDF', binds: { doc: 'README.md', sentences: ['download'] },
    outcome: 'fail', durationMs: 1, failure: { step: 1, expected: 'public', actual, stdout: actual } }],
});

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
afterEach(async () => { await client.close(); });

describe('guard output encoding', () => {
  it('reads reports by latest, commit and version and restores the paired report with its evidence', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-guard-encoding-'));
    try {
      fs.writeFileSync(path.join(dir, 'recipe.json'), '{}');
      const set = await store.saveScenarios(REF, dir, { producedByRun: 'generation-1', model: 'test' });
      await store.writeGuardResult(REF, report(), { producedByRun: 'generation-1', model: 'test' });
      await store.writeGuardResultEvidence(REF, 'download', { 'transcript.txt': OUTPUT });
      const [version] = await store.listGuardVersions(REPO, 'report');
      expect(version).toMatchObject({ producedByRun: 'generation-1', model: 'test', commitSha: 'c1' });
      expect(await store.readGuardResult(REPO)).toEqual(report());
      expect(await store.readGuardResult(REPO, { commitSha: 'c1' })).toEqual(report());
      expect(await store.readGuardResult(REPO, { id: version.id })).toEqual(report());
      const [original] = await db.select().from(guardResults);
      expect(original.scenarioSetId).toBe(set.versionId);
      await store.restoreGuardScenarioSet(REPO, set.versionId);
      expect(await store.readGuardResult(REPO)).toEqual(report());
      const rows = await db.select().from(guardResults);
      const restored = rows.find(row => row.restoredFrom === version.id)!;
      expect(restored.report).toEqual(original.report);
      expect(restored.evidence).toEqual(original.evidence);
      expect(restored.scenarioSetId).not.toBe(original.scenarioSetId);
      expect(await store.readGuardEvidenceAt(REPO, '.truecourse/guard/evidence/birth/download', 'transcript.txt')).toBe(OUTPUT);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('reads baseline snapshots through every reader and preserves evidence during adjudication updates', async () => {
    await store.writeGuardRun(REPO, latest(), { scope: 'pr/1', provenance: { producedByRun: 'activity-1', model: 'test' } });
    await store.writeGuardEvidence(REPO, 'baseline-1', 'download', { 'transcript.txt': 'original execution' });
    expect(await store.readGuardLatest(REPO, 'pr/1')).toEqual(latest());
    expect(await store.readGuardRun(REPO, 'baseline-1')).toEqual(latest());
    expect(await store.readGuardRunForCommit(REPO, 'c1', 'pr/1')).toEqual(latest());
    expect((await store.readGuardHistory(REPO, { all: true })).runs).toEqual([guardHistoryEntryOf(latest())]);
    const changed = latest(OUTPUT + '\nupdated');
    await store.writeGuardLatest(REPO, changed);
    expect(await store.readGuardLatest(REPO, 'pr/1')).toEqual(changed);
    expect(await store.readGuardEvidence(REPO, 'baseline-1', 'download', 'transcript.txt')).toBe('original execution');
    const [row] = await db.select().from(guardRuns);
    expect(row).toMatchObject({ scope: 'pr/1', producedByRun: 'activity-1', model: 'test' });
  });

  it('accepts legacy inline reports and snapshots alongside new versions', async () => {
    await store.writeGuardResult(REF, report('old output'));
    await db.update(guardResults).set({ report: report('old output') });
    await store.writeGuardLatest(REPO, latest('old output'));
    await db.update(guardRuns).set({ snapshot: latest('old output') });
    expect(await store.readGuardResult(REPO)).toEqual(report('old output'));
    expect(await store.readGuardRun(REPO, 'baseline-1')).toEqual(latest('old output'));
    expect((await store.readGuardHistory(REPO)).runs).toEqual([guardHistoryEntryOf(latest('old output'))]);
    await store.writeGuardResult(REF, report());
    expect(await store.readGuardResult(REPO)).toEqual(report());
  });

  it('rejects malformed encoded payloads instead of returning a storage envelope', async () => {
    await store.writeGuardResult(REF, report('valid'));
    await db.update(guardResults).set({ report: { guardEncoding: 'json-v1', guardJson: 42 } });
    await expect(store.readGuardResult(REPO)).rejects.toThrow('Invalid stored guard output');
    await store.writeGuardLatest(REPO, latest('valid'));
    await db.update(guardRuns).set({ snapshot: { guardEncoding: 'json-v1', guardJson: '{' } }).where(eq(guardRuns.runId, 'baseline-1'));
    await expect(store.readGuardLatest(REPO)).rejects.toThrow('Invalid stored guard output');
  });

  it('preserves encoded transcripts during retention and accepts legacy plain text', async () => {
    await store.writeGuardLatest(REPO, latest('safe'));
    await store.writeGuardEvidence(REPO, 'baseline-1', 'download', { 'transcript.txt': OUTPUT });
    const pointer = '.truecourse/guard/evidence/baseline-1/download';
    expect(await store.readGuardEvidence(REPO, 'baseline-1', 'download', 'transcript.txt')).toBe(OUTPUT);
    expect(await store.readGuardEvidenceAt(REPO, pointer, 'transcript.txt')).toBe(OUTPUT);
    expect(await store.readGuardEvidenceBytesAt(REPO, pointer, 'transcript.txt')).toEqual(Buffer.from(OUTPUT));
    const pool = new ContentStore(db);
    const scope = contentScope.guardEvidence(REPO);
    const legacySha = await pool.putText(scope, 'plain legacy transcript');
    const [run] = await db.select().from(guardRuns);
    await db.update(guardRuns).set({ evidence: { ...run.evidence as object, 'download/legacy.txt': legacySha } });
    await pool.putText(scope, 'unreferenced');
    await db.update(content).set({ createdAt: '2020-01-01T00:00:00Z' });
    expect((await sweepRepoContent(db, REPO)).evidence).toBe(1);
    expect(await store.readGuardEvidenceAt(REPO, pointer, 'transcript.txt')).toBe(OUTPUT);
    expect(await store.readGuardEvidenceAt(REPO, pointer, 'legacy.txt')).toBe('plain legacy transcript');
    const malformedSha = await pool.putText(scope, '{}');
    await db.update(guardRuns).set({ evidence: { 'download/transcript.txt': `json-v1:${malformedSha}` } });
    await expect(store.readGuardEvidenceAt(REPO, pointer, 'transcript.txt')).rejects.toThrow('Invalid stored guard evidence text');
  });
});
