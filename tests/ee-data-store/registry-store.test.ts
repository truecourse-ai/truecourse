import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, ghRepos, type EeDb } from '@truecourse/ee-db';
import { GhReposRegistryStore } from '../../ee/packages/data-store/src/index';

let client: PGlite;
let db: EeDb;
let store: GhReposRegistryStore;

beforeEach(async () => {
  client = new PGlite();
  const d = drizzle(client, { schema });
  await migrate(d, { migrationsFolder: MIGRATIONS_DIR });
  db = d as unknown as EeDb;
  store = new GhReposRegistryStore(db);
});
afterEach(async () => {
  await client.close();
});

async function link(repoFullName: string, defaultBranch: string) {
  const now = new Date().toISOString();
  await db.insert(ghRepos).values({
    repoFullName,
    installationId: 1,
    workspaceOrgId: 'org_1',
    defaultBranch,
    createdAt: now,
    updatedAt: now,
  });
}

describe('GhReposRegistryStore', () => {
  // Regression: the repo route used to shell out to git on `entry.path` (the
  // repo identity, not a real dir in hosted mode), logging "git unavailable" and
  // leaving defaultBranch undefined. The branch must come from gh_repos instead.
  it('surfaces gh_repos.defaultBranch on the registry entry, keyed by slug and path', async () => {
    await link('acme/api', 'develop');

    const bySlug = await store.getProjectBySlug('acme-api');
    expect(bySlug).toMatchObject({ name: 'acme/api', path: 'acme/api', defaultBranch: 'develop' });

    const byPath = await store.getProjectByPath('acme/api');
    expect(byPath?.defaultBranch).toBe('develop');

    const all = await store.readRegistry();
    expect(all).toEqual([
      expect.objectContaining({ path: 'acme/api', defaultBranch: 'develop' }),
    ]);
  });
});
