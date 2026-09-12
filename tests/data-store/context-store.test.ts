/**
 * The workspace Context store on Postgres (PGlite + the real drizzle
 * migrations): the four `context_*` tables plus the content pool the document
 * bodies live in.
 *
 * What matters here is what the rest of the slice leans on — workspaces cannot
 * see each other, a body is stored once per workspace and read back by the hash
 * the ledger names, removing a source takes its documents, syncs and links with
 * it, a body nothing names any more is swept, and `changedAt` moves for every
 * mutation that makes the corpus stale (a sync that reconciled something, a
 * link made OR dropped, a source removed) and for nothing else.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { content, schema, MIGRATIONS_DIR, type Db } from '@truecourse/db';
import type { ContextSyncRecord } from '@truecourse/shared';
import { PgContextStore, listDueContextSources } from '../../packages/data-store/src/index';

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

const site = (id: string, llmsTxtUrl = `https://docs.example.com/${id}/llms.txt`) => ({
  id,
  kind: 'site' as const,
  title: id,
  config: { llmsTxtUrl },
});

const doc = (docId: string, body: string, over: Record<string, unknown> = {}) => ({
  docId,
  docPath: `${docId}.md`,
  title: docId,
  url: null,
  contentHash: hashOf(body),
  updatedAt: '2026-09-10T10:00:00.000Z',
  body,
  ...over,
});

/** Enough of a pause that two stamps from the wall clock differ. */
const wait = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5));

/** The engines hash bodies bare-hex; the pool keys them `sha256-<hex>`. */
function hashOf(body: string): string {
  return createHash('sha256').update(body).digest('hex');
}

describe('sources', () => {
  it('creates, reads, updates and lists a source', async () => {
    const created = await store.createSource(ORG, site('docs'));
    expect(created).toMatchObject({ id: 'docs', kind: 'site', status: 'never', lastSyncAt: null });

    const patched = await store.updateSource(ORG, 'docs', {
      status: 'failed',
      statusNote: 'HTTP 503',
    });
    expect(patched).toMatchObject({ status: 'failed', statusNote: 'HTTP 503' });
    expect(await store.getSource(ORG, 'docs')).toMatchObject({ status: 'failed' });
    expect(await store.listSources(ORG)).toHaveLength(1);
  });

  it('leaves a field the patch does not name alone', async () => {
    await store.createSource(ORG, site('docs'));
    await store.updateSource(ORG, 'docs', { status: 'synced', lastSyncAt: '2026-09-10T10:00:00Z' });
    const after = await store.updateSource(ORG, 'docs', { title: 'Docs' });
    expect(after).toMatchObject({ title: 'Docs', status: 'synced' });
    expect(after!.lastSyncAt).not.toBeNull();
  });

  it('answers null for a source another workspace owns', async () => {
    await store.createSource(ORG, site('docs'));
    expect(await store.getSource(OTHER, 'docs')).toBeNull();
    expect(await store.listSources(OTHER)).toEqual([]);
    expect(await store.updateSource(OTHER, 'docs', { title: 'nope' })).toBeNull();
  });

  it('lets two workspaces hold the same source id independently', async () => {
    await store.createSource(ORG, site('docs'));
    await store.createSource(OTHER, site('docs'));
    await store.updateSource(ORG, 'docs', { title: 'A docs' });
    expect((await store.getSource(OTHER, 'docs'))!.title).toBe('docs');
  });
});

