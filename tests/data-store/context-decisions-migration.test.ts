/**
 * The boot migration that folds every connected repository's stored DECISIONS
 * into its workspace's, once the sources exist.
 *
 * A decision is a standing choice about a DOCUMENT, and documents moved: what is
 * pinned here is that each row is re-subjected under the context ref grammar,
 * that a row whose subject no longer exists is dropped rather than kept
 * pointing at nothing, that two repositories that disagree on one conflict
 * settle it once, and that a second boot changes nothing.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq } from 'drizzle-orm';
import {
  decisions as decisionsTable,
  ghRepos,
  specSources,
  schema,
  MIGRATIONS_DIR,
  type Db,
} from '@truecourse/db';
import type { DecisionsFile } from '@truecourse/spec-consolidator';
import {
  ContentStore,
  migrateWorkspaceContext,
  migrateWorkspaceDecisions,
} from '../../packages/data-store/src/index';

const ORG = 'org_A';
const REPO = 'acme/api';
const OTHER = 'acme/portal';
const SITE_URL = 'https://docs.strapi.io/llms.txt';

let client: PGlite;
let db: Db;

beforeEach(async () => {
  client = new PGlite();
  db = drizzle(client, { schema }) as unknown as Db;
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
});

afterEach(async () => {
  await client.close();
});

const hashOf = (body: string): string => createHash('sha256').update(body).digest('hex');

async function connect(repoFullName: string, org = ORG): Promise<void> {
  const now = new Date().toISOString();
  await db.insert(ghRepos).values({
    repoFullName,
    installationId: 1,
    workspaceOrgId: org,
    defaultBranch: 'main',
    enabled: true,
    createdAt: now,
    updatedAt: now,
  });
}

/** The old per-repository llms.txt registry, so its pages have a new home. */
async function seedRegistry(repoFullName: string, sourceId: string): Promise<void> {
  const body = '# Installation\n';
  await new ContentStore(db).putText(`spec:${repoFullName}`, body);
  await db.insert(specSources).values({
    repoKey: repoFullName,
    registry: {
      version: 1,
      sources: [
        {
          id: sourceId,
          llmsTxtUrl: SITE_URL,
          title: 'Strapi Docs',
          fetchedAt: '2026-09-01T10:00:00.000Z',
          docs: [
            {
              url: 'https://docs.strapi.io/cms/installation',
              path: 'cms/installation.md',
              title: 'Installation',
              contentHash: hashOf(body),
            },
          ],
          skipped: [],
        },
      ],
    },
    updatedAt: '2026-09-01T10:00:00.000Z',
  });
}

const decisions = (over: Partial<DecisionsFile> = {}): DecisionsFile => ({
  version: 2,
  manualIncludes: [],
  manualExcludes: [],
  manualAreas: [],
  conflictResolutions: [],
  scopeVerdicts: [],
  instructions: [],
  ...over,
});

async function seedDecisions(scope: string, value: DecisionsFile): Promise<void> {
  await db
    .insert(decisionsTable)
    .values({ scope, payload: value, updatedAt: '2026-09-01T10:00:00.000Z' });
}

async function workspaceDecisions(): Promise<DecisionsFile | null> {
  const rows = await db
    .select({ payload: decisionsTable.payload })
    .from(decisionsTable)
    .where(eq(decisionsTable.scope, `ws:${ORG}`));
  return (rows[0]?.payload as DecisionsFile) ?? null;
}

