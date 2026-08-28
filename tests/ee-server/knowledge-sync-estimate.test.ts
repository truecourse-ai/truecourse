import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type Db } from '@truecourse/db';

// Curate and the scan token estimator have their own tests; here we exercise the
// Sync stage's fetch+persist path, the store-backed union Process, and the Stage-1
// estimate wiring, so we stub the core boundary both call through. The scan
// estimator defaults to the empty (all-cached) estimate; individual tests override
// to shape stages/cost.
vi.mock('@truecourse/core/commands/spec-in-process', () => ({
  syncWorkspaceCorpusInProcess: vi.fn().mockResolvedValue({ areaCount: 0 }),
}));
vi.mock('@truecourse/core/services/llm/spec-estimate', () => ({
  estimateScanTokens: vi.fn().mockResolvedValue({ totalEstimatedTokens: 0, tiers: [], stages: [] }),
}));
vi.mock('@truecourse/core/services/llm/model-prices', () => ({
  getModelPrices: vi.fn().mockResolvedValue({ source: 'bundled', prices: {} }),
}));

import { estimateScanTokens } from '@truecourse/core/services/llm/spec-estimate';
import { syncWorkspaceCorpusInProcess } from '@truecourse/core/commands/spec-in-process';
import {
  setSpecStore,
  resetSpecStore,
  saveWorkspaceSpec,
} from '@truecourse/core/lib/spec-store';
import { PgKnowledgeStore, PgSpecStore } from '../../ee/packages/data-store/src/index';
import { pendingFromEstimate } from '../../ee/packages/server/src/jobs/worker';
import {
  syncSource,
  processWorkspaceKnowledge,
  connectorDocPath,
} from '../../ee/packages/server/src/knowledge/sync';
import type {
  DocContent,
  DocRef,
  KnowledgeConnector,
} from '../../ee/packages/server/src/knowledge/connectors/types';

const ORG = 'org_estimate';
const EMPTY = { totalEstimatedTokens: 0, tiers: [], stages: [] };

async function makeDb(client: PGlite): Promise<Db> {
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db as unknown as Db;
}

// The ledger's contentHash doubles as the body's content-address sha, so it uses
// the same `sha256-<hex>` form the content store does — mirror it here.
const hash = (markdown: string): string => 'sha256-' + createHash('sha256').update(markdown).digest('hex');
const bodyOf = (id: string, rev = 1): string =>
  `# ISSUE-${id}: Ticket ${id}\n\nAcceptance criteria revision ${rev}.`;

const ref = (id: string, updatedAt = '2026-01-01T00:00:00Z'): DocRef => ({
  id,
  title: `ISSUE-${id}: Ticket ${id}`,
  url: `https://acme.atlassian.net/browse/ISSUE-${id}`,
  version: updatedAt,
  updatedAt,
});

/** A batched connector (Jira-shaped): list + fetchMany, with a `fetch` that must
 *  not be reached on the batched path. Omit an id from `bodies` to model an issue
 *  deleted upstream mid-sweep (absent from the fetchMany map). */
function batchConnector(opts: {
  refs: DocRef[];
  bodies: Record<string, string>;
  batchLimit?: number;
}): KnowledgeConnector & { calls: { fetchMany: string[][]; fetch: string[] } } {
  const calls = { fetchMany: [] as string[][], fetch: [] as string[] };
  return {
    kind: 'jira',
    name: 'Jira',
    description: 'stub',
    fields: [{ key: 'apiToken', label: 'API token', type: 'password', secret: true }],
    fetchBatchLimit: opts.batchLimit ?? 100,
    test: async () => undefined,
    list: async () => opts.refs,
    fetch: async (_cfg, id) => {
      calls.fetch.push(id);
      return { title: `ISSUE-${id}`, markdown: opts.bodies[id] ?? bodyOf(id) };
    },
    fetchMany: async (_cfg, ids) => {
      calls.fetchMany.push(ids);
      const map = new Map<string, DocContent>();
      for (const id of ids) {
        const md = opts.bodies[id];
        if (md === undefined) continue; // deleted upstream mid-sweep
        map.set(id, { title: `ISSUE-${id}`, markdown: md });
      }
      return map;
    },
    calls,
  };
}