describe('documents and bodies', () => {
  beforeEach(async () => {
    await store.createSource(ORG, site('docs'));
  });

  it('writes the ledger and stores each body under its hash', async () => {
    await store.writeDocuments(ORG, 'docs', {
      documents: [doc('a', 'A body'), doc('b', 'B body')],
      removed: [],
    });
    const rows = await store.listDocuments(ORG, 'docs');
    expect(rows.map((row) => row.docId)).toEqual(['a', 'b']);
    expect(await store.readBody(ORG, hashOf('A body'))).toBe('A body');
  });

  it('stores one body for two documents with identical content', async () => {
    await store.writeDocuments(ORG, 'docs', {
      documents: [doc('a', 'same'), doc('b', 'same')],
      removed: [],
    });
    const bodies = await db
      .select()
      .from(content)
      .where(eq(content.scope, `context:ws:${ORG}`));
    expect(bodies).toHaveLength(1);
  });

  it('never reads another workspace body', async () => {
    await store.writeDocuments(ORG, 'docs', { documents: [doc('a', 'A body')], removed: [] });
    expect(await store.readBody(OTHER, hashOf('A body'))).toBeNull();
  });

  it('removes the rows a sync no longer yields, and sweeps their bodies', async () => {
    await store.writeDocuments(ORG, 'docs', {
      documents: [doc('a', 'A body'), doc('b', 'B body')],
      removed: [],
    });
    await store.writeDocuments(ORG, 'docs', { documents: [doc('a', 'A body')], removed: ['b'] });
    expect((await store.listDocuments(ORG, 'docs')).map((row) => row.docId)).toEqual(['a']);
    expect(await store.readBody(ORG, hashOf('B body'))).toBeNull();
    expect(await store.readBody(ORG, hashOf('A body'))).toBe('A body');
  });

  it('keeps a body a second source still names', async () => {
    await store.createSource(ORG, site('other'));
    await store.writeDocuments(ORG, 'docs', { documents: [doc('a', 'shared')], removed: [] });
    await store.writeDocuments(ORG, 'other', { documents: [doc('x', 'shared')], removed: [] });
    await store.writeDocuments(ORG, 'docs', { documents: [], removed: ['a'] });
    expect(await store.readBody(ORG, hashOf('shared'))).toBe('shared');
  });

  it('overwrites a document in place when its content changed', async () => {
    await store.writeDocuments(ORG, 'docs', { documents: [doc('a', 'v1')], removed: [] });
    await store.writeDocuments(ORG, 'docs', {
      documents: [doc('a', 'v2', { title: 'A2', updatedAt: '2026-09-11T10:00:00.000Z' })],
      removed: [],
    });
    const rows = await store.listDocuments(ORG, 'docs');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: 'A2', contentHash: hashOf('v2') });
    expect(await store.readBody(ORG, hashOf('v1'))).toBeNull();
  });

  it('lists the whole workspace when no source is named', async () => {
    await store.createSource(ORG, site('other'));
    await store.writeDocuments(ORG, 'docs', { documents: [doc('a', 'A')], removed: [] });
    await store.writeDocuments(ORG, 'other', { documents: [doc('x', 'X')], removed: [] });
    expect(await store.listDocuments(ORG)).toHaveLength(2);
  });
});

describe('syncs', () => {
  beforeEach(async () => {
    await store.createSource(ORG, site('docs'));
  });

  it('records a sync and reads it back, newest first', async () => {
    await store.recordSync(ORG, {
      sourceId: 'docs',
      at: '2026-09-10T10:00:00.000Z',
      parentAt: null,
      added: 3,
      changed: 0,
      removed: 0,
      unchanged: 0,
    });
    await store.recordSync(ORG, {
      sourceId: 'docs',
      at: '2026-09-11T10:00:00.000Z',
      parentAt: '2026-09-10T10:00:00.000Z',
      added: 0,
      changed: 1,
      removed: 0,
      unchanged: 2,
    });
    const rows = await store.listSyncs(ORG, 'docs');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ changed: 1, unchanged: 2 });
    expect(rows[0]!.parentAt).not.toBeNull();
  });
});