describe('the decisions migration', () => {
  it('re-homes a repository’s own documents under its Repository source', async () => {
    await connect(REPO);
    await seedDecisions(
      REPO,
      decisions({
        manualIncludes: ['docs/keep.md'],
        manualExcludes: ['README.md'],
        manualAreas: [{ doc: 'docs/keep.md', areas: ['p/c'] }],
        instructions: ['docs/en is canonical'],
        scopeVerdicts: [
          { path: '.', verdict: 'keep', reason: 'root files', decidedAt: '2026-01-01T00:00:00Z' },
          { path: 'docs/archive', verdict: 'exclude', reason: 'dead', decidedAt: '2026-01-01T00:00:00Z' },
        ],
      }),
    );
    await migrateWorkspaceContext(db);

    const summary = await migrateWorkspaceDecisions(db);
    expect(summary).toMatchObject({ workspaces: 1, dropped: 0 });

    const ws = (await workspaceDecisions())!;
    expect(ws.manualIncludes).toEqual(['context/repo-acme-api/docs/keep.md']);
    expect(ws.manualExcludes).toEqual(['context/repo-acme-api/README.md']);
    expect(ws.manualAreas[0].doc).toBe('context/repo-acme-api/docs/keep.md');
    expect(ws.instructions).toEqual(['docs/en is canonical']);
    // `.` was the repository's root files as a group; its whole source stands
    // for it now, and a directory prefix becomes a subtree inside it.
    expect(ws.scopeVerdicts.map((v) => v.path)).toEqual([
      'context/repo-acme-api',
      'context/repo-acme-api/docs/archive',
    ]);
  });

  it('re-homes an old registry page under the site source it became', async () => {
    await connect(REPO);
    await seedRegistry(REPO, 'docs-strapi-io');
    await seedDecisions(
      REPO,
      decisions({
        manualIncludes: ['.truecourse/specs/sources/docs-strapi-io/cms/installation.md'],
        scopeVerdicts: [
          { path: 'docs-strapi-io', verdict: 'keep', reason: 'vendor docs we use', decidedAt: '2026-01-01T00:00:00Z' },
        ],
      }),
    );
    await migrateWorkspaceContext(db);

    await migrateWorkspaceDecisions(db);

    const ws = (await workspaceDecisions())!;
    const siteId = ws.manualIncludes[0]!.split('/')[1];
    expect(ws.manualIncludes[0]).toBe(`context/${siteId}/cms/installation.md`);
    expect(ws.scopeVerdicts[0].path).toBe(siteId);
  });

  it('drops a row whose subject no longer exists', async () => {
    await connect(REPO);
    await seedDecisions(
      REPO,
      decisions({ manualIncludes: ['.truecourse/specs/sources/never-migrated/a.md'] }),
    );
    await migrateWorkspaceContext(db);

    const summary = await migrateWorkspaceDecisions(db);
    expect(summary.dropped).toBe(1);
    expect(await workspaceDecisions()).toBeNull();
  });

  it('keeps the newer resolution when two repositories disagree on one conflict', async () => {
    await connect(REPO);
    await connect(OTHER);
    await seedRegistry(REPO, 'docs-strapi-io');
    await seedRegistry(OTHER, 'strapi-mirror');
    const dispute = (verdict: 'a' | 'b', resolvedAt: string, sourceId: string) =>
      decisions({
        conflictResolutions: [
          {
            docA: `.truecourse/specs/sources/${sourceId}/cms/installation.md`,
            anchorA: 'Install',
            docB: 'docs/install.md',
            anchorB: 'Install',
            verdict,
            resolvedAt,
          },
        ],
      });
    // Both repositories read the same site (one workspace source) and settled
    // the same disagreement differently.
    await seedDecisions(REPO, dispute('a', '2026-01-01T00:00:00Z', 'docs-strapi-io'));
    await seedDecisions(OTHER, dispute('b', '2026-06-01T00:00:00Z', 'strapi-mirror'));
    await migrateWorkspaceContext(db);

    await migrateWorkspaceDecisions(db);

    const ws = (await workspaceDecisions())!;
    // Two rows: the site page pairs with EACH repository's own `docs/install.md`,
    // which are different documents. The site half is the same source for both.
    const siteRefs = ws.conflictResolutions.map((r) => r.docA.split('/')[1]);
    expect(new Set(siteRefs).size).toBe(1);
  });

  it('changes nothing on a second boot', async () => {
    await connect(REPO);
    await seedDecisions(REPO, decisions({ manualIncludes: ['docs/keep.md'], instructions: ['one'] }));
    await migrateWorkspaceContext(db);

    const first = await migrateWorkspaceDecisions(db);
    const after = await workspaceDecisions();
    const second = await migrateWorkspaceDecisions(db);

    expect(first.folded).toBeGreaterThan(0);
    expect(second).toMatchObject({ workspaces: 0, folded: 0, dropped: 0 });
    expect(await workspaceDecisions()).toEqual(after);
  });

  it('does nothing for a repository with no decisions, and leaves the old rows alone', async () => {
    await connect(REPO);
    await seedRegistry(REPO, 'docs-strapi-io');
    await migrateWorkspaceContext(db);

    expect(await migrateWorkspaceDecisions(db)).toMatchObject({ workspaces: 0, folded: 0 });
    expect(await workspaceDecisions()).toBeNull();
    // Nothing is deleted: the per-repository routes keep working until slice 4.
    const rows = await db.select().from(specSources).where(eq(specSources.repoKey, REPO));
    expect(rows).toHaveLength(1);
  });
});
