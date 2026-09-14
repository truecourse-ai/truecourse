/**
 * The connected repositories in Postgres, and the registry derived from them.
 * One table for every provider: a repository the GitHub App brought and a
 * folder on the machine are rows of the same shape, and what differs is only
 * what each fills in.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { RepositoryRecord } from '@truecourse/shared';
import { schema, MIGRATIONS_DIR, type Db } from '@truecourse/db';
import { PgRepositoryStore, RepositoriesRegistryStore } from '@truecourse/data-store';

let client: PGlite;
let db: Db;
let store: PgRepositoryStore;

beforeEach(async () => {
  client = new PGlite();
  db = drizzle(client, { schema }) as unknown as Db;
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  store = new PgRepositoryStore(db);
});

afterEach(async () => {
  await client.close();
});

function githubRepo(name: string, over: Partial<RepositoryRecord> = {}): RepositoryRecord {
  return {
    repoFullName: name,
    provider: 'github',
    accountId: '1',
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

function folder(name: string, path: string, over: Partial<RepositoryRecord> = {}): RepositoryRecord {
  return {
    repoFullName: name,
    provider: 'local',
    accountId: null,
    workspaceOrgId: 'org_A',
    defaultBranch: null,
    location: path,
    blocking: true,
    enabled: true,
    notifyEmails: [],
    createdAt: '2026-01-02T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...over,
  };
}

describe('PgRepositoryStore', () => {
  it('round-trips a connected repository, including notify_emails and blocking', async () => {
    await store.linkRepo(githubRepo('acme/api', { notifyEmails: ['a@x.com'], blocking: false }));
    const r = await store.getRepo('acme/api');
    expect(r?.provider).toBe('github');
    expect(r?.accountId).toBe('1');
    expect(r?.notifyEmails).toEqual(['a@x.com']);
    expect(r?.blocking).toBe(false);

    // Linking the same name again replaces the row rather than adding one.
    await store.linkRepo(githubRepo('acme/api', { blocking: true }));
    expect((await store.getRepo('acme/api'))?.blocking).toBe(true);
    expect(await store.listReposForWorkspace('org_A')).toHaveLength(1);
  });

  it('keeps a folder with no account and no branch, and remembers where it is', async () => {
    await store.linkRepo(folder('local/orders', '/Users/dev/code/orders'));
    const r = await store.getRepo('local/orders');
    expect(r).toMatchObject({
      provider: 'local',
      accountId: null,
      defaultBranch: null,
      location: '/Users/dev/code/orders',
    });
  });

  it('scopes by workspace and by provider account', async () => {
    await store.linkRepo(githubRepo('acme/api'));
    await store.linkRepo(githubRepo('acme/web', { accountId: '2' }));
    await store.linkRepo(githubRepo('other/thing', { workspaceOrgId: 'org_B', accountId: '3' }));
    await store.linkRepo(folder('local/orders', '/tmp/orders'));

    expect((await store.listReposForWorkspace('org_A')).map((r) => r.repoFullName)).toEqual([
      'acme/api',
      'acme/web',
      'local/orders',
    ]);
    expect((await store.listReposForAccount('github', '1')).map((r) => r.repoFullName)).toEqual([
      'acme/api',
    ]);
    // A folder belongs to no account, so no account lists it.
    expect(await store.listReposForAccount('github', '99')).toEqual([]);

    await store.unlinkRepo('acme/api');
    expect(await store.getRepo('acme/api')).toBeNull();
  });
});

describe('the registry derived from them', () => {
  it('names each repository, carries its provider, and serves a folder by its path', async () => {
    await store.linkRepo(githubRepo('acme/api'));
    await store.linkRepo(folder('local/orders', '/Users/dev/code/orders'));
    const registry = new RepositoriesRegistryStore(db);

    const entries = await registry.readRegistry();
    expect(entries.map((e) => e.slug)).toEqual(['acme-api', 'local-orders']);
    expect(entries[0]).toMatchObject({
      name: 'acme/api',
      path: 'acme/api',
      provider: 'github',
      defaultBranch: 'main',
      remoteUrl: 'https://github.com/acme/api',
    });
    expect(entries[1]).toMatchObject({
      name: 'local/orders',
      provider: 'local',
      remoteUrl: '/Users/dev/code/orders',
    });
    expect(entries[1]?.defaultBranch).toBeUndefined();

    expect((await registry.getProjectBySlug('local-orders'))?.path).toBe('local/orders');
    expect((await registry.getProjectByPath('acme/api'))?.slug).toBe('acme-api');
  });
});
