/**
 * The Knowledge page's Spec-tab endpoints under /api/ee/knowledge: the corpus read
 * (kept docs + a skipped SUMMARY, decisions folded), the paginated skipped +
 * documents listings (scale — a project can carry thousands of tickets), the per-doc
 * read from the STORED body (no connector, 404 for an unknown ref), and the decision
 * writes (persist the artifact + best-effort re-process enqueue).
 */
import express, { type Express, type Request } from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, knowledgeDocuments, type Db } from '@truecourse/db';
import type { AuthUser } from '@truecourse/shared';
import { setSpecStore, resetSpecStore, saveWorkspaceSpec } from '@truecourse/core/lib/spec-store';
import { getWorkspaceDecisions } from '@truecourse/core/commands/spec-in-process';

// Control the LLM gate that decides whether a decision write enqueues a re-process.
const llmConfigured = vi.fn(() => true);
vi.mock('../../ee/packages/server/src/llm/index', async (importActual) => {
  const actual = await importActual<typeof import('../../ee/packages/server/src/llm/index')>();
  return { ...actual, isLlmConfigured: () => llmConfigured() };
});

// A stub connector with a fetch spy that must NEVER be reached — the doc route now
// reads the STORED body, never the connector.
const { fetchSpy } = vi.hoisted(() => ({
  fetchSpy: vi.fn(async (_cfg: unknown, id: string) => ({ title: `Doc ${id}`, markdown: `# Doc ${id}\nBody.` })),
}));
vi.mock('../../ee/packages/server/src/knowledge/connectors/registry', () => ({
  CONNECTORS: {
    confluence: {
      kind: 'confluence',
      name: 'Confluence',
      description: 'stub',
      fields: [{ key: 'apiToken', label: 'API token', type: 'password', secret: true }],
      test: async () => undefined,
      list: async () => [],
      fetch: fetchSpy,
    },
  },
}));

import { PgSpecStore, PgKnowledgeStore } from '../../ee/packages/data-store/src/index';
import { createKnowledgeRouter } from '../../ee/packages/server/src/knowledge/index';
import { JobStore } from '../../ee/packages/data-store/src/index';
import type { JobsApi } from '../../ee/packages/server/src/jobs/index';

const SECRET = 'master-secret-at-least-32-characters!!';
const ORG = 'org_spec';

function makeJobs(db: Db, enqueueSync = vi.fn(async () => {})): JobsApi {
  return {
    jobStore: new JobStore(db),
    enqueueSync,
    enqueueEstimate: vi.fn(async () => {}),
  } as unknown as JobsApi;
}

/** A minimal but structurally-real curated corpus: one kept area + N skipped docs. */
function corpusFixture(skippedCount: number) {
  return {
    version: 3 as const,
    generatedAt: '2026-02-02T00:00:00Z',
    docs: [
      { ref: 'knowledge/confluence/1.md', kind: 'spec', status: 'shipped', lastTouched: '2026-01-01T00:00:00Z', areaTags: ['core/checkout'] },
    ],
    areas: [
      { id: 'core/checkout', product: 'core', concern: 'checkout', docRefs: ['knowledge/confluence/1.md'], overlaps: [] },
    ],
    // Numbered bug tickets — the realistic Jira noise the relevance filter drops.
    skippedDocs: Array.from({ length: skippedCount }, (_, i) => ({
      ref: `knowledge/jira/${1000 + i}.md`,
      reason: i % 3 === 0 ? 'not a specification' : 'work-tracking ticket',
    })),
  };
}