/** A per-doc connector (Confluence-shaped): no fetchMany, so the engine must fall
 *  back to the per-ref `fetch` loop. */
function plainConnector(opts: {
  refs: DocRef[];
  bodies?: Record<string, string>;
}): KnowledgeConnector & { calls: { fetch: string[] } } {
  const calls = { fetch: [] as string[] };
  return {
    kind: 'confluence',
    name: 'Confluence',
    description: 'stub',
    fields: [{ key: 'apiToken', label: 'API token', type: 'password', secret: true }],
    test: async () => undefined,
    list: async () => opts.refs,
    fetch: async (_cfg, id) => {
      calls.fetch.push(id);
      return { title: `Page ${id}`, markdown: opts.bodies?.[id] ?? bodyOf(id) };
    },
    calls,
  };
}

/** Pre-seed the ledger with rows that have been synced AND processed at their
 *  current content (the realistic prior-run baseline the sweep delta measures
 *  against — stamps `processedHash = contentHash`). */
async function seedLedger(
  store: PgKnowledgeStore,
  kind: string,
  rows: Array<{ externalId: string; markdown: string; version?: string }>,
): Promise<void> {
  for (const r of rows) {
    await store.upsertDocument({
      workspaceOrgId: ORG,
      sourceKind: kind,
      externalId: r.externalId,
      docPath: connectorDocPath(kind, r.externalId),
      title: `Doc ${r.externalId}`,
      url: null,
      version: r.version ?? null,
      contentHash: hash(r.markdown),
      lastSyncedAt: '2026-01-01T00:00:00Z',
    });
  }
  await store.markProcessed(
    ORG,
    rows.map((r) => ({ docPath: connectorDocPath(kind, r.externalId), processedHash: hash(r.markdown) })),
  );
}

/** Seed the store the way Sync leaves it: the body content-addressed + the ledger row. */
async function seedStored(
  store: PgKnowledgeStore,
  kind: string,
  docs: Array<{ id: string; markdown: string }>,
): Promise<void> {
  for (const d of docs) {
    const h = hash(d.markdown);
    await store.putDocBody(ORG, h, d.markdown);
    await store.upsertDocument({
      workspaceOrgId: ORG,
      sourceKind: kind,
      externalId: d.id,
      docPath: connectorDocPath(kind, d.id),
      title: `Doc ${d.id}`,
      url: null,
      version: null,
      contentHash: h,
    });
  }
}

const ids = async (store: PgKnowledgeStore): Promise<string[]> =>
  (await store.listDocuments(ORG)).map((d) => d.externalId).sort();

/** Persist a minimal workspace corpus whose kept docs are the given refs — the
 *  `removed` half of the delta diffs these against the fetched set. Requires the
 *  Postgres spec store to be installed (see the Stage-1 describe's beforeEach). */
async function seedCorpus(refs: string[]): Promise<void> {
  await saveWorkspaceSpec({ workspaceOrgId: ORG }, 'corpus', {
    version: 3,
    generatedAt: '2026-01-01T00:00:00Z',
    docs: refs.map((ref) => ({ ref, kind: 'spec', lastTouched: '2026-01-01T00:00:00Z', areaTags: [] })),
    areas: [],
    skippedDocs: [],
  });
}

