/**
 * The hosted sources store: a repo's registered web spec sources as one
 * registry row, the page bodies in the spec content scope by the hash the
 * registry names — a round trip, a body shared with the scan's snapshot stored
 * once, an empty write that clears the row, and the purge on disconnect.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq } from 'drizzle-orm';
import { schema, MIGRATIONS_DIR, content, specSources, type Db } from '@truecourse/db';
import { hashContent, type SourcesFile } from '../../packages/spec-consolidator/src/index.js';
import { PgSpecSourcesStore, PgSpecStore, purgeRepoData } from '../../packages/data-store/src/index';

const REPO = 'acme/api';
const INSTALL = '# Installation\n\nNode 20.\n';
const REST = '# REST\n\nEvery entry is a resource.\n';

const registry = (): SourcesFile => ({
  version: 1,
  sources: [
    {
      id: 'docs.strapi.io',
      llmsTxtUrl: 'https://docs.strapi.io/llms.txt',
      title: 'Strapi Docs',
      fetchedAt: '2026-07-29T10:15:00.000Z',
      docs: [
        { url: 'https://docs.strapi.io/cms/installation', path: 'cms/installation.md', title: 'Installation', contentHash: hashContent(INSTALL) },
        { url: 'https://docs.strapi.io/cms/api/rest', path: 'cms/api/rest.md', title: 'REST API', contentHash: hashContent(REST) },
      ],
      skipped: [],
    },
  ],
});

let client: PGlite;
let db: Db;
let store: PgSpecSourcesStore;

beforeEach(async () => {
  client = new PGlite();
  const d = drizzle(client, { schema });
  await migrate(d, { migrationsFolder: MIGRATIONS_DIR });
  db = d as unknown as Db;
  store = new PgSpecSourcesStore(db);
});
afterEach(async () => {
  await client.close();
});

const specObjects = async (): Promise<number> =>
  (await db.select({ sha: content.sha }).from(content).where(eq(content.scope, `spec:${REPO}`))).length;

describe('PgSpecSourcesStore', () => {
  it('reads an empty registry for a repo with nothing registered', async () => {
    expect(await store.readRegistry(REPO)).toEqual({ version: 1, sources: [] });
    expect(await store.readBody(REPO, hashContent(INSTALL))).toBeNull();
  });

  it('round-trips the registry and every page body by its content hash', async () => {
    await store.write(REPO, {
      registry: registry(),
      bodies: { [hashContent(INSTALL)]: INSTALL, [hashContent(REST)]: REST },
    });
    expect(await store.readRegistry(REPO)).toEqual(registry());
    expect(await store.readBody(REPO, hashContent(INSTALL))).toBe(INSTALL);
    expect(await store.readBody(REPO, hashContent(REST))).toBe(REST);
    expect(await store.readRegistry('other/repo')).toEqual({ version: 1, sources: [] });
    expect(await store.readBody('other/repo', hashContent(INSTALL))).toBeNull();
  });

  it('shares a body with the scan snapshot: the same page is one object', async () => {
    const spec = new PgSpecStore(db);
    await spec.saveSpecDocs({ repoKey: REPO, commitSha: 'shaA' }, { '.truecourse/specs/sources/docs.strapi.io/cms/installation.md': INSTALL });
    const before = await specObjects();
    await store.write(REPO, { registry: registry(), bodies: { [hashContent(INSTALL)]: INSTALL, [hashContent(REST)]: REST } });
    // Only the REST page is new to the pool.
    expect(await specObjects()).toBe(before + 1);
  });

  it('replaces the registry on a second write, and clears the row on an empty one', async () => {
    await store.write(REPO, { registry: registry(), bodies: { [hashContent(INSTALL)]: INSTALL } });
    const trimmed = registry();
    trimmed.sources[0]!.docs = trimmed.sources[0]!.docs.slice(0, 1);
    await store.write(REPO, { registry: trimmed, bodies: {} });
    expect((await store.readRegistry(REPO)).sources[0]!.docs).toHaveLength(1);

    await store.write(REPO, { registry: { version: 1, sources: [] }, bodies: {} });
    expect(await db.select().from(specSources).where(eq(specSources.repoKey, REPO))).toHaveLength(0);
    expect(await store.readRegistry(REPO)).toEqual({ version: 1, sources: [] });
  });

  it('stamps when the sources last changed, and no stamp once cleared', async () => {
    expect(await store.changedAt(REPO)).toBeNull();
    await store.write(REPO, { registry: registry(), bodies: { [hashContent(INSTALL)]: INSTALL } });
    const first = await store.changedAt(REPO);
    expect(first).not.toBeNull();
    expect(Number.isNaN(Date.parse(first!))).toBe(false);
    await store.write(REPO, { registry: { version: 1, sources: [] }, bodies: {} });
    expect(await store.changedAt(REPO)).toBeNull();
  });

  it('is purged with the repo', async () => {
    await store.write(REPO, { registry: registry(), bodies: { [hashContent(INSTALL)]: INSTALL } });
    await purgeRepoData(db, REPO);
    expect(await db.select().from(specSources).where(eq(specSources.repoKey, REPO))).toHaveLength(0);
    expect(await specObjects()).toBe(0);
  });
});
