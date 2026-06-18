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
import { PgSpecStore, PgVerifyStore } from '../../ee/packages/data-store/src/index';
import { setSpecStore, resetSpecStore, saveSpec } from '@truecourse/core/lib/spec-store';
import { setVerifyStore, resetVerifyStore, writeVerifyLatest } from '@truecourse/core/lib/verify-store';
import { resetInferredActionStore } from '@truecourse/core/lib/inferred-action-store';
import type { VerifyLatest } from '@truecourse/core/types/verify-snapshot';
import { createApp } from '../../apps/dashboard/server/src/app';
import { setupTestFixture, teardownTestFixture, type TestFixture } from '../helpers/test-db';

/**
 * The Inferred PR diff is EE-only (per-commit storage). It reads the head set at
 * `?ref=<headSha>` and the base set at the VERIFY BASELINE commit (the `isBaseline`
 * snapshot — the canonical default branch, not the most-recent scan which a PR-head
 * run pollutes). This pins that wiring, shared by all four BL-Drift diff endpoints.
 */

async function makeDb(client: PGlite): Promise<EeDb> {
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db as unknown as EeDb;
}

const enumTc = (identity: string, body: string) =>
  `enum ${identity} {\n  // inferred — enum defined in code but documented in no spec\n  inferred-from "src/x.ts" 1..1\n  confidence high\n  ${body}\n}\n`;

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

describe('GET /api/repos/:id/inferred/diff (PR delta)', () => {
  let client: PGlite;
  let app: Express;
  let fixture: TestFixture;

  beforeEach(async () => {
    client = new PGlite();
    const db = await makeDb(client);
    setSpecStore(new PgSpecStore(db));
    setVerifyStore(new PgVerifyStore(db));
    resetInferredActionStore();
    fixture = await setupTestFixture();
    app = createApp({ serveStatic: false });
  });

  afterEach(async () => {
    resetSpecStore();
    resetVerifyStore();
    resetInferredActionStore();
    await client.close();
    await teardownTestFixture(fixture.project.slug);
  });

  it('returns added + changed of the head vs the verify baseline commit', async () => {
    const repoKey = fixture.repoPath;
    // Baseline (default-branch) inferred set at commit `base`.
    await saveSpec({ repoKey, commitSha: 'base' }, 'inferredDecisions', [
      { kind: 'Enum', identity: 'Role', tc: enumTc('Role', 'values [A]') },
      { kind: 'Entity', identity: 'Gone', tc: 'entity Gone {}' },
    ]);
    // PR head inferred set at commit `head`: Role's body changed, GET /new is brand new.
    await saveSpec({ repoKey, commitSha: 'head' }, 'inferredDecisions', [
      { kind: 'Enum', identity: 'Role', tc: enumTc('Role', 'values [A, B]') },
      { kind: 'Operation', identity: 'GET /new', tc: 'operation GET "/new" {}' },
    ]);
    // The verify baseline anchors the diff's base commit.
    await writeVerifyLatest(repoKey, baseline('base'));

    const res = await request(app)
      .get(`/api/repos/${fixture.project.slug}/inferred/diff?ref=head`)
      .expect(200);
    expect(res.body.added.map((d: { identity: string }) => d.identity)).toEqual(['GET /new']);
    expect(res.body.changed.map((d: { identity: string }) => d.identity)).toEqual(['Role']);
    // `Gone` is in the base but not the head → documented/removed by the PR → resolved.
    expect(res.body.resolved.map((d: { identity: string }) => d.identity)).toEqual(['Gone']);
    expect(res.body.fellBack).toBe(false);
  });

  it('returns an empty diff when no ref is given', async () => {
    const res = await request(app)
      .get(`/api/repos/${fixture.project.slug}/inferred/diff`)
      .expect(200);
    expect(res.body).toEqual({ added: [], changed: [], resolved: [], fellBack: false });
  });
});