describe('bindings', () => {
  beforeEach(async () => {
    await store.createSource(ORG, site('docs'));
    await store.createSource(ORG, site('other'));
  });

  it('replaces the set a repository reads', async () => {
    await store.setBindings(ORG, 'acme/api', ['docs', 'other']);
    expect(await store.bindings(ORG, 'acme/api')).toEqual(['docs', 'other']);
    await store.setBindings(ORG, 'acme/api', ['other']);
    expect(await store.bindings(ORG, 'acme/api')).toEqual(['other']);
  });

  it('names every repository that reads a source', async () => {
    await store.setBindings(ORG, 'acme/api', ['docs']);
    await store.setBindings(ORG, 'acme/web', ['docs']);
    expect(await store.reposForSource(ORG, 'docs')).toEqual(['acme/api', 'acme/web']);
  });

  it('keeps workspaces apart', async () => {
    await store.setBindings(ORG, 'acme/api', ['docs']);
    expect(await store.bindings(OTHER, 'acme/api')).toEqual([]);
  });
});

describe('removing a source', () => {
  it('takes its documents, syncs, links and bodies with it', async () => {
    await store.createSource(ORG, site('docs'));
    await store.writeDocuments(ORG, 'docs', { documents: [doc('a', 'A')], removed: [] });
    await store.recordSync(ORG, {
      sourceId: 'docs',
      at: '2026-09-10T10:00:00.000Z',
      parentAt: null,
      added: 1,
      changed: 0,
      removed: 0,
      unchanged: 0,
    });
    await store.setBindings(ORG, 'acme/api', ['docs']);

    await store.removeSource(ORG, 'docs');

    expect(await store.getSource(ORG, 'docs')).toBeNull();
    expect(await store.listDocuments(ORG, 'docs')).toEqual([]);
    expect(await store.listSyncs(ORG, 'docs')).toEqual([]);
    expect(await store.bindings(ORG, 'acme/api')).toEqual([]);
    expect(await store.readBody(ORG, hashOf('A'))).toBeNull();
  });
});

describe('changedAt', () => {
  beforeEach(async () => {
    await store.createSource(ORG, site('docs'));
    await store.createSource(ORG, site('other'));
  });

  const sync = (over: Partial<ContextSyncRecord> = {}): ContextSyncRecord => ({
    sourceId: 'docs',
    at: '2026-09-10T10:00:00.000Z',
    parentAt: null,
    added: 0,
    changed: 0,
    removed: 0,
    unchanged: 0,
    ...over,
  });

  it('is null before anything happened', async () => {
    expect(await store.changedAt(ORG)).toBeNull();
  });

  it('ignores a sync that reconciled nothing', async () => {
    await store.recordSync(ORG, sync({ unchanged: 7 }));
    expect(await store.changedAt(ORG)).toBeNull();
  });

  it('moves for a sync that added, changed or removed something', async () => {
    await store.recordSync(ORG, sync({ added: 1 }));
    expect(await store.changedAt(ORG)).toBe('2026-09-10T10:00:00.000Z');
  });

  it('moves when a repository LINKS a source', async () => {
    await store.setBindings(ORG, 'acme/api', ['docs']);
    expect(await store.changedAt(ORG)).not.toBeNull();
  });

  it('moves when a repository UNLINKS a source', async () => {
    await store.setBindings(ORG, 'acme/api', ['docs', 'other']);
    const linked = await store.changedAt(ORG);
    await wait();
    await store.setBindings(ORG, 'acme/api', ['docs']);
    const unlinked = await store.changedAt(ORG);
    expect(unlinked).not.toBe(linked);
    expect(unlinked! > linked!).toBe(true);
  });

  it('moves when a repository drops its last link', async () => {
    await store.setBindings(ORG, 'acme/api', ['docs']);
    const linked = await store.changedAt(ORG);
    await wait();
    await store.setBindings(ORG, 'acme/api', []);
    expect((await store.changedAt(ORG))! > linked!).toBe(true);
  });

  it('moves when a source is REMOVED', async () => {
    await store.setBindings(ORG, 'acme/api', ['docs']);
    const linked = await store.changedAt(ORG);
    await wait();
    await store.removeSource(ORG, 'docs');
    expect((await store.changedAt(ORG))! > linked!).toBe(true);
  });

  it('does not move for removing a source that was never there', async () => {
    await store.setBindings(ORG, 'acme/api', ['docs']);
    const linked = await store.changedAt(ORG);
    await wait();
    await store.removeSource(ORG, 'ghost');
    expect(await store.changedAt(ORG)).toBe(linked);
  });

  it('does not move for re-saving an identical link set', async () => {
    await store.setBindings(ORG, 'acme/api', ['docs']);
    const first = await store.changedAt(ORG);
    expect(first).not.toBeNull();
    await wait();
    await store.setBindings(ORG, 'acme/api', ['docs']);
    expect(await store.changedAt(ORG)).toBe(first);
  });

  it('does not move for a source being ADDED — nothing reads it yet', async () => {
    await store.createSource(ORG, site('third'));
    expect(await store.changedAt(ORG)).toBeNull();
  });

  it('never moves backwards', async () => {
    await store.recordSync(ORG, sync({ at: '2026-09-20T10:00:00.000Z', added: 1 }));
    await store.recordSync(ORG, sync({ at: '2026-09-10T10:00:00.000Z', added: 1 }));
    expect(await store.changedAt(ORG)).toBe('2026-09-20T10:00:00.000Z');
  });

  it('belongs to the asking workspace alone', async () => {
    await store.setBindings(ORG, 'acme/api', ['docs']);
    expect(await store.changedAt(OTHER)).toBeNull();
  });
});

