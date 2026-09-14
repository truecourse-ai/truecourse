/**
 * The `PendingGuardBaselineStore` coalesce buffer: one row per repo,
 * latest-wins upsert, read-and-delete take and drain. PGlite with the real
 * drizzle migrations.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type Db } from '@truecourse/db';
import {
  PendingGuardBaselineStore,
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
