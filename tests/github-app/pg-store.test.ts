import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import {
  PostgresInstallationStore,
  type InstallationDb,
  type InstallationAccount,
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

function installation(id: number): InstallationAccount {
  return {
    installationId: id,
    accountLogin: `acct-${id}`,
    accountType: 'Organization',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('PostgresInstallationStore (Drizzle, validated against pglite)', () => {
  it('round-trips an account, and a re-save keeps its workspace links', async () => {
    await store.saveInstallation(installation(1));
    await store.linkInstallationToWorkspace(1, 'org_A');
    expect((await store.getInstallation(1))?.workspaceOrgIds).toEqual(['org_A']);

    // A re-sent install event carries no workspace and must not drop the link.
    await store.saveInstallation({ ...installation(1), accountLogin: 'renamed' });
    expect(await store.getInstallation(1)).toMatchObject({
      accountLogin: 'renamed',
      workspaceOrgIds: ['org_A'],
    });
    expect(await store.getInstallation(999)).toBeNull();
  });

  it('attaches one installation to many workspaces, once each, in attach order', async () => {
    await store.saveInstallation(installation(1));
    await store.linkInstallationToWorkspace(1, 'org_A');
    await store.linkInstallationToWorkspace(1, 'org_B');
    await store.linkInstallationToWorkspace(1, 'org_A'); // a repeat trip
    expect((await store.getInstallation(1))?.workspaceOrgIds).toEqual(['org_A', 'org_B']);
    expect((await store.listInstallationsForWorkspace('org_A')).map((i) => i.installationId)).toEqual([1]);
    expect((await store.listInstallationsForWorkspace('org_B')).map((i) => i.installationId)).toEqual([1]);
  });

  it('detaches one workspace and keeps the other', async () => {
    await store.saveInstallation(installation(1));
    await store.linkInstallationToWorkspace(1, 'org_A');
    await store.linkInstallationToWorkspace(1, 'org_B');
    await store.unlinkInstallationFromWorkspace(1, 'org_A');
    expect((await store.getInstallation(1))?.workspaceOrgIds).toEqual(['org_B']);
    expect(await store.listInstallationsForWorkspace('org_A')).toEqual([]);
    // Detaching a workspace that was never attached is a no-op.
    await store.unlinkInstallationFromWorkspace(1, 'org_C');
    expect((await store.getInstallation(1))?.workspaceOrgIds).toEqual(['org_B']);
  });

  it('removes an installation with every workspace link', async () => {
    await store.saveInstallation(installation(1));
    await store.linkInstallationToWorkspace(1, 'org_A');
    await store.linkInstallationToWorkspace(1, 'org_B');
    await store.removeInstallation(1);
    expect(await store.getInstallation(1)).toBeNull();
    expect(await store.listInstallationsForWorkspace('org_A')).toEqual([]);
    expect(await store.listInstallationsForWorkspace('org_B')).toEqual([]);
  });

  it("keeps one workspace's installations apart from another's", async () => {
    await store.saveInstallation(installation(1));
    await store.saveInstallation(installation(2));
    await store.linkInstallationToWorkspace(1, 'org_A');
    await store.linkInstallationToWorkspace(2, 'org_B');
    expect((await store.listInstallationsForWorkspace('org_A')).map((i) => i.installationId)).toEqual([1]);
    expect((await store.listInstallationsForWorkspace('org_B')).map((i) => i.installationId)).toEqual([2]);
  });

  it('refuses a link for an account it does not hold', async () => {
    await expect(store.linkInstallationToWorkspace(404, 'org_A')).rejects.toThrow();
  });
});