describe('syncSource — fetch + persist bodies + reconcile the ledger', () => {
  let client: PGlite;
  let knowledge: PgKnowledgeStore;

  beforeEach(async () => {
    client = new PGlite();
    knowledge = new PgKnowledgeStore(await makeDb(client));
    vi.mocked(estimateScanTokens).mockReset().mockResolvedValue(EMPTY);
  });
  afterEach(async () => {
    await client.close();
  });

  it('batches through fetchMany, persisting every body + ledger row', async () => {
    const refs = ['1', '2', '3', '4', '5'].map((id) => ref(id));
    const bodies = Object.fromEntries(refs.map((r) => [r.id, bodyOf(r.id)]));
    const conn = batchConnector({ refs, bodies, batchLimit: 2 });

    const ticks: Array<[number, number]> = [];
    const est = await syncSource(ORG, knowledge, conn, {}, { onFetchProgress: (done, total) => void ticks.push([done, total]) });

    // 5 ids, limit 2 → one call per chunk [1,2] [3,4] [5]; the per-doc fetch is untouched.
    expect(conn.calls.fetchMany).toEqual([['1', '2'], ['3', '4'], ['5']]);
    expect(conn.calls.fetch).toEqual([]);
    // Fetch progress advances per chunk (cumulative).
    expect(ticks).toEqual([[2, 5], [4, 5], [5, 5]]);
    // Every issue landed in the ledger under its namespaced jira path…
    expect(await ids(knowledge)).toEqual(['1', '2', '3', '4', '5']);
    // …and every body is stored, keyed by its ledger contentHash.
    expect(await knowledge.getDocBody(ORG, hash(bodyOf('1')))).toBe(bodyOf('1'));
    expect(await knowledge.getDocBody(ORG, hash(bodyOf('5')))).toBe(bodyOf('5'));
    // A fresh ledger → every doc is new.
    expect(est.delta).toEqual({ new: 5, changed: 0, removed: 0, total: 5 });
  });

  it('falls back to per-doc fetch for a fetchMany-less connector (Confluence regression guard)', async () => {
    const refs = ['a', 'b', 'c'].map((id) => ref(id));
    const conn = plainConnector({ refs });

    const ticks: Array<[number, number]> = [];
    await syncSource(ORG, knowledge, conn, {}, { onFetchProgress: (done, total) => void ticks.push([done, total]) });

    expect(conn.calls.fetch).toEqual(['a', 'b', 'c']); // one fetch per ref
    expect(ticks).toEqual([[1, 3], [2, 3], [3, 3]]);
    expect(await ids(knowledge)).toEqual(['a', 'b', 'c']);
    expect(await knowledge.getDocBody(ORG, hash(bodyOf('a')))).toBe(bodyOf('a'));
  });

  it('prunes a ref absent from fetchMany’s result and GCs its orphaned body', async () => {
    const refs = ['1', '2', '3'].map((id) => ref(id));
    const all = Object.fromEntries(refs.map((r) => [r.id, bodyOf(r.id)]));
    await syncSource(ORG, knowledge, batchConnector({ refs, bodies: all }), {}, {});
    expect(await ids(knowledge)).toEqual(['1', '2', '3']);
    expect(await knowledge.getDocBody(ORG, hash(bodyOf('2')))).toBe(bodyOf('2'));

    // '2' is still LISTED but was deleted upstream mid-sweep → omitted from the map.
    const partial = { '1': bodyOf('1'), '3': bodyOf('3') };
    await syncSource(ORG, knowledge, batchConnector({ refs, bodies: partial }), {}, {});
    expect(await ids(knowledge)).toEqual(['1', '3']); // 2 pruned by the reconcile
    // …and 2's body is GC'd (no live ledger row references its hash).
    expect(await knowledge.getDocBody(ORG, hash(bodyOf('2')))).toBeNull();
    // The surviving docs' bodies stay.
    expect(await knowledge.getDocBody(ORG, hash(bodyOf('1')))).toBe(bodyOf('1'));
  });

  it('prunes only the synced source — another source’s ledger + bodies survive', async () => {
    await syncSource(ORG, knowledge, plainConnector({ refs: [ref('c1')], bodies: { c1: bodyOf('c1') } }), {}, {});
    await syncSource(ORG, knowledge, batchConnector({ refs: [ref('10'), ref('11')], bodies: { '10': bodyOf('10'), '11': bodyOf('11') } }), {}, {});

    // Jira dropped issue 11; Confluence untouched. Confluence's row must NOT be pruned.
    await syncSource(ORG, knowledge, batchConnector({ refs: [ref('10')], bodies: { '10': bodyOf('10') } }), {}, {});

    const rows = await knowledge.listDocuments(ORG);
    expect(rows.map((r) => `${r.sourceKind}:${r.externalId}`).sort()).toEqual(['confluence:c1', 'jira:10']);
    expect(await knowledge.getDocBody(ORG, hash(bodyOf('c1')))).toBe(bodyOf('c1'));
    expect(await knowledge.getDocBody(ORG, hash(bodyOf('11')))).toBeNull(); // pruned + GC'd
  });
});

