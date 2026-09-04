/**
 * Binary evidence in the Postgres guard store: a browser run's screenshots and
 * session video travel as BYTES, next to the transcripts that travel as text.
 * The content pool's body column is text, so a byte body is base64 on the way
 * in and decoded on the way out — and the file's NAME is what says which read
 * applies. Both homes an evidence bundle can have are covered: a run row's
 * manifest, and a generate report's (a birth finding's bundle).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type Db } from '@truecourse/db';
import type { GuardGenerateReport, GuardLatest } from '@truecourse/shared';
import { PgGuardStore } from '../../packages/data-store/src/index';

const REPO = 'acme/api';
const RUN_ID = '2026-03-03T00-00-00Z_run1';
/** Not valid UTF-8 on purpose: a text round-trip would corrupt it. */
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0xfe, 0x80]);

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

const latest: GuardLatest = {
  run: { runId: RUN_ID, ranAt: '2026-03-03T00:00:00Z', branch: 'main', commit: 'c1', recipeFingerprint: 'sha256:r' },
  summary: { total: 1, pass: 0, fail: 1, stale: 0, orphaned: 0, error: 0, blocked: 0 },
  scenarios: [
    {
      id: 'a.web.1',
      title: 'signs in',
      binds: { doc: 'docs/auth.md', section: 'sign-in', fingerprint: 'sha256:x' },
      outcome: 'fail',
      durationMs: 5,
    },
  ],
  sections: [],
};

const report: GuardGenerateReport = {
  generatedAt: '2026-02-02T00:00:00Z',
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

describe('PgGuardStore evidence bytes', () => {
  it('stores a run’s screenshot byte-exact beside its transcript, and lists both', async () => {
    await store.writeGuardRun(REPO, latest);
    const pointer = await store.writeGuardEvidence(REPO, RUN_ID, 'a.web.1', {
      'transcript.txt': 'step 1 failed',
      'step-1.png': PNG,
    });
    expect(pointer).toBe(`.truecourse/guard/evidence/${RUN_ID}/a.web.1`);

    expect(await store.listGuardEvidenceAt(REPO, pointer)).toEqual(['step-1.png', 'transcript.txt']);
    expect(await store.readGuardEvidenceAt(REPO, pointer, 'transcript.txt')).toBe('step 1 failed');
    expect(await store.readGuardEvidenceBytesAt(REPO, pointer, 'step-1.png')).toEqual(PNG);
    // A text file read as bytes is its UTF-8 — the same file either way.
    expect((await store.readGuardEvidenceBytesAt(REPO, pointer, 'transcript.txt'))?.toString('utf-8')).toBe(
      'step 1 failed',
    );
  });

  it('answers nothing for a file the bundle never held, and for a dir outside the evidence root', async () => {
    await store.writeGuardRun(REPO, latest);
    const pointer = await store.writeGuardEvidence(REPO, RUN_ID, 'a.web.1', { 'transcript.txt': 'x' });

    expect(await store.readGuardEvidenceBytesAt(REPO, pointer, 'step-9.png')).toBeNull();
    expect(await store.listGuardEvidenceAt(REPO, '../../etc')).toEqual([]);
    expect(await store.readGuardEvidenceBytesAt(REPO, '.truecourse/guard/evidence/../x/y', 'step-1.png')).toBeNull();
  });

  it('serves a birth finding’s bundle off the generate report when no run row matches', async () => {
    const ref = { repoKey: REPO, commitSha: 'main1' };
    await store.writeGuardResult(ref, report, { baseline: true });
    await store.writeGuardResultEvidence(ref, 'a.web.1', { 'transcript.txt': 'born red', 'session.webm': PNG });

    const dir = '.truecourse/guard/evidence/birth1/a.web.1';
    expect(await store.listGuardEvidenceAt(REPO, dir)).toEqual(['session.webm', 'transcript.txt']);
    expect(await store.readGuardEvidenceAt(REPO, dir, 'transcript.txt')).toBe('born red');
    expect(await store.readGuardEvidenceBytesAt(REPO, dir, 'session.webm')).toEqual(PNG);
  });
});
