import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import request from 'supertest';
import { type Express } from 'express';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type EeDb } from '@truecourse/ee-db';
import { FsBlobStore } from '../../ee/packages/storage/src/index';
import { PgSpecStore, PgVerifyStore, PgContractStore } from '../../ee/packages/data-store/src/index';
import { setSpecStore, resetSpecStore, saveSpec } from '@truecourse/core/lib/spec-store';
import { setContractStore, resetContractStore, saveContracts } from '@truecourse/core/lib/contract-store';
import { setVerifyStore, resetVerifyStore, writeVerifyLatest } from '@truecourse/core/lib/verify-store';
import type { VerifyLatest } from '@truecourse/core/types/verify-snapshot';
import { createApp } from '../../apps/dashboard/server/src/app';
import { setupTestFixture, teardownTestFixture, type TestFixture } from '../helpers/test-db';

/** The Contracts PR diff (EE per-commit) — head at `?ref` vs the verify baseline. */

async function makeDb(client: PGlite): Promise<EeDb> {
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db as unknown as EeDb;
}

const baseline = (commitHash: string): VerifyLatest => ({
  head: 'run.json',
  run: { id: 'r1', verifiedAt: '2026-01-01T00:00:00.000Z', branch: 'main', commitHash, contractsDir: '.truecourse/contracts', codeDir: '.' },
  artifactCount: 0,
  extractedOperationCount: 0,
  drifts: [],
  resolverErrors: [],
  unresolvedRefs: [],
  summary: { total: 0, bySeverity: { critical: 0, high: 0, medium: 0, low: 0, info: 0 } },
});

/** Write a contracts dir and ingest it into the store at `commit`. */
async function seedContracts(repoKey: string, commit: string, files: Record<string, string>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-cdiff-'));
  for (const [rel, content] of Object.entries(files)) {
    const f = path.join(dir, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, content);
  }
  await saveContracts({ repoKey, commitSha: commit }, 'contracts', dir);
  fs.rmSync(dir, { recursive: true, force: true });
}

/** Minimal stored corpus — the "head regenerated the spec" signal the diff keys off. */
function corpus() {
  return { version: 3, generatedAt: '2026-01-02T00:00:00.000Z', docs: [], areas: [], relations: [] };
}

describe('BL-Drift PR diff routes', () => {
  let client: PGlite;
  let blobDir: string;
  let app: Express;
  let fixture: TestFixture;

  beforeEach(async () => {
    client = new PGlite();
    blobDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-bldiff-blob-'));
    const db = await makeDb(client);
    setSpecStore(new PgSpecStore(db));
    setContractStore(new PgContractStore(db, new FsBlobStore(blobDir)));
    setVerifyStore(new PgVerifyStore(db));
    fixture = await setupTestFixture();
    app = createApp({ serveStatic: false });
  });

  afterEach(async () => {
    resetSpecStore();
    resetContractStore();
    resetVerifyStore();
    await client.close();
    fs.rmSync(blobDir, { recursive: true, force: true });
    await teardownTestFixture(fixture.project.slug);
  });

  it('contracts/diff: added / removed / modified by path + content', async () => {
    const repoKey = fixture.repoPath;
    await seedContracts(repoKey, 'base', {
      'orders/keep.tc': 'entity Keep {}',
      'orders/edit.tc': 'entity Edit { field a }',
      'orders/drop.tc': 'entity Drop {}',
    });
    await seedContracts(repoKey, 'head', {
      'orders/keep.tc': 'entity Keep {}',
      'orders/edit.tc': 'entity Edit { field a field b }',
      'orders/add.tc': 'entity Add {}',
    });
    // A real contract change means the head regenerated the spec → a corpus at the head.
    await saveSpec({ repoKey, commitSha: 'head' }, 'corpus', corpus());
    await writeVerifyLatest(repoKey, baseline('base'));

    const res = await request(app)
      .get(`/api/repos/${fixture.project.slug}/contracts/diff?ref=head`)
      .expect(200);
    expect(res.body.added).toEqual(['orders/add.tc']);
    expect(res.body.removed).toEqual(['orders/drop.tc']);
    expect(res.body.modified).toEqual(['orders/edit.tc']);
  });

  it('code-only PR head (nothing stored at the ref) ⇒ empty diff, NOT all-removed', async () => {
    const repoKey = fixture.repoPath;
    // The baseline has contracts, but the PR head stored nothing (the gate reuses
    // the base spec/contracts for a code-only PR). The diff must be empty.
    await seedContracts(repoKey, 'base', { 'orders/keep.tc': 'entity Keep {}' });
    await writeVerifyLatest(repoKey, baseline('base'));

    const c = await request(app)
      .get(`/api/repos/${fixture.project.slug}/contracts/diff?ref=headonly`)
      .expect(200);
    expect(c.body).toEqual({ added: [], removed: [], modified: [] });
  });

  it('PARTIAL head contracts (reapplied promotion, no corpus at head) ⇒ empty diff', async () => {
    const repoKey = fixture.repoPath;
    // Baseline has 3 contracts; the PR head has only 1 (a reapplied promotion) and NO
    // corpus artifact (code-only PR). Must NOT report the other 2 as removed.
    await seedContracts(repoKey, 'base', {
      'orders/a.tc': 'entity A {}',
      'orders/b.tc': 'entity B {}',
      'orders/c.tc': 'entity C {}',
    });
    await seedContracts(repoKey, 'head', { 'orders/a.tc': 'entity A {}' });
    await writeVerifyLatest(repoKey, baseline('base'));

    const res = await request(app)
      .get(`/api/repos/${fixture.project.slug}/contracts/diff?ref=head`)
      .expect(200);
    expect(res.body).toEqual({ added: [], removed: [], modified: [] });
  });

  it('returns empty diffs with no ref', async () => {
    await request(app).get(`/api/repos/${fixture.project.slug}/contracts/diff`).expect(200)
      .then((r) => expect(r.body).toEqual({ added: [], removed: [], modified: [] }));
  });
});