describe('processWorkspaceKnowledge — union of every synced source (from the store)', () => {
  let client: PGlite;
  let knowledge: PgKnowledgeStore;

  beforeEach(async () => {
    client = new PGlite();
    knowledge = new PgKnowledgeStore(await makeDb(client));
    vi.mocked(estimateScanTokens).mockReset().mockResolvedValue(EMPTY);
    vi.mocked(syncWorkspaceCorpusInProcess).mockClear();
  });
  afterEach(async () => {
    await client.close();
  });

  it('consolidates BOTH sources’ stored docs in ONE corpus', async () => {
    await seedStored(knowledge, 'jira', [
      { id: '10', markdown: bodyOf('10') },
      { id: '11', markdown: bodyOf('11') },
    ]);
    await seedStored(knowledge, 'confluence', [{ id: 'c1', markdown: bodyOf('c1') }]);

    const result = await processWorkspaceKnowledge(ORG, knowledge);

    expect(result.synced).toBe(3);
    expect(result.bySource).toEqual({ jira: 2, confluence: 1 });
    // ONE consolidate call, over the UNION — both sources' namespaced docPaths.
    expect(vi.mocked(syncWorkspaceCorpusInProcess)).toHaveBeenCalledTimes(1);
    const passedDocs = vi.mocked(syncWorkspaceCorpusInProcess).mock.calls[0][0].docs.map((d) => d.docPath).sort();
    expect(passedDocs).toEqual([
      'knowledge/confluence/c1.md',
      'knowledge/jira/10.md',
      'knowledge/jira/11.md',
    ]);
    // The bodies it consolidated are the STORED ones.
    const passedBodies = vi.mocked(syncWorkspaceCorpusInProcess).mock.calls[0][0].docs.map((d) => d.markdown).sort();
    expect(passedBodies).toEqual([bodyOf('10'), bodyOf('11'), bodyOf('c1')].sort());
  });

  it('makes ZERO connector calls — Sync fetched, Process reads only the store', async () => {
    const jira = batchConnector({ refs: [ref('10'), ref('11')], bodies: { '10': bodyOf('10'), '11': bodyOf('11') } });
    // Sync pulls + persists (the only connector I/O).
    await syncSource(ORG, knowledge, jira, {}, {});
    const fetchManyAfterSync = jira.calls.fetchMany.length;

    await processWorkspaceKnowledge(ORG, knowledge);

    // Process touched the connector ZERO more times.
    expect(jira.calls.fetchMany.length).toBe(fetchManyAfterSync);
    expect(jira.calls.fetch).toEqual([]);
    expect(vi.mocked(syncWorkspaceCorpusInProcess).mock.calls[0][0].docs.map((d) => d.docPath).sort()).toEqual([
      'knowledge/jira/10.md',
      'knowledge/jira/11.md',
    ]);
  });

  it('forwards the workspace decisions to the consolidation', async () => {
    const decisions = {
      version: 1 as const,
      manualIncludes: [],
      manualExcludes: ['knowledge/jira/10.md'],
      manualAreas: [],
      conflictResolutions: [],
    };
    await seedStored(knowledge, 'jira', [{ id: '10', markdown: bodyOf('10') }]);
    await processWorkspaceKnowledge(ORG, knowledge, { decisions });
    expect(vi.mocked(syncWorkspaceCorpusInProcess).mock.calls[0][0].decisions).toEqual(decisions);
  });
});

