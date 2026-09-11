/**
 * The boot migration that brings the workspaces that already exist into
 * Context: a Repository source per connected repository, and every row of the
 * old per-repository `spec_sources` registry as a workspace site source with
 * its page bodies copied into the workspace scope.
 *
 * Two properties matter beyond the conversion itself: it is IDEMPOTENT (a
 * second boot changes nothing), and it DROPS NOTHING — the old registry and its
 * bodies are still there afterwards, because the per-repository routes keep
 * working until slice 4 retires them.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq } from 'drizzle-orm';
import {
  content,
  ghRepos,
  specSources,
  contextWorkspaces,
  schema,
  MIGRATIONS_DIR,
  type Db,
} from '@truecourse/db';
import {
  ContentStore,
  PgContextStore,
  migrateWorkspaceContext,
} from '../../packages/data-store/src/index';

const ORG = 'org_A';
const OTHER = 'org_B';

let client: PGlite;
let db: Db;
let store: PgContextStore;

beforeEach(async () => {
  client = new PGlite();
  db = drizzle(client, { schema }) as unknown as Db;
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  store = new PgContextStore(db);
});

afterEach(async () => {
  await client.close();
});

const hashOf = (body: string): string => createHash('sha256').update(body).digest('hex');

async function connect(repoFullName: string, org = ORG, defaultBranch = 'main'): Promise<void> {
  const now = new Date().toISOString();
  await db.insert(ghRepos).values({
    repoFullName,
    installationId: 1,
    workspaceOrgId: org,
    defaultBranch,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  });
}

interface SeedPage {
  url: string;
  path: string;
  title: string;
  body: string;
}

/** The old per-repository registry row, with its page bodies in the repo scope. */
async function seedRegistry(
  repoFullName: string,
  sources: { id: string; llmsTxtUrl: string; title: string; docs: SeedPage[] }[],
): Promise<void> {
  const pool = new ContentStore(db);
  for (const source of sources) {
    for (const doc of source.docs) await pool.putText(`spec:${repoFullName}`, doc.body);
  }
  await db.insert(specSources).values({
    repoKey: repoFullName,
    registry: {
      version: 1,
      sources: sources.map((source) => ({
        id: source.id,
        llmsTxtUrl: source.llmsTxtUrl,
        title: source.title,
        fetchedAt: '2026-09-01T10:00:00.000Z',
        docs: source.docs.map((doc) => ({
          url: doc.url,
          path: doc.path,
          title: doc.title,
          contentHash: hashOf(doc.body),
        })),
        skipped: [],
      })),
    },
    updatedAt: '2026-09-01T10:00:00.000Z',
  });
}

const STRAPI = {
  id: 'docs-strapi-io',
  llmsTxtUrl: 'https://docs.strapi.io/llms.txt',
  title: 'Strapi Docs',
  docs: [
    {
      url: 'https://docs.strapi.io/cms/installation',
      path: 'cms/installation.md',
      title: 'Installation',
      body: '# Installation\n\nInstall it.\n',
    },
  ],
};

describe('the Repository source of every connected repository', () => {
  it('is created, linked, and left never-synced', async () => {
    await connect('acme/api');
    const summary = await migrateWorkspaceContext(db);
    expect(summary.repositorySources).toBe(1);

    const sources = await store.listSources(ORG);
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({
      id: 'repo-acme-api',
      kind: 'repository',
      title: 'acme/api',
      status: 'never',
      lastSyncAt: null,
    });
    expect(sources[0]!.config).toMatchObject({
      repoFullName: 'acme/api',
      branch: 'main',
      include: ['docs/**', '**/*.md'],
    });
    expect(await store.bindings(ORG, 'acme/api')).toEqual(['repo-acme-api']);
  });

  it('marks the workspace stale, because it made links', async () => {
    await connect('acme/api');
    await migrateWorkspaceContext(db);
    expect(await store.changedAt(ORG)).not.toBeNull();
  });

  it('stays in its own workspace', async () => {
    await connect('acme/api', ORG);
    await connect('other/web', OTHER);
    await migrateWorkspaceContext(db);
    expect((await store.listSources(ORG)).map((s) => s.id)).toEqual(['repo-acme-api']);
    expect((await store.listSources(OTHER)).map((s) => s.id)).toEqual(['repo-other-web']);
  });
});

