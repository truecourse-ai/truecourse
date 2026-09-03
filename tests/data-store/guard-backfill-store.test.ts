/**
 * The two additive stores behind issue 06's baseline refresh + deploy backfill:
 * the `PendingGuardBaselineStore` coalesce buffer (one row/repo, latest-wins
 * upsert, read-and-delete take/drain — the guard analogue of the pending-baseline
 * buffer) and the `GuardBackfillMarkerStore` run-once marker (idempotent mark,
 * isMarked gate). PGlite with the real drizzle migrations.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type Db } from '@truecourse/db';
import {
  PendingGuardBaselineStore,
  GuardBackfillMarkerStore,
  type PendingGuardBaselineInput,
} from '../../packages/data-store/src/index';

const ORG = 'org_A';
const REPO = 'acme/api';

let client: PGlite;
let db: Db;

beforeEach(async () => {
  client = new PGlite();
  db = drizzle(client, { schema }) as unknown as Db;
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
});

afterEach(async () => {
  await client.close();
});

const input = (
  commitSha: string,
  over: Partial<PendingGuardBaselineInput> = {},
): PendingGuardBaselineInput => ({
  repoFullName: REPO,
  installationId: 42,
  defaultBranch: 'main',
  commitSha,
  workspaceOrgId: ORG,
  ...over,
});

describe('PendingGuardBaselineStore', () => {
  it('upsert keeps one row per repo, latest commit wins', async () => {
    const store = new PendingGuardBaselineStore(db);
    await store.upsert(input('c1'));
    await store.upsert(input('c2'));

    const row = await store.take(REPO);
    expect(row).toMatchObject({
      repoFullName: REPO,
      commitSha: 'c2',
      installationId: 42,
      defaultBranch: 'main',
      workspaceOrgId: ORG,
    });
    // take is read-and-delete: the row is gone.
    expect(await store.take(REPO)).toBeNull();
  });

  it('drain reads-and-deletes every repo row', async () => {
    const store = new PendingGuardBaselineStore(db);
    await store.upsert(input('c1'));
    await store.upsert(input('c9', { repoFullName: 'acme/web' }));

    const drained = await store.drain();
    expect(drained.map((r) => r.repoFullName).sort()).toEqual(['acme/api', 'acme/web']);
    expect(await store.drain()).toEqual([]);
  });
});

describe('GuardBackfillMarkerStore', () => {
  it('isMarked flips false→true after mark, and mark is idempotent', async () => {
    const store = new GuardBackfillMarkerStore(db);
    expect(await store.isMarked(REPO)).toBe(false);

    await store.mark(REPO);
    expect(await store.isMarked(REPO)).toBe(true);

    // A second mark is a no-op (no throw on the PK conflict).
    await store.mark(REPO);
    expect(await store.isMarked(REPO)).toBe(true);
  });

  it('scopes per repo — marking one leaves others unmarked', async () => {
    const store = new GuardBackfillMarkerStore(db);
    await store.mark(REPO);
    expect(await store.isMarked('acme/web')).toBe(false);
  });
});
