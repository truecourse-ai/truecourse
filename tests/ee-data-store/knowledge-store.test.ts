import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type EeDb } from '@truecourse/ee-db';
import { PgKnowledgeStore } from '../../ee/packages/data-store/src/index';

const ORG_A = 'org_aaa';
const ORG_B = 'org_bbb';

async function makeDb(client: PGlite): Promise<EeDb> {
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db as unknown as EeDb;
}

function row(overrides: Partial<Parameters<PgKnowledgeStore['upsertDocument']>[0]> = {}) {
  return {
    workspaceOrgId: ORG_A,
    sourceKind: 'manual',
    externalId: 'doc-1',
    docPath: 'knowledge/manual/doc-1.md',
    title: 'Doc One',
    url: null,
    version: null,
    contentHash: 'hash-1',
    ...overrides,
  };
}

describe('PgKnowledgeStore — provenance ledger (pglite)', () => {
  let client: PGlite;
  let store: PgKnowledgeStore;

  beforeEach(async () => {
    client = new PGlite();
    store = new PgKnowledgeStore(await makeDb(client));
  });
  afterEach(async () => {
    await client.close();
  });

  it('lists empty for a fresh workspace', async () => {
    expect(await store.listDocuments(ORG_A)).toEqual([]);
  });

  it('inserts then updates the same (org, sourceKind, externalId) row', async () => {
    await store.upsertDocument(row({ title: 'First', contentHash: 'h1' }));
    await store.upsertDocument(row({ title: 'Renamed', contentHash: 'h2' }));
    const docs = await store.listDocuments(ORG_A);
    expect(docs).toHaveLength(1);
    expect(docs[0].title).toBe('Renamed');
    expect(docs[0].contentHash).toBe('h2');
    expect(docs[0].docPath).toBe('knowledge/manual/doc-1.md');
  });

  it('records connector provenance fields (url/version) and never a body', async () => {
    await store.upsertDocument(
      row({
        sourceKind: 'confluence',
        externalId: 'page-42',
        url: 'https://example.atlassian.net/wiki/page-42',
        version: '7',
        contentHash: 'h7',
      }),
    );
    const docs = await store.listDocuments(ORG_A);
    expect(docs[0]).toMatchObject({
      sourceKind: 'confluence',
      url: 'https://example.atlassian.net/wiki/page-42',
      version: '7',
    });
    // The shape carries identity + hash only — no body field exists.
    expect(Object.keys(docs[0]).sort()).toEqual(
      [
        'contentHash',
        'docPath',
        'externalId',
        'lastSyncedAt',
        'sourceKind',
        'title',
        'url',
        'version',
        'workspaceOrgId',
      ].sort(),
    );
  });

  it('isolates documents by workspace', async () => {
    await store.upsertDocument(row({ workspaceOrgId: ORG_A, externalId: 'a' }));
    await store.upsertDocument(row({ workspaceOrgId: ORG_B, externalId: 'b' }));
    expect((await store.listDocuments(ORG_A)).map((d) => d.externalId)).toEqual(['a']);
    expect((await store.listDocuments(ORG_B)).map((d) => d.externalId)).toEqual(['b']);
  });

  it('deletes one source doc (org-scoped)', async () => {
    await store.upsertDocument(row({ externalId: 'a' }));
    await store.upsertDocument(row({ externalId: 'b' }));
    await store.deleteDocument(ORG_A, 'manual', 'a');
    expect((await store.listDocuments(ORG_A)).map((d) => d.externalId)).toEqual(['b']);
  });
});
