import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, ghRepos, type Db } from '@truecourse/db';
import { GhReposRegistryStore } from '../../ee/packages/data-store/src/index';

let client: PGlite;
let db: Db;
let store: GhReposRegistryStore;

beforeEach(async () => {
  client = new PGlite();
  const d = drizzle(client, { schema });
  await migrate(d, { migrationsFolder: MIGRATIONS_DIR });
  db = d as unknown as Db;
  store = new GhReposRegistryStore(db);
});
afterEach(async () => {
  await client.close();
});

async function link(repoFullName: string, defaultBranch: string, createdAt?: string) {
  const now = createdAt ?? new Date().toISOString();
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

  // Slugification is lossy (`_`, `.`, `/` all collapse to `-`), so distinct
  // repos can want the same slug. The earlier-connected repo keeps the base
  // slug; later ones take deterministic suffixes — and every lookup mints the
  // same slugs, so no entry ever 404s or serves another repo's data.
  it('mints deterministic collision suffixes ordered by connection time', async () => {
    await link('acme/data_pipeline', 'main', '2026-01-02T00:00:00.000Z');
    await link('acme/data-pipeline', 'main', '2026-01-01T00:00:00.000Z');

    const all = await store.readRegistry();
    expect(all.map((e) => [e.name, e.slug])).toEqual([
      ['acme/data-pipeline', 'acme-data-pipeline'],
      ['acme/data_pipeline', 'acme-data-pipeline-2'],
    ]);

    // Both resolve, each to its own repo — by slug and by path alike.
    expect((await store.getProjectBySlug('acme-data-pipeline'))?.name).toBe('acme/data-pipeline');
    expect((await store.getProjectBySlug('acme-data-pipeline-2'))?.name).toBe('acme/data_pipeline');
    expect((await store.getProjectByPath('acme/data_pipeline'))?.slug).toBe(
      'acme-data-pipeline-2',
    );
  });
});
