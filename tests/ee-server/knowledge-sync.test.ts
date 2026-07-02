import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type EeDb } from '@truecourse/ee-db';

// The curate + contract generation are covered by their own tests; here we verify
// the sync engine's wiring: full-set curate+generate → ledger reconcile.
vi.mock('@truecourse/core/commands/spec-in-process', () => ({
  syncWorkspaceCorpusInProcess: vi
    .fn()
    .mockResolvedValue({ areaCount: 0, contractFileCount: 0, validationIssues: 0 }),
}));

import { syncWorkspaceCorpusInProcess } from '@truecourse/core/commands/spec-in-process';
import { PgKnowledgeStore } from '../../ee/packages/data-store/src/index';
import { syncWorkspaceKnowledge } from '../../ee/packages/server/src/knowledge/sync';
import type {
  DocRef,
  KnowledgeConnector,
} from '../../ee/packages/server/src/knowledge/connectors/types';

const ORG = 'org_A';

async function makeDb(client: PGlite): Promise<EeDb> {
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db as unknown as EeDb;
}

function fakeConnector(refs: DocRef[]): KnowledgeConnector {
  return {
    kind: 'confluence',
    name: 'Confluence',
    description: 'fake',
    fields: [{ key: 'apiToken', label: 'API token', type: 'password', secret: true }],
    test: async () => undefined,
    list: async () => refs,
    fetch: async (_cfg, id) => ({ title: `Page ${id}`, markdown: `# Page ${id}\n\nbody ${id}` }),
  };
}

const ref = (id: string, version: string): DocRef => ({
  id,
  title: `Page ${id}`,
  url: `https://acme.atlassian.net/wiki/pages/${id}`,
  version,
  updatedAt: '2026-01-01T00:00:00Z',
});

describe('syncWorkspaceKnowledge', () => {
  let client: PGlite;
  let knowledge: PgKnowledgeStore;

  beforeEach(async () => {
    client = new PGlite();
    knowledge = new PgKnowledgeStore(await makeDb(client));
    vi.mocked(syncWorkspaceCorpusInProcess).mockClear();
  });
  afterEach(async () => {
    await client.close();
  });

  it('consolidates the full set and records provenance per page', async () => {
    const result = await syncWorkspaceKnowledge(ORG, knowledge, fakeConnector([ref('101', '3'), ref('102', '1')]), {});
    expect(result.synced).toBe(2);

    // The driver got the FULL set, with namespaced, stable doc paths, and curates +
    // generates the workspace contract corpus in one pass.
    expect(vi.mocked(syncWorkspaceCorpusInProcess)).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceOrgId: ORG,
        docs: expect.arrayContaining([
          expect.objectContaining({ docPath: 'knowledge/confluence/101.md' }),
          expect.objectContaining({ docPath: 'knowledge/confluence/102.md' }),
        ]),
      }),
    );

    const docs = await knowledge.listDocuments(ORG);
    expect(docs.map((d) => d.externalId).sort()).toEqual(['101', '102']);
    const d101 = docs.find((d) => d.externalId === '101');
    expect(d101).toMatchObject({
      sourceKind: 'confluence',
      docPath: 'knowledge/confluence/101.md',
      version: '3',
      url: 'https://acme.atlassian.net/wiki/pages/101',
    });
    expect(d101?.contentHash).toBeTruthy(); // hash of the fetched body
  });

  it('prunes pages removed from the source, leaving OTHER sources intact', async () => {
    // A doc from a different source must survive the confluence reconcile.
    await knowledge.upsertDocument({
      workspaceOrgId: ORG,
      sourceKind: 'manual',
      externalId: 'm1',
      docPath: 'knowledge/manual/m1.md',
      title: 'Manual',
      url: null,
      version: null,
      contentHash: 'h',
    });

    await syncWorkspaceKnowledge(ORG, knowledge, fakeConnector([ref('101', '1'), ref('102', '1')]), {});
    // Re-sync with 102 removed.
    await syncWorkspaceKnowledge(ORG, knowledge, fakeConnector([ref('101', '2')]), {});

    const ids = (await knowledge.listDocuments(ORG))
      .map((d) => `${d.sourceKind}:${d.externalId}`)
      .sort();
    expect(ids).toEqual(['confluence:101', 'manual:m1']); // 102 pruned; manual untouched
  });
});