describe('the old per-repository llms.txt registries', () => {
  it('become workspace site sources, linked to the repository that registered them', async () => {
    await connect('acme/api');
    await seedRegistry('acme/api', [STRAPI]);

    const summary = await migrateWorkspaceContext(db);
    expect(summary.siteSources).toBe(1);
    expect(summary.documents).toBe(1);

    const site = (await store.listSources(ORG)).find((source) => source.kind === 'site')!;
    expect(site).toMatchObject({ title: 'Strapi Docs', status: 'synced' });
    expect(site.config).toEqual({ llmsTxtUrl: STRAPI.llmsTxtUrl });
    expect(site.lastSyncAt).not.toBeNull();
    expect(await store.reposForSource(ORG, site.id)).toEqual(['acme/api']);
  });

  it('carry their page bodies into the workspace scope, readable at once', async () => {
    await connect('acme/api');
    await seedRegistry('acme/api', [STRAPI]);
    await migrateWorkspaceContext(db);

    const site = (await store.listSources(ORG)).find((source) => source.kind === 'site')!;
    const docs = await store.listDocuments(ORG, site.id);
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      docId: STRAPI.docs[0]!.url,
      docPath: 'cms/installation.md',
      title: 'Installation',
      url: STRAPI.docs[0]!.url,
    });
    expect(await store.readBody(ORG, hashOf(STRAPI.docs[0]!.body))).toBe(STRAPI.docs[0]!.body);
  });

  it('dedupe by URL within a workspace, and link both repositories', async () => {
    await connect('acme/api');
    await connect('acme/web');
    await seedRegistry('acme/api', [STRAPI]);
    await seedRegistry('acme/web', [{ ...STRAPI, id: 'strapi' }]);

    const summary = await migrateWorkspaceContext(db);
    expect(summary.siteSources).toBe(1);

    const sites = (await store.listSources(ORG)).filter((source) => source.kind === 'site');
    expect(sites).toHaveLength(1);
    expect(await store.reposForSource(ORG, sites[0]!.id)).toEqual(['acme/api', 'acme/web']);
  });

  it('keep two different sites apart', async () => {
    await connect('acme/api');
    await seedRegistry('acme/api', [
      STRAPI,
      {
        id: 'docs-other-com',
        llmsTxtUrl: 'https://docs.other.com/llms.txt',
        title: 'Other',
        docs: [{ url: 'https://docs.other.com/a', path: 'a.md', title: 'A', body: '# A\n' }],
      },
    ]);
    await migrateWorkspaceContext(db);
    expect((await store.listSources(ORG)).filter((s) => s.kind === 'site')).toHaveLength(2);
  });

  it('skip a page whose body the old store never held', async () => {
    await connect('acme/api');
    await db.insert(specSources).values({
      repoKey: 'acme/api',
      registry: {
        version: 1,
        sources: [
          {
            id: 'ghost',
            llmsTxtUrl: 'https://ghost.example/llms.txt',
            title: 'Ghost',
            fetchedAt: '2026-09-01T10:00:00.000Z',
            docs: [
              { url: 'https://ghost.example/a', path: 'a.md', title: 'A', contentHash: hashOf('absent') },
            ],
            skipped: [],
          },
        ],
      },
      updatedAt: '2026-09-01T10:00:00.000Z',
    });
    const summary = await migrateWorkspaceContext(db);
    expect(summary.siteSources).toBe(1);
    expect(summary.documents).toBe(0);
    const site = (await store.listSources(ORG)).find((source) => source.kind === 'site')!;
    expect(await store.listDocuments(ORG, site.id)).toEqual([]);
  });

  it('does not fail the boot on an unreadable registry', async () => {
    await connect('acme/api');
    await db.insert(specSources).values({
      repoKey: 'acme/api',
      registry: { version: 9, nonsense: true },
      updatedAt: '2026-09-01T10:00:00.000Z',
    });
    const summary = await migrateWorkspaceContext(db);
    expect(summary.repositorySources).toBe(1);
    expect(summary.siteSources).toBe(0);
  });
});

describe('running it twice', () => {
  it('changes nothing the second time', async () => {
    await connect('acme/api');
    await seedRegistry('acme/api', [STRAPI]);
    const first = await migrateWorkspaceContext(db);
    const before = await store.listSources(ORG);

    const second = await migrateWorkspaceContext(db);
    expect(second).toEqual({ repositorySources: 0, siteSources: 0, documents: 0, bindings: 0 });
    expect(first.repositorySources).toBe(1);
    expect(await store.listSources(ORG)).toEqual(before);
    expect(await store.bindings(ORG, 'acme/api')).toEqual(before.map((s) => s.id).sort());
  });

  it('keeps a source whose patterns were edited since', async () => {
    await connect('acme/api');
    await migrateWorkspaceContext(db);
    await store.updateSource(ORG, 'repo-acme-api', {
      config: { repoFullName: 'acme/api', include: ['handbook/**'], exclude: [], branch: 'main' },
    });
    await migrateWorkspaceContext(db);
    expect((await store.getSource(ORG, 'repo-acme-api'))!.config).toMatchObject({
      include: ['handbook/**'],
    });
  });
});

describe('what it does not touch', () => {
  it('leaves the old registry row and its bodies in place', async () => {
    await connect('acme/api');
    await seedRegistry('acme/api', [STRAPI]);
    await migrateWorkspaceContext(db);

    const rows = await db.select().from(specSources).where(eq(specSources.repoKey, 'acme/api'));
    expect(rows).toHaveLength(1);
    const bodies = await db
      .select()
      .from(content)
      .where(eq(content.scope, 'spec:acme/api'));
    expect(bodies).toHaveLength(1);
  });

  it('leaves the staleness stamp alone on a second run', async () => {
    await connect('acme/api');
    await migrateWorkspaceContext(db);
    const first = await store.changedAt(ORG);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await migrateWorkspaceContext(db);
    expect(await store.changedAt(ORG)).toBe(first);
  });

  it('does nothing at all when no repository is connected', async () => {
    expect(await migrateWorkspaceContext(db)).toEqual({
      repositorySources: 0,
      siteSources: 0,
      documents: 0,
      bindings: 0,
    });
    expect(await db.select().from(contextWorkspaces)).toEqual([]);
  });
});