describe('Knowledge spec routes', () => {
  let client: PGlite;
  let db: Db;
  let app: Express;
  let enqueueSync: ReturnType<typeof vi.fn>;

  async function seedLedger(
    rows: Array<{ kind: string; id: string; title?: string; url?: string | null; body?: string }>,
  ): Promise<void> {
    const now = '2026-02-02T00:00:00Z';
    await db.insert(knowledgeDocuments).values(
      rows.map((r) => ({
        workspaceOrgId: ORG,
        sourceKind: r.kind,
        externalId: r.id,
        docPath: `knowledge/${r.kind}/${r.id}.md`,
        title: r.title ?? `${r.kind} ${r.id}`,
        url: r.url ?? null,
        version: null,
        contentHash: `h-${r.id}`,
        lastSyncedAt: now,
        createdAt: now,
      })),
    );
    // Store the body under its (stubbed) contentHash the way Sync would, so the doc
    // GET can serve it from the content store.
    const knowledge = new PgKnowledgeStore(db);
    for (const r of rows) {
      if (r.body !== undefined) await knowledge.putDocBody(ORG, `h-${r.id}`, r.body);
    }
  }

  beforeEach(async () => {
    client = new PGlite();
    db = drizzle(client, { schema }) as unknown as Db;
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    setSpecStore(new PgSpecStore(db));
    llmConfigured.mockReturnValue(true);
    fetchSpy.mockClear();
    fetchSpy.mockImplementation(async (_cfg, id) => ({ title: `Doc ${id}`, markdown: `# Doc ${id}\nBody.` }));

    enqueueSync = vi.fn(async () => {});
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as Request & { eeUser?: AuthUser }).eeUser = { id: 'u1', email: 'u@acme.test', organizationId: ORG };
      next();
    });
    app.use('/api/ee/knowledge', createKnowledgeRouter(db, SECRET, makeJobs(db, enqueueSync)));
  });
  afterEach(async () => {
    resetSpecStore();
    await client.close();
  });

  // --- Corpus read ----------------------------------------------------------

  it('GET /spec/corpus → 404 before any corpus is processed', async () => {
    const res = await request(app).get('/api/ee/knowledge/spec/corpus');
    expect(res.status).toBe(404);
  });

  it('GET /spec/corpus returns kept docs + a skipped SUMMARY (no skipped array) + folded decisions', async () => {
    await saveWorkspaceSpec({ workspaceOrgId: ORG }, 'corpus', corpusFixture(1200));
    await saveWorkspaceSpec({ workspaceOrgId: ORG }, 'decisions', {
      version: 1,
      manualIncludes: ['knowledge/jira/1005.md'],
      manualExcludes: ['knowledge/confluence/1.md'],
      manualAreas: [],
      conflictResolutions: [
        { docA: 'a.md', anchorA: null, docB: 'b.md', anchorB: null, verdict: 'a', resolvedAt: '2026-02-02T00:00:00Z' },
      ],
    });

    const res = await request(app).get('/api/ee/knowledge/spec/corpus');
    expect(res.status).toBe(200);
    // The huge skipped array is stripped; only a summary rides the payload.
    expect(res.body.corpus.skippedDocs).toEqual([]);
    expect(res.body.corpus.areas).toHaveLength(1);
    expect(res.body.skipped.total).toBe(1200);
    // 400 of 1200 (every 3rd) are "not a specification"; most-common reason first.
    expect(res.body.skipped.byReason).toEqual([
      { reason: 'work-tracking ticket', count: 800 },
      { reason: 'not a specification', count: 400 },
    ]);
    // Decisions folded alongside the corpus so the client derives conflict state.
    expect(res.body.manualIncludes).toEqual(['knowledge/jira/1005.md']);
    expect(res.body.manualExcludes).toEqual(['knowledge/confluence/1.md']);
    expect(res.body.conflictResolutions).toHaveLength(1);
  });

  it('GET /spec/corpus enriches each kept doc ref with the ledger title + url', async () => {
    await saveWorkspaceSpec({ workspaceOrgId: ORG }, 'corpus', corpusFixture(0));
    await seedLedger([
      {
        kind: 'confluence',
        id: '1',
        title: 'ADR 0002 — Error response envelope',
        url: 'https://acme.atlassian.net/wiki/1',
      },
    ]);

    const res = await request(app).get('/api/ee/knowledge/spec/corpus');
    expect(res.status).toBe(200);
    const doc = res.body.corpus.docs.find((d: { ref: string }) => d.ref === 'knowledge/confluence/1.md');
    // Read-time display enrichment: the human title + deep link ride the corpus doc,
    // while the ref (the synthetic stable docPath / cache key) is untouched.
    expect(doc.ref).toBe('knowledge/confluence/1.md');
    expect(doc.title).toBe('ADR 0002 — Error response envelope');
    expect(doc.url).toBe('https://acme.atlassian.net/wiki/1');
  });

  it('GET /spec/corpus leaves title/url absent when the ref has no ledger row', async () => {
    // Corpus kept doc, but no matching ledger row (pruned since the corpus was built).
    await saveWorkspaceSpec({ workspaceOrgId: ORG }, 'corpus', corpusFixture(0));

    const res = await request(app).get('/api/ee/knowledge/spec/corpus');
    expect(res.status).toBe(200);
    const doc = res.body.corpus.docs.find((d: { ref: string }) => d.ref === 'knowledge/confluence/1.md');
    expect(doc.ref).toBe('knowledge/confluence/1.md');
    expect(doc).not.toHaveProperty('title');
    expect(doc).not.toHaveProperty('url');
  });

  // --- Skipped pagination ---------------------------------------------------

  it('GET /spec/skipped pages the skipped docs with query + reason filters', async () => {
    await saveWorkspaceSpec({ workspaceOrgId: ORG }, 'corpus', corpusFixture(1200));

    const first = await request(app).get('/api/ee/knowledge/spec/skipped?limit=50&offset=0');
    expect(first.status).toBe(200);
    expect(first.body.total).toBe(1200);
    expect(first.body.skipped).toHaveLength(50);
    expect(first.body.skipped[0]).toEqual({ ref: 'knowledge/jira/1000.md', reason: 'not a specification' });

    // A second page is disjoint.
    const second = await request(app).get('/api/ee/knowledge/spec/skipped?limit=50&offset=50');
    expect(second.body.skipped[0].ref).toBe('knowledge/jira/1050.md');

    // Reason filter narrows the total.
    const byReason = await request(app).get(
      `/api/ee/knowledge/spec/skipped?reason=${encodeURIComponent('not a specification')}&limit=10`,
    );
    expect(byReason.body.total).toBe(400);
    expect(byReason.body.skipped.every((s: { reason: string }) => s.reason === 'not a specification')).toBe(true);

    // Substring query on the ref.
    const byQuery = await request(app).get('/api/ee/knowledge/spec/skipped?query=1234&limit=10');
    expect(byQuery.body.total).toBe(1);
    expect(byQuery.body.skipped[0].ref).toBe('knowledge/jira/1234.md');
  });

  it('GET /spec/skipped caps the page size at 200', async () => {
    await saveWorkspaceSpec({ workspaceOrgId: ORG }, 'corpus', corpusFixture(1200));
    const res = await request(app).get('/api/ee/knowledge/spec/skipped?limit=100000');
    expect(res.body.skipped).toHaveLength(200);
  });

  it('GET /spec/skipped enriches matched refs with title + url; unmatched refs omit them', async () => {
    await saveWorkspaceSpec({ workspaceOrgId: ORG }, 'corpus', corpusFixture(3));
    // A ledger row for only the FIRST skipped ref — the other two were pruned.
    await seedLedger([
      { kind: 'jira', id: '1000', title: 'ENG-1000: flaky login test', url: 'https://acme.atlassian.net/browse/ENG-1000' },
    ]);

    const res = await request(app).get('/api/ee/knowledge/spec/skipped?limit=50&offset=0');
    expect(res.status).toBe(200);
    const matched = res.body.skipped.find((s: { ref: string }) => s.ref === 'knowledge/jira/1000.md');
    expect(matched).toMatchObject({
      ref: 'knowledge/jira/1000.md',
      reason: 'not a specification',
      title: 'ENG-1000: flaky login test',
      url: 'https://acme.atlassian.net/browse/ENG-1000',
    });
    // A skipped row with no ledger row keeps just ref + reason (client falls back to ref).
    const bare = res.body.skipped.find((s: { ref: string }) => s.ref === 'knowledge/jira/1001.md');
    expect(bare).toEqual({ ref: 'knowledge/jira/1001.md', reason: 'work-tracking ticket' });
  });

  // --- Documents pagination (Sources tab) -----------------------------------

  it('GET /documents pages the provenance ledger with query + kind filters, metadata only', async () => {
    await seedLedger(
      Array.from({ length: 1100 }, (_, i) => ({
        kind: i < 900 ? 'jira' : 'confluence',
        id: String(2000 + i),
        title: `TICKET-${2000 + i}: something`,
      })),
    );

    const page = await request(app).get('/api/ee/knowledge/documents?limit=25&offset=0');
    expect(page.status).toBe(200);
    expect(page.body.total).toBe(1100);
    expect(page.body.documents).toHaveLength(25);
    // Metadata only — no internal contentHash / workspaceOrgId leaks to the client.
    expect(page.body.documents[0]).not.toHaveProperty('contentHash');
    expect(page.body.documents[0]).not.toHaveProperty('workspaceOrgId');
    expect(page.body.documents[0]).toHaveProperty('docPath');

    // Kind filter.
    const jiraOnly = await request(app).get('/api/ee/knowledge/documents?kind=jira&limit=10');
    expect(jiraOnly.body.total).toBe(900);
    expect(jiraOnly.body.documents.every((d: { sourceKind: string }) => d.sourceKind === 'jira')).toBe(true);

    // Title substring query.
    const byQuery = await request(app).get('/api/ee/knowledge/documents?query=TICKET-2500&limit=10');
    expect(byQuery.body.total).toBe(1);
    expect(byQuery.body.documents[0].externalId).toBe('2500');
  });

  // --- Per-doc read from the stored body ------------------------------------

  it('GET /spec/doc serves the STORED body — never the connector', async () => {
    await seedLedger([{ kind: 'confluence', id: '1', body: '# Doc 1\nBody.' }]);

    const res = await request(app).get('/api/ee/knowledge/spec/doc?ref=knowledge/confluence/1.md');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ref: 'knowledge/confluence/1.md', content: '# Doc 1\nBody.' });
    // No connector re-fetch — the body came from the content store, and it works even
    // with no connection saved for the org.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('GET /spec/doc → 404 for an unknown ref', async () => {
    await seedLedger([{ kind: 'confluence', id: '1', body: '# Doc 1' }]);
    const missing = await request(app).get('/api/ee/knowledge/spec/doc?ref=knowledge/confluence/9.md');
    expect(missing.status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('GET /spec/doc → 404 when the ledger row exists but its body is not stored', async () => {
    await seedLedger([{ kind: 'confluence', id: '1' }]); // no body persisted
    const res = await request(app).get('/api/ee/knowledge/spec/doc?ref=knowledge/confluence/1.md');
    expect(res.status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // --- Decision writes ------------------------------------------------------

  it('POST /spec/excludes persists the decision + enqueues a re-process when no conflicts are open', async () => {
    await saveWorkspaceSpec({ workspaceOrgId: ORG }, 'corpus', corpusFixture(0)); // conflict-free
    const res = await request(app)
      .post('/api/ee/knowledge/spec/excludes')
      .send({ ref: 'knowledge/confluence/1.md' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ manualIncludes: [], manualExcludes: ['knowledge/confluence/1.md'] });
    // Persisted to the workspace decisions artifact.
    expect((await getWorkspaceDecisions(ORG)).manualExcludes).toEqual(['knowledge/confluence/1.md']);
    // ...and a re-process was enqueued (best-effort).
    expect(enqueueSync).toHaveBeenCalledTimes(1);
  });

  it('decision writes BATCH while conflicts are open — only the last verdict re-processes', async () => {
    // One open conflict in the corpus.
    const corpus = corpusFixture(0);
    corpus.areas[0].overlaps = [{ docs: ['knowledge/confluence/1.md', 'knowledge/jira/2.md'] }] as never;
    await saveWorkspaceSpec({ workspaceOrgId: ORG }, 'corpus', corpus);

    // An exclude on an unrelated doc while the conflict is open → persisted, NOT enqueued.
    const ex = await request(app).post('/api/ee/knowledge/spec/excludes').send({ ref: 'knowledge/jira/9.md' });
    expect(ex.status).toBe(200);
    expect(enqueueSync).not.toHaveBeenCalled();

    // Resolving the LAST open conflict → exactly one re-process.
    const res = await request(app).post('/api/ee/knowledge/spec/conflict-resolution').send({
      docA: 'knowledge/confluence/1.md',
      docB: 'knowledge/jira/2.md',
      verdict: 'a',
    });
    expect(res.status).toBe(200);
    expect(res.body.conflictResolutions).toHaveLength(1);
    expect(enqueueSync).toHaveBeenCalledTimes(1);
  });

  it('a decision write with NO corpus yet persists but does not enqueue', async () => {
    const res = await request(app).post('/api/ee/knowledge/spec/conflict-resolution').send({
      docA: 'knowledge/confluence/1.md',
      docB: 'knowledge/jira/2.md',
      verdict: 'a',
    });
    expect(res.status).toBe(200);
    expect(res.body.conflictResolutions[0]).toMatchObject({ docA: 'knowledge/confluence/1.md', verdict: 'a' });
    expect(enqueueSync).not.toHaveBeenCalled(); // the first process is user-dispatched
  });

  it('has no /spec/relations routes — the relation surface was retired', async () => {
    expect(
      (await request(app).post('/api/ee/knowledge/spec/relations').send({ type: 'replace', older: 'a', newer: 'b' })).status,
    ).toBe(404);
    expect(
      (await request(app).delete('/api/ee/knowledge/spec/relations').send({ older: 'a', newer: 'b' })).status,
    ).toBe(404);
  });

  it('a decision write still persists but does NOT enqueue when no LLM provider is configured', async () => {
    llmConfigured.mockReturnValue(false);
    const res = await request(app)
      .post('/api/ee/knowledge/spec/includes')
      .send({ ref: 'knowledge/jira/1005.md' });
    expect(res.status).toBe(200);
    expect((await getWorkspaceDecisions(ORG)).manualIncludes).toEqual(['knowledge/jira/1005.md']);
    expect(enqueueSync).not.toHaveBeenCalled(); // gated — the corpus GET folds it at read time
  });

  it('POST /spec/excludes → 400 without a ref; POST /spec/conflict-resolution → 400 on a bad verdict', async () => {
    expect((await request(app).post('/api/ee/knowledge/spec/excludes').send({})).status).toBe(400);
    const badVerdict = await request(app)
      .post('/api/ee/knowledge/spec/conflict-resolution')
      .send({ docA: 'a.md', docB: 'b.md', verdict: 'maybe' });
    expect(badVerdict.status).toBe(400);
  });
});
