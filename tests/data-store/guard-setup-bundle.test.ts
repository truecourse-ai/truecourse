/**
 * The hosted half of the guard setup bundle: a per-(repo, commit) manifest row
 * over content-addressed bodies, exactly like the scenario corpus — round-trip,
 * newest-bundle fallback, cross-commit dedup, and the two rejections that keep a
 * manifest path from becoming an arbitrary write.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq } from 'drizzle-orm';
import { schema, MIGRATIONS_DIR, content, guardSetupSets, type Db } from '@truecourse/db';
import { PgGuardStore, purgeRepoData } from '../../packages/data-store/src/index';

const REPO = 'acme/api';

let client: PGlite;
let db: Db;
let store: PgGuardStore;

beforeEach(async () => {
  client = new PGlite();
  const d = drizzle(client, { schema });
  await migrate(d, { migrationsFolder: MIGRATIONS_DIR });
  db = d as unknown as Db;
  store = new PgGuardStore(db);
});
afterEach(async () => {
  await client.close();
});

const BUNDLE = {
  '.truecourse/guard/setup.json': '{"steps":[{"step":"recipe"}]}',
  '.truecourse/scenarios/recipe.json': '{"api":{}}',
  'scripts/seed.ts': 'export const seed = 1;\n',
};

const guardContentCount = async (): Promise<number> =>
  (await db.select({ sha: content.sha }).from(content).where(eq(content.scope, `guard:${REPO}`))).length;

describe('PgGuardStore setup bundle', () => {
  it('round-trips a bundle at an exact commit', async () => {
    await store.saveGuardSetupBundle({ repoKey: REPO, commitSha: 'shaA' }, BUNDLE);

    expect(await store.loadGuardSetupBundle(REPO, 'shaA')).toEqual(BUNDLE);
  });

  it('returns null when the repo or the commit has no bundle', async () => {
    expect(await store.loadGuardSetupBundle(REPO)).toBeNull();
    await store.saveGuardSetupBundle({ repoKey: REPO, commitSha: 'shaA' }, BUNDLE);
    expect(await store.loadGuardSetupBundle(REPO, 'shaZ')).toBeNull();
    expect(await store.loadGuardSetupBundle('other/repo')).toBeNull();
  });

  it('falls back to the newest bundle when no commit is given', async () => {
    await store.saveGuardSetupBundle({ repoKey: REPO, commitSha: 'shaA' }, BUNDLE);
    const newer = { ...BUNDLE, '.truecourse/guard/setup.json': '{"steps":[{"step":"seed"}]}' };
    await store.saveGuardSetupBundle({ repoKey: REPO, commitSha: 'shaB' }, newer);

    expect(await store.loadGuardSetupBundle(REPO)).toEqual(newer);
    // The older commit is still addressable.
    expect(await store.loadGuardSetupBundle(REPO, 'shaA')).toEqual(BUNDLE);
  });

  it('re-saving the same commit replaces its manifest', async () => {
    await store.saveGuardSetupBundle({ repoKey: REPO, commitSha: 'shaA' }, BUNDLE);
    await store.saveGuardSetupBundle({ repoKey: REPO, commitSha: 'shaA' }, { 'only.txt': 'one' });

    expect(await store.loadGuardSetupBundle(REPO, 'shaA')).toEqual({ 'only.txt': 'one' });
    expect(await db.select().from(guardSetupSets)).toHaveLength(1);
  });

  it('dedups identical bodies across commits into one content row each', async () => {
    await store.saveGuardSetupBundle({ repoKey: REPO, commitSha: 'shaA' }, BUNDLE);
    await store.saveGuardSetupBundle({ repoKey: REPO, commitSha: 'shaB' }, BUNDLE);

    expect(await db.select().from(guardSetupSets)).toHaveLength(2);
    expect(await guardContentCount()).toBe(Object.keys(BUNDLE).length);
  });

  it('rejects an empty commit', async () => {
    await expect(store.saveGuardSetupBundle({ repoKey: REPO, commitSha: '' }, BUNDLE)).rejects.toThrow(
      /commit/i,
    );
  });

  it('rejects a traversing or absolute manifest path', async () => {
    await expect(
      store.saveGuardSetupBundle({ repoKey: REPO, commitSha: 'shaA' }, { '../escape.txt': 'x' }),
    ).rejects.toThrow(/unsafe|escape/i);
    await expect(
      store.saveGuardSetupBundle({ repoKey: REPO, commitSha: 'shaA' }, { '/etc/passwd': 'x' }),
    ).rejects.toThrow();
    expect(await db.select().from(guardSetupSets)).toHaveLength(0);
  });

  it('is purged with the rest of the repo on disconnect', async () => {
    await store.saveGuardSetupBundle({ repoKey: REPO, commitSha: 'shaA' }, BUNDLE);
    await store.saveGuardSetupBundle({ repoKey: 'other/repo', commitSha: 'shaA' }, BUNDLE);

    await purgeRepoData(db, REPO);

    expect(await store.loadGuardSetupBundle(REPO)).toBeNull();
    expect(await guardContentCount()).toBe(0);
    expect(await store.loadGuardSetupBundle('other/repo')).toEqual(BUNDLE);
  });
});
