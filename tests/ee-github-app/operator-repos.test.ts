/**
 * The operator/boot-only cross-tenant repo enumeration (issue 06's backfill
 * source). Enumerates connected+enabled repos across EVERY workspace — the
 * deliberately un-scoped counterpart to GateStore's workspace-scoped reads.
 * Postgres-only (over PGlite): the cross-tenant surface exists solely as a hosted
 * db query, with no file adapter.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type Db } from '@truecourse/db';
import {
  PostgresGateStore,
  selectOperatorRepoEnumeration,
  type GateDb,
  type RepoLinkRecord,
} from '../../ee/packages/github-app/src/index';

function repo(name: string, over: Partial<RepoLinkRecord> = {}): RepoLinkRecord {
  return {
    repoFullName: name,
    installationId: 42,
    workspaceOrgId: 'org_A',
    defaultBranch: 'main',
    blocking: true,
    enabled: true,
    notifyEmails: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

describe('selectOperatorRepoEnumeration — Postgres', () => {
  let client: PGlite;
  let db: Db;
  let store: PostgresGateStore;

  beforeEach(async () => {
    client = new PGlite();
    db = drizzle(client, { schema }) as unknown as Db;
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    store = new PostgresGateStore(db as unknown as GateDb);
  });

  afterEach(async () => {
    await client.close();
  });

  it('lists enabled repos across ALL workspaces, projected + sorted', async () => {
    await store.linkRepo(repo('acme/api', { workspaceOrgId: 'org_A', installationId: 1 }));
    await store.linkRepo(repo('zeta/web', { workspaceOrgId: 'org_B', installationId: 2, defaultBranch: 'trunk' }));
    await store.linkRepo(repo('acme/old', { workspaceOrgId: 'org_A', enabled: false }));

    const all = await selectOperatorRepoEnumeration(db).listAllRepos();

    // Disabled repos are excluded; both workspaces represented; sorted by name.
    expect(all).toEqual([
      { repoFullName: 'acme/api', installationId: 1, defaultBranch: 'main', workspaceOrgId: 'org_A' },
      { repoFullName: 'zeta/web', installationId: 2, defaultBranch: 'trunk', workspaceOrgId: 'org_B' },
    ]);
  });

  it('is empty when no repos are connected', async () => {
    expect(await selectOperatorRepoEnumeration(db).listAllRepos()).toEqual([]);
  });
});