describe('syncSource — Stage-1 cost estimate', () => {
  let client: PGlite;
  let knowledge: PgKnowledgeStore;

  beforeEach(async () => {
    client = new PGlite();
    const db = await makeDb(client);
    knowledge = new PgKnowledgeStore(db);
    // The delta's `removed` diffs the persisted workspace corpus against the fetched
    // set — install the Postgres spec store so `loadWorkspaceSpec` can read it.
    setSpecStore(new PgSpecStore(db));
    vi.mocked(estimateScanTokens).mockReset().mockResolvedValue(EMPTY);
  });
  afterEach(async () => {
    resetSpecStore();
    await client.close();
  });

  it('counts the delta by content hash — a bumped timestamp with unchanged content is not a change', async () => {
    const md1 = bodyOf('1', 1);
    const md2 = bodyOf('2', 1);
    await seedLedger(knowledge, 'jira', [
      { externalId: '1', markdown: md1, version: '2026-01-01T00:00:00Z' },
      { externalId: '2', markdown: md2, version: '2026-01-01T00:00:00Z' },
    ]);

    // Issue 1: updatedAt bumped (a status change), body identical → unchanged.
    // Issue 2: edited → changed. Issue 3: brand new.
    const refs = [ref('1', '2026-02-02T00:00:00Z'), ref('2', '2026-02-02T00:00:00Z'), ref('3', '2026-02-02T00:00:00Z')];
    const bodies = { '1': md1, '2': bodyOf('2', 2), '3': bodyOf('3', 1) };

    const est = await syncSource(ORG, knowledge, batchConnector({ refs, bodies }), {});
    expect(est.delta).toEqual({ new: 1, changed: 1, removed: 0, total: 3 });
    expect(est.subjectLabel).toBe('1 new · 1 changed of 3 docs');
  });

  it('reports zero LLM cost for a ledger-hash change whose content is cached (over-count guard)', async () => {
    // Ledger last synced issue 1 as content B; it has reverted to content A, which
    // the per-doc caches already know — so the cache-aware estimators report no work
    // even though the ledger hash differs.
    await seedLedger(knowledge, 'jira', [{ externalId: '1', markdown: bodyOf('1', 2) }]);
    const conn = batchConnector({ refs: [ref('1')], bodies: { '1': bodyOf('1', 1) } });

    const est = await syncSource(ORG, knowledge, conn, {});
    expect(est.delta).toEqual({ new: 0, changed: 1, removed: 0, total: 1 }); // hash differs from ledger
    expect(est.stages).toEqual([]); // ...but no LLM stage → zero cost
    expect(est.estimatedCostUsd).toBeUndefined();
  });

  it('reports zero LLM cost for a removed-only delta, but keeps the delta non-empty', async () => {
    const md1 = bodyOf('1');
    await seedLedger(knowledge, 'jira', [
      { externalId: '1', markdown: md1 },
      { externalId: '2', markdown: bodyOf('2') },
    ]);
    // Both were processed into the corpus; issue 2 is now deleted upstream. `removed`
    // is the corpus doc no longer present upstream (pending removal at next Process).
    await seedCorpus([connectorDocPath('jira', '1'), connectorDocPath('jira', '2')]);
    const conn = batchConnector({ refs: [ref('1')], bodies: { '1': md1 } });

    const est = await syncSource(ORG, knowledge, conn, {});
    expect(est.delta).toEqual({ new: 0, changed: 0, removed: 1, total: 1 });
    expect(est.stages).toEqual([]); // zero LLM cost → the client skips the modal, still runs Process
  });

  it('persists the fetched bodies + reconciles the ledger (delta is vs the processed marker)', async () => {
    await seedLedger(knowledge, 'jira', [{ externalId: '1', markdown: bodyOf('1'), version: 'v-orig' }]);

    // Issue 1 edited (processed before at bodyOf('1')), issue 2 brand new.
    const conn = batchConnector({
      refs: [ref('1', 'bumped'), ref('2', 'new')],
      bodies: { '1': bodyOf('1', 9), '2': bodyOf('2') },
    });
    const est = await syncSource(ORG, knowledge, conn, {});

    // Issue 1's body differs from what was processed → changed; issue 2 → new.
    expect(est.delta).toEqual({ new: 1, changed: 1, removed: 0, total: 2 });
    // …and the ledger + bodies now reflect the sweep.
    expect(await ids(knowledge)).toEqual(['1', '2']);
    expect(await knowledge.getDocBody(ORG, hash(bodyOf('1', 9)))).toBe(bodyOf('1', 9));
    expect(await knowledge.getDocBody(ORG, hash(bodyOf('2')))).toBe(bodyOf('2'));
    // The estimator still ran read-only against the scratch tree.
    expect(vi.mocked(estimateScanTokens)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(estimateScanTokens).mock.calls[0][2]).toBeUndefined();
  });

  it('marks the cost partial when the delta is non-empty (scenario generation is unpriced)', async () => {
    vi.mocked(estimateScanTokens).mockResolvedValueOnce({
      totalEstimatedTokens: 100,
      tiers: [],
      stages: [
        { stage: 'relevance', label: 'Filtering docs', model: 'haiku', calls: 1, estimatedTokens: 100, estimatedCostUsd: 0.01 },
      ],
      estimatedCostUsd: 0.01,
      costSource: 'bundled',
    });
    // A new doc auto-chains scenario (guard) generation after the scan, which the
    // estimate doesn't price — so the shown cost is a partial total, not a ceiling.
    const conn = batchConnector({ refs: [ref('1')], bodies: { '1': bodyOf('1') } });

    const est = await syncSource(ORG, knowledge, conn, {});
    expect(est.delta.new).toBe(1);
    expect(est.costPartial).toBe(true);
  });

  it('works against a fetchMany-less connector (per-doc sweep)', async () => {
    const conn = plainConnector({ refs: [ref('a'), ref('b')], bodies: { a: bodyOf('a'), b: bodyOf('b') } });

    const est = await syncSource(ORG, knowledge, conn, {});
    expect(conn.calls.fetch).toEqual(['a', 'b']); // fell back to the per-ref fetch loop
    expect(est.delta).toEqual({ new: 2, changed: 0, removed: 0, total: 2 });
  });

  it('prices only the scan stages — contract generation is no longer merged in', async () => {
    vi.mocked(estimateScanTokens).mockResolvedValueOnce({
      totalEstimatedTokens: 100,
      tiers: [],
      stages: [
        { stage: 'relevance', label: 'Filtering docs', model: 'haiku', calls: 3, estimatedTokens: 100, estimatedCostUsd: 0.01 },
      ],
      estimatedCostUsd: 0.01,
      costSource: 'bundled',
    });
    const conn = batchConnector({ refs: [ref('1')], bodies: { '1': bodyOf('1') } });

    const est = await syncSource(ORG, knowledge, conn, {});
    // Scan stages only — the estimate no longer folds in a contract-generate half.
    expect(est.stages?.map((s) => s.stage)).toEqual(['relevance']);
    expect(est.totalEstimatedTokens).toBe(100);
    expect(est.estimatedCostUsd).toBeCloseTo(0.01);
    expect(est.costSource).toBe('bundled');
    // A new doc → scenario generation follows unpriced → the cost is a partial total.
    expect(est.costPartial).toBe(true);
    expect(est.subjectLabel).toBe('1 new of 1 doc');
  });
});

