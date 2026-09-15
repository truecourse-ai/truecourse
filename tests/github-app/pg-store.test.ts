import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import {
  PostgresInstallationStore,
  type InstallationDb,
  type InstallationRecord,
} from '../../packages/github-app/src/index';
import { schema, MIGRATIONS_DIR } from '@truecourse/db';

let client: PGlite;
let db: ReturnType<typeof drizzle>;
let store: PostgresInstallationStore;

beforeEach(async () => {
  client = new PGlite();
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  store = new PostgresInstallationStore(db as unknown as InstallationDb, () => client.close());
});

afterEach(async () => {
  await store.close();
});

function installation(id: number, org: string | null = null): InstallationRecord {
  return {
    installationId: id,
    accountLogin: `acct-${id}`,
    accountType: 'Organization',
    workspaceOrgId: org,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('PostgresInstallationStore (Drizzle, validated against pglite)', () => {
  it('round-trips installations with the COALESCE upsert', async () => {
    await store.saveInstallation(installation(1, 'org_A'));
    expect((await store.getInstallation(1))?.workspaceOrgId).toBe('org_A');

    // A re-sent install with no workspace must preserve the existing link.
    await store.saveInstallation(installation(1, null));
    expect((await store.getInstallation(1))?.workspaceOrgId).toBe('org_A');

    await store.linkInstallationToWorkspace(1, 'org_B');
    expect((await store.getInstallation(1))?.workspaceOrgId).toBe('org_B');
    expect(await store.getInstallation(999)).toBeNull();
  });

  it('removes an installation', async () => {
    await store.saveInstallation(installation(1, 'org_A'));
    await store.removeInstallation(1);
    expect(await store.getInstallation(1)).toBeNull();
  });

  it("keeps one workspace's installations apart from another's", async () => {
    await store.saveInstallation(installation(1, 'org_A'));
    await store.saveInstallation(installation(2, 'org_B'));
    expect((await store.listInstallationsForWorkspace('org_A')).map((i) => i.installationId)).toEqual([1]);
    expect((await store.listInstallationsForWorkspace('org_B')).map((i) => i.installationId)).toEqual([2]);
  });
});
