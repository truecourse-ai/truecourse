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
import type { RepositoryLink } from '@truecourse/shared';
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

function githubRepo(name: string, over: Partial<RepositoryLink> = {}): RepositoryLink {
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

function folder(name: string, path: string, over: Partial<RepositoryLink> = {}): RepositoryLink {
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

describe('the pushed commit', () => {
  it('is remembered per repository, and forgotten by a re-link', async () => {
    await store.linkRepo(githubRepo('acme/api'));
    expect((await store.getRepo('acme/api'))?.defaultBranchSha).toBeNull();
    await store.recordDefaultBranchSha('acme/api', 'sha-1');
    expect((await store.getRepo('acme/api'))?.defaultBranchSha).toBe('sha-1');
    // A repository nobody connected records nothing, quietly.
    await store.recordDefaultBranchSha('acme/other', 'sha-2');
    expect(await store.getRepo('acme/other')).toBeNull();
    await store.linkRepo(githubRepo('acme/api'));
    expect((await store.getRepo('acme/api'))?.defaultBranchSha).toBeNull();
  });
});

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

  it('moves every repository of one account to another, answering the rows moved', async () => {
    await store.linkRepo(githubRepo('acme/api'));
    await store.linkRepo(githubRepo('acme/web'));
    await store.linkRepo(githubRepo('other/thing', { workspaceOrgId: 'org_B', accountId: '3' }));

    const moved = await store.moveReposToAccount('github', '1', '7');
    expect(moved.map((r) => [r.repoFullName, r.accountId])).toEqual([
      ['acme/api', '7'],
      ['acme/web', '7'],
    ]);
    expect(await store.listReposForAccount('github', '1')).toEqual([]);
    expect((await store.listReposForAccount('github', '7')).map((r) => r.repoFullName)).toEqual([
      'acme/api',
      'acme/web',
    ]);
    // Another account's rows, and every other column, are untouched.
    expect((await store.getRepo('other/thing'))?.accountId).toBe('3');
    expect((await store.getRepo('acme/api'))?.slug).toBe('acme-api');
    expect(await store.moveReposToAccount('github', '99', '7')).toEqual([]);
  });

  it('mints the slug against the workspace alone, so two workspaces share a plain slug', async () => {
    const a = await store.linkRepo(githubRepo('acme/data-pipeline'));
    const b = await store.linkRepo(githubRepo('acme/data_pipeline', { workspaceOrgId: 'org_B', accountId: '2' }));
    expect(a.slug).toBe('acme-data-pipeline');
    expect(b.slug).toBe('acme-data-pipeline');
  });

  it('suffixes a collision inside one workspace and keeps that slug when the first is disconnected', async () => {
    await store.linkRepo(githubRepo('acme/data-pipeline'));
    const second = await store.linkRepo(githubRepo('acme/data_pipeline'));
    expect(second.slug).toBe('acme-data-pipeline-2');

    await store.unlinkRepo('acme/data-pipeline');
    expect((await store.getRepo('acme/data_pipeline'))?.slug).toBe('acme-data-pipeline-2');
  });

  it('keeps the slug on a re-link at the same name', async () => {
    const first = await store.linkRepo(githubRepo('acme/api'));
    const again = await store.linkRepo(githubRepo('acme/api', { blocking: false }));
    expect(again.slug).toBe(first.slug);
  });
});

describe('the registry derived from them', () => {
  it('names each repository and carries its provider', async () => {
    await store.linkRepo(githubRepo('acme/api'));
    await store.linkRepo(folder('local/orders', '/Users/dev/code/orders'));
    const registry = new RepositoriesRegistryStore(db);

    const entries = await registry.readRegistry('org_A');
    expect(entries.map((e) => e.slug)).toEqual(['acme-api', 'local-orders']);
    expect(entries[0]).toMatchObject({
      name: 'acme/api',
      path: 'acme/api',
      provider: 'github',
      defaultBranch: 'main',
    });
    expect(entries[1]).toMatchObject({ name: 'local/orders', provider: 'local' });
    expect(entries[1]?.defaultBranch).toBeUndefined();

    expect((await registry.getProjectBySlug('org_A', 'local-orders'))?.path).toBe('local/orders');
    expect((await registry.getProjectByPath('org_A', 'acme/api'))?.slug).toBe('acme-api');
  });

  it("cannot reach another workspace's repository by slug or by name", async () => {
    await store.linkRepo(githubRepo('acme/api'));
    const registry = new RepositoriesRegistryStore(db);

    expect(await registry.readRegistry('org_B')).toEqual([]);
    expect(await registry.getProjectBySlug('org_B', 'acme-api')).toBeNull();
    expect(await registry.getProjectByPath('org_B', 'acme/api')).toBeNull();
  });
});
