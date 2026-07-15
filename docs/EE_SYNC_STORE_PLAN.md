# EE Sync stores documents — Sync pulls everything, Process pulls nothing

Status: **IMPLEMENTED.** Supersedes the "never store source
bodies / transient fetch" rule in docs/EE_JIRA_CONNECTOR_PLAN.md and
docs/EE_KNOWLEDGE_PAGE_PLAN.md wherever they conflict with this doc.
Decided 2026-07-14: storing source document content server-side is accepted —
the pipeline clarity and UX (Sources visible right after Sync) outweigh the
old mirroring concern. Applies to ALL connectors (Confluence + Jira alike —
the engine is connector-generic; no per-connector work).

## The model

- **Sync Now (per connector)** = the ONLY stage that talks to the source.
  Fetch every doc (list + fetchMany/fetch, unchanged), then PERSIST:
  - the body, content-addressed into the existing `content` table
    (scope = org, sha = the doc's contentHash — the hash the ledger already
    stores; bodies dedup by content automatically);
  - the ledger row (`knowledge_documents` upsert) — **the reconcile moves
    from Process to Sync**: upsert present docs, prune this source's removed
    rows. Sources therefore fills the moment a sync completes.
  - the pending record (delta + estimate), as today — delta is fetched-vs-
    ledger hashes read BEFORE the upsert. Toast unchanged (delta-only).
- **Process (workspace union)** = NO connector I/O. Load every ledger row
  (all source kinds) + their bodies from the content store →
  `WorkspaceDocInput[]` → the existing consolidate path (corpus, decisions
  injection, pendings cleared, scenario auto-chain). Union comes free: the
  ledger IS the union. Prune logic leaves Process entirely (Sync owns it).
- **Doc viewer** (`GET /spec/doc`) reads the stored body — the per-view
  connector re-fetch (and its 410-disconnected path) is deleted. Faster, and
  works for docs whose source was disconnected after sync.
- **Workspace guard generate** (`fetchWorkspaceGuardDocs`) reads stored
  bodies the same way — no connector I/O.

## Consequences / invariants

- Postgres now holds a mirror of synced doc content (org-scoped, in the same
  `content` table the corpus/contract blobs use). Deliberate reversal of the
  old governance stance — record it, don't hedge it.
- Estimates stay exact and cheap: sync has the bodies in hand (as before).
- A doc edited between Sync and Process is now consolidated AS SYNCED (the
  stored body), not as-live — consistent with "Sources shows what Sync
  pulled". Re-sync to refresh. (Previously Process silently consolidated
  newer content than the estimate priced; that inconsistency disappears.)
- Body GC: prune a ledger row → its body may be orphaned in `content`.
  v1: sweep-time GC — after reconcile, mark every contentHash any surviving
  ledger row of the org still references, then `ContentStore.gc(scope, live)`
  (the same mark-and-sweep the trace store uses). **Decision:** doc bodies live
  in their OWN content scope, `knowledge:ws:<org>` (`contentScope.knowledge`),
  not the corpus/contract `spec:ws:<org>` scope — so the GC is trivially
  independent (no corpus/contract blobs share the scope, nothing to exclude),
  honoring the content-store's "prefix by data TYPE so each type's GC stays
  independent" convention.
- Sync interrupted mid-persist: rows converge on the next sync (upserts are
  idempotent by content); no transactional envelope needed for v1.

## Files (implementing agent: read each before writing)

- `ee/packages/server/src/knowledge/sync.ts` — the sweep persists bodies +
  ledger + pending (rename/repurpose `estimateWorkspaceSync` honestly, e.g.
  `syncSource`); `processWorkspaceKnowledge` loads from the store instead of
  fetching (drop its `sources` fetch loop; keep `fetchSyncDocs` for the sweep).
- `ee/packages/server/src/knowledge/guard.ts` + `spec-routes.ts` doc GET —
  store reads replace connector fetches.
- `PgKnowledgeStore` (+ ContentStore) — body save/load helpers keyed by the
  ledger's contentHash; GC helper.
- `ee/packages/server/src/jobs/worker.ts` — sweep job persists (step labels:
  "Fetching documents" stays; "Checking for changes" stays — storing is part
  of fetching); processing job body drops the connector loop.
- Comments everywhere that say "transient / never stored" must be updated to
  describe current behavior (connector seam docs in
  `knowledge/connectors/types.ts`, sync.ts headers, plan-doc supersession
  notes in the two older plans).
- Client: Sources empty-state copy → "Connect a source and sync to see its
  documents here" (fills after SYNC now); no other client changes required.
- Tests: sweep persists ledger+bodies+pending and prunes per source; Process
  makes ZERO connector calls (stub connectors assert no fetch), consolidates
  the stored union, clears pendings, chains guard; doc GET serves stored
  bodies (no 410 path); estimate delta unchanged; GC (or documented orphan
  policy). Rework the existing knowledge-sync/estimate/pending/spec-route
  tests to the new semantics — do not weaken assertions.

## Explicitly unchanged

Two-button UX, pending/estimate confirm flow, workspace-visible job states,
union processing semantics, decisions/batching rules, scenario auto-chain,
the connector seam (`list`/`fetch`/`fetchMany` — still how SYNC talks to
sources), OSS local behavior.