describe('syncSource — delta measures synced-vs-PROCESSED (storage-pivot regression)', () => {
  let client: PGlite;
  let knowledge: PgKnowledgeStore;

  beforeEach(async () => {
    client = new PGlite();
    const db = await makeDb(client);
    knowledge = new PgKnowledgeStore(db);
    setSpecStore(new PgSpecStore(db));
    vi.mocked(estimateScanTokens).mockReset().mockResolvedValue(EMPTY);
    vi.mocked(syncWorkspaceCorpusInProcess).mockClear();
  });
  afterEach(async () => {
    resetSpecStore();
    await client.close();
  });

  const nineRefs = Array.from({ length: 9 }, (_, i) => ref(String(i + 1)));
  const nineBodies = Object.fromEntries(nineRefs.map((r) => [r.id, bodyOf(r.id)]));
  const sweep = () => syncSource(ORG, knowledge, batchConnector({ refs: nineRefs, bodies: nineBodies }), {});

  it('a second sweep of an unchanged-but-UNPROCESSED source keeps the Process work (the bug)', async () => {
    // Sweep #1: 9 tickets land in the ledger; none processed yet → all pending.
    const est1 = await sweep();
    expect(est1.delta).toEqual({ new: 9, changed: 0, removed: 0, total: 9 });
    expect(pendingFromEstimate(est1, 'Jira', 't1').pending).not.toBeNull();

    // Sweep #2: source unchanged and STILL nothing processed. Pre-fix the ledger
    // matched the fetch → empty delta → pending cleared → 9 docs stranded. Now the
    // delta is synced-vs-processed, so the 9 stay pending and Process is intact.
    const est2 = await sweep();
    expect(est2.delta).toEqual({ new: 9, changed: 0, removed: 0, total: 9 });
    expect(pendingFromEstimate(est2, 'Jira', 't2').pending).not.toBeNull();
  });

  it('Process stamps the processed marker on every consolidated doc', async () => {
    await sweep();
    // Pre-process: no doc carries a processed marker.
    expect((await knowledge.listDocuments(ORG)).every((r) => r.processedHash === null)).toBe(true);

    await processWorkspaceKnowledge(ORG, knowledge);

    // Post-process: every ledger row is stamped with the body it was consolidated at.
    for (const row of await knowledge.listDocuments(ORG)) {
      expect(row.processedHash).toBe(row.contentHash);
    }
  });

  it('process → re-sweep unchanged → up to date, clearing pending', async () => {
    await sweep();
    await processWorkspaceKnowledge(ORG, knowledge);

    const est = await sweep();
    expect(est.delta).toEqual({ new: 0, changed: 0, removed: 0, total: 9 });
    // Empty delta → the sweep clears the pending record ("up to date").
    expect(pendingFromEstimate(est, 'Jira', 't').pending).toBeNull();
  });

  it('detects a doc edited AFTER it was processed as changed (not new)', async () => {
    await syncSource(ORG, knowledge, batchConnector({ refs: [ref('1')], bodies: { '1': bodyOf('1', 1) } }), {});
    await processWorkspaceKnowledge(ORG, knowledge);

    // Ticket 1 edited upstream after processing → changed, not new, not up to date.
    const est = await syncSource(
      ORG,
      knowledge,
      batchConnector({ refs: [ref('1', 'bumped')], bodies: { '1': bodyOf('1', 2) } }),
      {},
    );
    expect(est.delta).toEqual({ new: 0, changed: 1, removed: 0, total: 1 });
  });

  it('keeps the estimate honest on a repeat sweep — unprocessed cold docs still price stages', async () => {
    // The estimator gates its stages on the relevance caches; unprocessed docs stay
    // cold, so a repeat sweep must still surface non-empty stages — the delta being
    // "9 new" and the priced work must agree. Simulate a cold cache with one stage.
    vi.mocked(estimateScanTokens).mockResolvedValue({
      totalEstimatedTokens: 100,
      tiers: [],
      stages: [
        { stage: 'relevance', label: 'Filtering docs', model: 'haiku', calls: 9, estimatedTokens: 100, estimatedCostUsd: 0.01 },
      ],
      estimatedCostUsd: 0.01,
      costSource: 'bundled',
    });
    await sweep();
    const est2 = await sweep();
    expect(est2.delta.new).toBe(9);
    expect(est2.stages?.length).toBeGreaterThan(0); // honest: still priced, not zeroed
  });
});
