/**
 * syncWorkspaceCorpusInProcess is CORPUS-ONLY: it curates the workspace docs and
 * persists the curated corpus under workspace scope — it never generates or stores
 * workspace `.tc` contracts (that path was removed; it crashed processing on the
 * guard-era store, which no longer backs workspace contracts).
 *
 * Two things are covered here:
 *  - Decisions injection: the union processing job loads the org's `decisions`
 *    artifact and passes it here; we materialize it as `decisions.json` in the
 *    scratch tree so curate reads it exactly as a repo does — a force-EXCLUDE
 *    drops its doc from the persisted corpus even when relevance would have kept it.
 *  - Corpus-only regression: `processWorkspaceKnowledge` runs end-to-end from the
 *    STORED union (bodies loaded from the content store, NO connector I/O) with NO
 *    contract store installed — the file default, whose `saveWorkspaceContracts`
 *    throws — and still succeeds, proving the corpus path never touches it. The
 *    ledger is seeded before (Sync's job), and Process leaves it untouched.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type Db, type DbHandle } from '@truecourse/db';
import { installEeStores } from '../../ee/packages/server/src/storage';
import { loadWorkspaceSpec, resetSpecStore } from '@truecourse/core/lib/spec-store';
import { resetContractStore } from '@truecourse/core/lib/contract-store';
import {
  syncWorkspaceCorpusInProcess,
  type CuratedCorpus,
} from '@truecourse/core/commands/spec-in-process';
import { resetKvCacheStore } from '@truecourse/llm';
import { setDefaultTransport } from '@truecourse/shared/llm';
import { PgKnowledgeStore } from '../../ee/packages/data-store/src/index';
import { processWorkspaceKnowledge } from '../../ee/packages/server/src/knowledge/sync';
import { docPathOf, outcome, stubDriver, type StubScript } from '../core/spec-scan-session-stub';

/**
 * The workspace corpus sync runs the SCAN SESSIONS. Called directly it
 * takes a `driver` seam; reached through `processWorkspaceKnowledge` it does
 * not, so the driver the run resolves is mocked at the module the built core
 * imports it from. Anything reaching it without a script fails loudly.
 */
let sessionScript: StubScript = () => {
  throw new Error('no session script installed for this case');
};
vi.mock('../../packages/core/dist/services/llm/session-driver.js', () => ({
  SESSION_MODEL_CLAUDE_CODE: 'opus',
  assertSessionBackendReady: async () => {},
  createConfiguredSessionDriver: () => {
    const { driver } = stubDriver((call) => sessionScript(call));
    return { driver, mode: 'claude-code', attribution: driver.attribution };
  },
}));

const ORG = 'org_ws_corpus';

// The ledger contentHash doubles as the body's content-address sha (`sha256-<hex>`).
const hashOf = (markdown: string): string => 'sha256-' + createHash('sha256').update(markdown).digest('hex');

// installEeStores needs a session pool for the advisory-lock seam; PGlite isn't
// one, and these tests never take the lock, so a no-op pool suffices.
const stubLockPool = {
  connect: async () => ({ query: async () => ({}), release: () => {} }),
} as unknown as DbHandle['lockPool'];

/** Seed the store the way Sync leaves it: the body content-addressed + a ledger row. */
async function seedStored(
  store: PgKnowledgeStore,
  kind: string,
  docs: Array<{ id: string; title: string; markdown: string }>,
): Promise<void> {
  for (const d of docs) {
    const contentHash = hashOf(d.markdown);
    await store.putDocBody(ORG, contentHash, d.markdown);
    await store.upsertDocument({
      workspaceOrgId: ORG,
      sourceKind: kind,
      externalId: d.id,
      docPath: `knowledge/${kind}/${d.id}.md`,
      title: d.title,
      url: null,
      version: null,
      contentHash,
    });
  }
}

let client: PGlite;
let db: Db;
let prevBlob: string | undefined;

beforeEach(async () => {
  client = new PGlite();
  db = drizzle(client, { schema }) as unknown as Db;
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  prevBlob = process.env.BLOB_STORE;
  process.env.BLOB_STORE = 'postgres';
  installEeStores({ db, lockPool: stubLockPool, close: async () => {} } as unknown as DbHandle);
  // installEeStores installs the spec store but NOT a contract store — it stays the
  // file default whose saveWorkspaceContracts throws. The corpus path must never
  // reach it. A throwing default transport guards against an accidental LLM call.
  setDefaultTransport(() => {
    throw new Error('no LLM in this test');
  });
});
afterEach(async () => {
  setDefaultTransport(undefined);
  resetSpecStore();
  resetContractStore();
  resetKvCacheStore();
  if (prevBlob === undefined) delete process.env.BLOB_STORE;
  else process.env.BLOB_STORE = prevBlob;
  await client.close();
});