describe('the sweep query', () => {
  /** A repository source of the given id, with `owner/repo` as its title. */
  const repository = (id: string, repoFullName: string) => ({
    id,
    kind: 'repository' as const,
    title: repoFullName,
    config: { repoFullName, installationId: 11, include: [], exclude: [], branch: 'main' },
  });

  it('names every workspace site that is older than the age given', async () => {
    await store.createSource(ORG, site('fresh'));
    await store.createSource(ORG, site('stale'));
    await store.createSource(OTHER, site('other-stale'));
    await store.updateSource(ORG, 'fresh', { lastSyncAt: '2026-09-10T10:00:00.000Z' });
    await store.updateSource(ORG, 'stale', { lastSyncAt: '2026-09-01T10:00:00.000Z' });
    await store.updateSource(OTHER, 'other-stale', { lastSyncAt: '2026-09-01T10:00:00.000Z' });

    expect(await listDueContextSources(db, '2026-09-09T10:00:00.000Z')).toEqual([
      { workspaceOrgId: ORG, sourceId: 'stale' },
      { workspaceOrgId: OTHER, sourceId: 'other-stale' },
    ]);
  });

  it('names a source of ANY kind that has never synced', async () => {
    await store.createSource(ORG, repository('repo-acme-api', 'acme/api'));
    await store.createSource(ORG, site('never-site'));

    expect(await listDueContextSources(db, '2026-09-09T10:00:00.000Z')).toEqual([
      { workspaceOrgId: ORG, sourceId: 'never-site' },
      { workspaceOrgId: ORG, sourceId: 'repo-acme-api' },
    ]);
  });

  it('leaves a repository source alone once it has synced — its push refreshes it', async () => {
    await store.createSource(ORG, repository('repo-acme-api', 'acme/api'));
    await store.updateSource(ORG, 'repo-acme-api', { lastSyncAt: '2026-01-01T10:00:00.000Z' });

    expect(await listDueContextSources(db, '2026-09-09T10:00:00.000Z')).toEqual([]);
  });

  it('skips a paused source, of either kind, however long it has waited', async () => {
    await store.createSource(ORG, site('paused'));
    await store.updateSource(ORG, 'paused', { status: 'paused' });
    await store.createSource(ORG, repository('repo-paused', 'acme/web'));
    await store.updateSource(ORG, 'repo-paused', { status: 'paused' });

    expect(await listDueContextSources(db, '2026-09-09T10:00:00.000Z')).toEqual([]);
  });
});
