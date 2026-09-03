import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import {
  schema,
  MIGRATIONS_DIR,
  analyses,
  analysisCurrent,
  repoConfig,
  specSets,
  guardRuns,
  decisions,
  content,
  ghBaselines,
  type Db,
} from '@truecourse/db';
import { purgeRepoData } from '../../packages/data-store/src/index';

let client: PGlite;
let db: Db;

beforeEach(async () => {
  client = new PGlite();
  const d = drizzle(client, { schema });
  await migrate(d, { migrationsFolder: MIGRATIONS_DIR });
  db = d as unknown as Db;
});
afterEach(async () => {
  await client.close();
});

const NOW = '2026-01-01T00:00:00.000Z';

/** Seed one row per representative table for `repoKey`. */
async function seed(repoKey: string): Promise<void> {
  await db.insert(analyses).values({
    repoKey,
    filename: 'a.json',
    analysisId: 'a1',
    snapshot: {},
    createdAt: NOW,
  });
  await db.insert(analysisCurrent).values({ repoKey, kind: 'latest', body: {}, updatedAt: NOW });
  await db.insert(repoConfig).values({ repoKey, config: {} });
  await db.insert(specSets).values({
    repoKey,
    commitSha: 'c1',
    artifact: 'corpus',
    contentSha: 'sha',
    createdAt: NOW,
    updatedAt: NOW,
  });
  await db.insert(guardRuns).values({
    repoKey,
    commitSha: 'c1',
    runId: `${repoKey}-r1`,
    snapshot: {},
    summary: {},
    ranAt: NOW,
    createdAt: NOW,
  });
  await db.insert(decisions).values([
    { scope: repoKey, payload: {}, updatedAt: NOW },
    { scope: `${repoKey}#pr/3`, payload: {}, updatedAt: NOW },
    { scope: `guard:${repoKey}`, payload: {}, updatedAt: NOW },
  ]);
  await db.insert(content).values({ scope: `spec:${repoKey}`, sha: 'sha', body: '{}', createdAt: NOW });
  await db.insert(ghBaselines).values({ repoFullName: repoKey, commitSha: 'c1', capturedAt: NOW });
}

const scopesOf = async (): Promise<string[]> =>
  (await db.select({ scope: decisions.scope }).from(decisions)).map((r) => r.scope).sort();

describe('purgeRepoData', () => {
  it('deletes every per-repo row for the target and leaves other repos intact', async () => {
    await seed('acme/api');
    await seed('acme/web');

    await purgeRepoData(db, 'acme/api');

    // Target: gone everywhere.
    expect(await db.select().from(analyses)).toHaveLength(1);
    expect(await db.select().from(analysisCurrent)).toHaveLength(1);
    expect(await db.select().from(repoConfig)).toHaveLength(1);
    expect(await db.select().from(specSets)).toHaveLength(1);
    expect(await db.select().from(guardRuns)).toHaveLength(1);
    expect(await db.select().from(ghBaselines)).toHaveLength(1);
    expect(await scopesOf()).toEqual(['acme/web', 'acme/web#pr/3', 'guard:acme/web']);
    const contentRows = await db.select({ scope: content.scope }).from(content);
    expect(contentRows).toEqual([{ scope: 'spec:acme/web' }]);
    // The survivors all belong to the other repo.
    expect((await db.select().from(repoConfig))[0]?.repoKey).toBe('acme/web');
  });

  it('treats LIKE wildcards in the repo key literally', async () => {
    // `_` in a repo name must not wildcard-match another repo's PR overlays:
    // `acme/a_b#pr/%` as a raw pattern would also match `acme/aXb#pr/1`.
    await db.insert(decisions).values([
      { scope: 'acme/a_b#pr/1', payload: {}, updatedAt: NOW },
      { scope: 'acme/aXb#pr/1', payload: {}, updatedAt: NOW },
    ]);

    await purgeRepoData(db, 'acme/a_b');

    expect(await scopesOf()).toEqual(['acme/aXb#pr/1']);
  });
});