describe('syncWorkspaceCorpusInProcess — decisions injection', () => {
  it('drops a force-excluded doc from the persisted corpus (even one relevance kept)', async () => {
    await syncWorkspaceCorpusInProcess({
      workspaceOrgId: ORG,
      docs: [
        { docPath: 'knowledge/jira/a.md', markdown: '# A\nAlpha requirement: the cart totals in cents.' },
        { docPath: 'knowledge/jira/b.md', markdown: '# B\nBeta noise: sprint retro notes.' },
      ],
      decisions: {
        version: 1,
        manualIncludes: [],
        // Force-exclude A — the doc relevance keeps below.
        manualExcludes: ['knowledge/jira/a.md'],
        manualAreas: [],
        conflictResolutions: [],
      },
      // Curation KEEPS A, DROPS B — so if the exclude is ignored, A survives. The
      // exclude leaves 0 kept docs, so no later session kind runs at all.
      driver: stubDriver((call) => {
        const p = docPathOf(call.briefing);
        return outcome(
          p.endsWith('a.md')
            ? {
                keep: true,
                reason: 'spec',
                subject: 'this-product',
                areas: [{ product: 'core', concern: 'cart' }],
                status: 'shipped',
              }
            : {
                keep: false,
                reason: 'noise',
                subject: 'this-product',
                category: 'scratch',
                areas: [],
                status: null,
              },
        );
      }).driver,
      disableOverlapDetection: true,
    });

    const corpus = await loadWorkspaceSpec<CuratedCorpus>({ workspaceOrgId: ORG }, 'corpus');
    expect(corpus).not.toBeNull();
    // A was relevance-kept but force-excluded → gone from the corpus, and NOT filed
    // under skippedDocs (that list only holds relevance drops).
    const keptRefs = corpus!.docs.map((d) => d.ref);
    expect(keptRefs).not.toContain('knowledge/jira/a.md');
    expect(corpus!.docs).toEqual([]);
    const skippedRefs = (corpus!.skippedDocs ?? []).map((s) => s.ref);
    expect(skippedRefs).toContain('knowledge/jira/b.md'); // relevance-dropped
    expect(skippedRefs).not.toContain('knowledge/jira/a.md'); // excluded, not skipped
  });
});

describe('processWorkspaceKnowledge — store-backed union (no contract store installed)', () => {
  it('consolidates from stored bodies with the throwing file contract store, leaving the ledger untouched', async () => {
    // One curate-doc session for the single kept doc; the settle gate stays shut
    // (one core concern) and overlap needs a pair, so nothing else runs. A kind
    // this script does not answer throws, which would fail the run loudly.
    sessionScript = (call) => {
      if (call.kind !== 'spec-scan.curate-doc') throw new Error(`unexpected session: ${call.kind}`);
      return outcome({
        keep: true,
        reason: 'spec',
        subject: 'this-product',
        areas: [{ product: 'core', concern: 'checkout' }],
        status: 'shipped',
      });
    };

    const knowledge = new PgKnowledgeStore(db);
    // Sync already ran: the body is content-addressed + the ledger row points at it.
    await seedStored(knowledge, 'jira', [
      { id: 'ISSUE-1', title: 'Checkout totals', markdown: '# Checkout\nThe cart total is computed in cents.' },
    ]);

    // Process reads ONLY the store — no connector arg, so nothing can fetch. Before
    // the corpus-only fix this threw `workspace-scoped contracts require the
    // enterprise store` (the removed contract-generate tail hit the file default).
    const result = await processWorkspaceKnowledge(ORG, knowledge);
    expect(result.synced).toBe(1);
    expect(result.bySource).toEqual({ jira: 1 });

    // The curated corpus persisted — one kept doc, built from the STORED body.
    const corpus = await loadWorkspaceSpec<CuratedCorpus>({ workspaceOrgId: ORG }, 'corpus');
    expect(corpus).not.toBeNull();
    expect(corpus!.docs.map((d) => d.ref)).toEqual(['knowledge/jira/ISSUE-1.md']);

    // Process leaves the (Sync-owned) ledger untouched.
    const rows = await knowledge.listDocuments(ORG);
    expect(rows.map((r) => `${r.sourceKind}:${r.externalId}`)).toEqual(['jira:ISSUE-1']);
  });
});
