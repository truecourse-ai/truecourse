import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import {
  schema,
  MIGRATIONS_DIR,
  guardRuns,
  guardSetupSets,
  decisions,
  content,
  contextSources,
  contextBindings,
  contextWorkspaces,
  pullRequests,
  pullRequestChecks,
  workspaceSpecSets,
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
  await db.insert(guardRuns).values({
    repoKey,
    commitSha: 'c1',
    runId: `${repoKey}-r1`,
    snapshot: {},
    summary: {},
    ranAt: NOW,
    createdAt: NOW,
  });
  await db.insert(guardSetupSets).values({
    id: `${repoKey}-setup1`,
    repoKey,
    commitSha: 'c1',
    manifest: { v: 1, files: {} },
    manifestHash: 'sha',
    fileCount: 0,
    createdAt: NOW,
  });
  await db.insert(decisions).values([
    { scope: `ws:org_${repoKey}`, payload: {}, updatedAt: NOW },
    { scope: `guard:${repoKey}`, payload: {}, updatedAt: NOW },
  ]);
  await db.insert(content).values({ scope: `guard:${repoKey}`, sha: 'sha', body: '{}', createdAt: NOW });
  await db.insert(pullRequests).values({
    repoFullName: repoKey,
    number: 1,
    workspaceOrgId: `org_${repoKey}`,
    provider: 'github',
    title: 'pr',
    authorLogin: 'octocat',
    headSha: 'h',
    headRef: 'f',
    baseRef: 'main',
    draft: false,
    state: 'open',
    openedAt: NOW,
    updatedAt: NOW,
  });
  await db.insert(pullRequestChecks).values({
    id: `${repoKey}-check1`,
    repoFullName: repoKey,
    number: 1,
    headSha: 'h',
    attempt: 1,
    status: 'settled',
    createdAt: NOW,
  });
  // The workspace's corpus stays; the corpora this repository's checks scanned go.
  await db.insert(workspaceSpecSets).values([
    { id: `${repoKey}-ws`, workspaceOrgId: `org_${repoKey}`, artifact: 'corpus', contentSha: 'sha', scope: 'default', createdAt: NOW },
    { id: `${repoKey}-pr`, workspaceOrgId: `org_${repoKey}`, artifact: 'corpus', contentSha: 'sha', scope: `pr/${repoKey}#1`, createdAt: NOW },
  ]);
}

const scopesOf = async (): Promise<string[]> =>
  (await db.select({ scope: decisions.scope }).from(decisions)).map((r) => r.scope).sort();

describe('purgeRepoData', () => {
  it('deletes every per-repo row for the target and leaves other repos intact', async () => {
    await seed('acme/api');
    await seed('acme/web');

    await purgeRepoData(db, 'acme/api');

    // Target: gone everywhere.
    expect(await db.select().from(guardRuns)).toHaveLength(1);
    expect(await db.select().from(guardSetupSets)).toHaveLength(1);
    // The workspace's own decisions survive a repository disconnect.
    expect(await scopesOf()).toEqual(['guard:acme/web', 'ws:org_acme/api', 'ws:org_acme/web']);
    const contentRows = await db.select({ scope: content.scope }).from(content);
    expect(contentRows).toEqual([{ scope: 'guard:acme/web' }]);
    // The survivors all belong to the other repo.
    expect((await db.select().from(guardRuns))[0]?.repoKey).toBe('acme/web');
    // Its pull requests and checks go; the other repo's stay.
    expect((await db.select().from(pullRequests)).map((r) => r.repoFullName)).toEqual(['acme/web']);
    expect((await db.select().from(pullRequestChecks)).map((r) => r.repoFullName)).toEqual(['acme/web']);
    // The corpora its checks scanned go; the workspace's own corpus stays.
    expect((await db.select({ scope: workspaceSpecSets.scope }).from(workspaceSpecSets)).map((r) => r.scope).sort()).toEqual([
      'default',
      'default',
      'pr/acme/web#1',
    ]);
  });

  it('matches a repository’s pull request scopes by name, never by LIKE wildcard', async () => {
    // `_` would match any one character in a LIKE pattern: foo_bar must not
    // take foo-bar's corpora with it.
    await seed('acme/foo_bar');
    await seed('acme/foo-bar');
    await purgeRepoData(db, 'acme/foo_bar');
    const scopes = (await db.select({ scope: workspaceSpecSets.scope }).from(workspaceSpecSets)).map((r) => r.scope);
    expect(scopes.filter((s) => s.startsWith('pr/'))).toEqual(['pr/acme/foo-bar#1']);
  });

  it('takes the repository’s context LINKS and leaves the workspace’s sources', async () => {
    // Context is workspace state: a disconnect drops what THIS repository read,
    // never a source another repository still reads.
    await db.insert(contextSources).values({
      workspaceOrgId: 'org_A',
      id: 'site-docs',
      kind: 'site',
      title: 'Docs',
      config: { llmsTxtUrl: 'https://docs.acme.com/llms.txt' },
      status: 'synced',
      createdAt: NOW,
      updatedAt: NOW,
    });
    await db.insert(contextBindings).values([
      { workspaceOrgId: 'org_A', repoFullName: 'acme/api', sourceId: 'site-docs', createdAt: NOW },
      { workspaceOrgId: 'org_A', repoFullName: 'acme/web', sourceId: 'site-docs', createdAt: NOW },
    ]);

    await purgeRepoData(db, 'acme/api');

    expect(await db.select().from(contextSources)).toHaveLength(1);
    expect(
      (await db.select().from(contextBindings)).map((row) => row.repoFullName),
    ).toEqual(['acme/web']);
    // Dropping a link makes the workspace's corpus stale, whoever dropped it.
    expect((await db.select().from(contextWorkspaces)).map((row) => row.workspaceOrgId)).toEqual([
      'org_A',
    ]);
  });
});
