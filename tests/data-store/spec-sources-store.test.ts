/**
 * The hosted sources store: a repo's registered web spec sources as one
 * registry row, the page bodies in the spec content scope by the hash the
 * registry names — a round trip, a body shared with the scan's snapshot stored
 * once, an empty registry that retains its removal timestamp, concurrent
 * writers rejecting stale edits, and the purge on disconnect.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq } from 'drizzle-orm';
import { schema, MIGRATIONS_DIR, content, specSources, type Db } from '@truecourse/db';
import { hashContent, type SourcesFile } from '../../packages/spec-consolidator/src/index.js';
import { PgSpecSourcesStore, PgSpecStore, purgeRepoData } from '../../packages/data-store/src/index';
import { setSpecSourcesStore, resetSpecSourcesStore, withSpecSourcesTree, SpecSourcesConflictError } from '@truecourse/core/lib/spec-sources';
import { seedSource } from '../spec-consolidator/sources-fixture';

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
  resetSpecSourcesStore();
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

  it('replaces the registry on a second write, and retains an empty registry on removal', async () => {
    await store.write(REPO, { registry: registry(), bodies: { [hashContent(INSTALL)]: INSTALL } });
    const trimmed = registry();
    trimmed.sources[0]!.docs = trimmed.sources[0]!.docs.slice(0, 1);
    await store.write(REPO, { registry: trimmed, bodies: {} });
    expect((await store.readRegistry(REPO)).sources[0]!.docs).toHaveLength(1);

    await store.write(REPO, { registry: { version: 1, sources: [] }, bodies: {} });
    expect(await db.select().from(specSources).where(eq(specSources.repoKey, REPO))).toHaveLength(1);
    expect(await store.readRegistry(REPO)).toEqual({ version: 1, sources: [] });
  });

  it('retains the change stamp after the last source is removed', async () => {
    expect(await store.changedAt(REPO)).toBeNull();
    await store.write(REPO, { registry: registry(), bodies: { [hashContent(INSTALL)]: INSTALL } });
    const first = await store.changedAt(REPO);
    expect(first).not.toBeNull();
    expect(Number.isNaN(Date.parse(first!))).toBe(false);
    await store.write(REPO, { registry: { version: 1, sources: [] }, bodies: {} });
    expect(await store.changedAt(REPO)).not.toBeNull();
  });

  it('rejects an overlapping add from another store instance without losing its source', async () => {
    setSpecSourcesStore(store);
    const other = new PgSpecSourcesStore(db);
    let release!: () => void;
    let entered!: () => void;
    const ready = new Promise<void>((r) => { entered = r; });
    const gate = new Promise<void>((r) => { release = r; });
    const pending = withSpecSourcesTree(REPO, async (dir) => {
      entered();
      await gate;
      seedSource(dir, { id: 'first' });
    });
    const rejected = expect(pending).rejects.toBeInstanceOf(SpecSourcesConflictError);
    await ready;
    await other.write(REPO, { registry: registry(), bodies: {} }, { version: 1, sources: [] });
    release();
    await rejected;
    expect(await store.readRegistry(REPO)).toEqual(registry());
  });

  it('rejects a refresh based on a registry removed by another writer', async () => {
    const before = registry();
    await store.write(REPO, { registry: before, bodies: {} });
    await new PgSpecSourcesStore(db).write(REPO, { registry: { version: 1, sources: [] }, bodies: {} }, before);
    await expect(store.write(REPO, { registry: before, bodies: {} }, before)).rejects.toBeInstanceOf(SpecSourcesConflictError);
    expect((await store.readRegistry(REPO)).sources).toEqual([]);
    // The next add may start from the retained empty registry.
    await store.write(REPO, { registry: before, bodies: {} }, { version: 1, sources: [] });
    expect(await store.readRegistry(REPO)).toEqual(before);
  });

  it('is purged with the repo', async () => {
    await store.write(REPO, { registry: registry(), bodies: { [hashContent(INSTALL)]: INSTALL } });
    await purgeRepoData(db, REPO);
    expect(await db.select().from(specSources).where(eq(specSources.repoKey, REPO))).toHaveLength(0);
    expect(await specObjects()).toBe(0);
  });
});
