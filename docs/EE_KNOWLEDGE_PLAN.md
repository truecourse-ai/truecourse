# EE Knowledge — workspace specs/contracts from external tools

Status: **Phases 1–2 IMPLEMENTED** (storage + full conflict resolution +
Confluence connector + Settings→Integrations). **Phase 3 IMPLEMENTED** —
workspace contracts generate on sync (+ auto-regen on every workspace decision);
the gate verifies a repo's EFFECTIVE contracts (workspace ∪ repo, repo wins by
`${kind}:${identity}`, incl. the cross-repo ripple); and the repo Spec + Contracts
tabs show the merged set with a workspace/repo provenance badge. **Phase 4
(repo-level additions) was delivered as part of Phase 3** (the repo's own
spec/contracts ARE the repo layer in every merge). Only **Phase 5 (more
connectors)** remains.

## Architecture principle (HARD RULE)

**OSS uses files, EE uses Postgres — and EE uses NO local files at all, not even
transient.** The same engine and the same UI components serve both; only the
storage adapter behind the seam differs, with a few capability-based exceptions
(a hidden button here and there).

- EE workspace scans run **fully in memory**: connector page bodies live in RAM
  (`DocCandidate.content`), the consolidator's `docSource`/`decisions` are
  injected — no temp dir, no disk.
- **Every** cache goes through the `@truecourse/llm` KV seam → Postgres in EE,
  file in OSS. The 5 LLM-stage caches (relevance, chain-detect, chain-recheck,
  conflict-explain/resolve) were migrated off bespoke `fs` files onto the seam so
  unchanged content → cache hit → **0 LLM cost on re-sync**.
- OSS is unaffected: the in-memory hooks are optional; absent → it reads real
  repo files from disk exactly as before.

## Phase 2 — what shipped (Confluence connector)

- `KnowledgeConnector{list,fetch}` interface + a generic sync engine
  (`syncWorkspaceKnowledge`): `list()` the space → `fetch()` every page
  transiently (RAM) → re-consolidate the FULL set via the in-memory
  `scanWorkspaceInProcess` → reconcile the provenance ledger (per source kind).
- `ConfluenceConnector` (Confluence Cloud REST, Basic auth) + a deterministic
  storage-XHTML→markdown converter (headings preserved for cache stability).
- **Connector-generic by design** — `KnowledgeConnector` carries `name`/
  `description`/`fields[]` metadata + `test()`; `integration_connections` stores
  `config` (jsonb, non-secret values) + the one encrypted secret. Adding a
  connector touches no columns/routes/UI.
- **Settings → Integrations** — a connector **list**; each "Configure" opens the
  **shared `Drawer`** (the *same* component used to connect a repository) with a
  field-metadata-driven form + a **Test** button + Save / Sync now / Disconnect.
  Tokens are AES-256-GCM (via `TRUECOURSE_SECRET_KEY`), never returned to the
  client. The manual copy-paste upload was removed (connectors are the source).

## Phase 1 — what shipped

- **Storage seam** — workspace Knowledge is a new scope key (`workspaceOrgId`) on
  the existing `SpecStore`: `WorkspaceRef` + `saveWorkspaceSpec`/`loadWorkspaceSpec`
  (file impl throws/empty → OSS unaffected; `PgSpecStore` keys `workspace_spec_sets`
  by org). New `workspace_spec_sets` + `knowledge_documents` tables (migration `0002`).
- **Same engine** — manual upload runs the **unchanged** `consolidate()` against a
  **transient** scratch dir (the only place a body lands; deleted in `finally`).
  Bodies are never stored. The Postgres block-extraction cache gives free
  incremental sync.
- **Full resolve without bodies** — the raw claims + version chains are persisted
  as derived artifacts, so a decision re-runs the deterministic merge
  (`remerge()` in the consolidator) from stored state — no docs, no LLM. This is
  the workspace equivalent of the repo's "re-scan from files." `upsert` /
  `acceptAllDefaults` / `revoke` / `markSuperseded` / `includeDoc` all go through it;
  the repo + workspace decision writes share the same pure mutators.
- **Same UI** — `SpecProvider` was generalized from a `repoId` to a pluggable
  `SpecDataSource` (repo source → `/api/repos/:id/spec/*`; workspace source →
  `/api/ee/knowledge/*`). The enterprise **Knowledge** page reuses the real OSS
  `SpecPanel`/`SpecConflictDetail`/`SpecCanonicalFile`/`DecisionsPanel`/
  `ContractsPanel` unchanged; the only exception is the hidden on-demand "Scan"
  button (`supportsRescan: false` — you re-upload to re-process).

Original simplified design follows.

## Context

Enterprise business-logic truth usually lives in **Confluence/Jira** (owned by
product/BAs), not in each repo — and one domain is implemented by **many repos**.
So in EE, specs/contracts become a **workspace-level Knowledge** generated from
connected tools and shared by every repo; a repo may add **its own spec** (and
eventually its own contracts) on top.

This intentionally drops the heavier ideas discussed (KB versioning, multiple
KBs, per-module scoping) — see Deferred. One workspace Knowledge, always-latest,
plus per-repo additions.

## Locked decisions

- **Two layers**: workspace Knowledge (from connected tools) + per-repo additions.
- **Effective = additive merge; the repo wins on a true conflict** — union the two
  layers; when both define the same logical contract/claim (same key), the repo's
  version takes precedence. Otherwise additive.
- **Workspace Knowledge gets its own sidebar section: "Knowledge"** — its Spec /
  Contracts / Decisions views reuse the existing panels.
- **Connect tools in Settings → Integrations** (workspace-scoped; tokens encrypted
  via `TRUECOURSE_SECRET_KEY`, like the LLM provider keys).
- **Pluggable connector framework, not per-tool code.** One `KnowledgeConnector`
  interface; Confluence, Jira, **Notion, Linear, Google Docs**, … are
  implementations. Adding a tool = adding a connector, never touching the
  consolidator or the gate.
- **Never mirror the source corpus.** The connected tool stays the source of
  truth. We fetch document content **transiently** during a sync, run it through
  the consolidator, and persist **only the derived artifacts** (claims / decisions
  / contracts) plus **lightweight provenance** per source item (external id, URL,
  title, content-hash, version, last-synced) — never the raw bodies. This keeps
  storage small AND avoids holding copies of customers' knowledge (a governance
  win). Incremental syncs diff on the stored hash/version and re-process only
  changed items; deleted source items drop their derived claims.
- **No versioning / multiple KBs / module scoping for now** (Deferred).

## Model

- **Sources** (Confluence space · Jira project · manual docs) → normalize to spec
  **documents** (markdown) → the **existing IL consolidator** (claims/decisions) →
  contract generation. The pipeline is unchanged; only the *source* and the
  *storage key* differ from today's per-repo flow.
- **Storage**: the `spec-store` / `contract-store` seams gain a **workspace scope**
  alongside the repo scope. Workspace Knowledge is stored under `workspaceOrgId`;
  repo additions stay under the repo (as today).
- A repo's **effective** spec/contracts = read the workspace layer + the repo
  layer, then merge (additive; repo overrides on a key collision).

## Architecture (builds on what exists)

- **Consolidator reuse** — a connector's only job is doc extraction + normalization
  to markdown-ish spec docs; from there it's the same `spec-consolidator`
  (IL → claims/decisions) + contract generation. Confluence pages map cleanly;
  Jira is more granular (issue acceptance-criteria → claims) and needs a mapping
  convention.
- **The "never mirror" model is already how repo specs work — reuse it.** The
  consolidator splits docs into blocks and **content-addresses** each:
  `blockId = sha256(sourceId + headingPath + text)`. It persists ONLY the derived
  LLM extraction per block (`blocks/<blockId>.json`, the `extraction_cache` table
  in EE via `@truecourse/llm` `get/setCacheEntry`) — never the block text — plus a
  pure-derived `scan-state` (counts + conflicts + skipped-doc *reasons*, no bodies).
  The source (today the repo working tree) is read **transiently** during a scan.
  So the connector framework swaps ONLY the front-end that produces blocks: today
  `discovery.ts` builds a `DocCandidate { content, contentHash, … }` from files; a
  `KnowledgeConnector.fetch()` builds the same doc→block stream from a tool's API.
  Everything downstream — block hashing, the content-addressed extraction cache,
  the relevance filter, the merge, scan-state, claims/decisions — is reused
  unchanged. **The "provenance ledger" below = this existing block-cache +
  scan-state, keyed by workspace.** The only adaptation: the stable id in the hash
  is the tool's doc id (e.g. Confluence page id) instead of a file path — which
  also gives free incremental sync (unchanged page → same block ids → cache hits,
  no re-extraction).
- **Storage seams** — `contract-store`/`spec-store` already abstract the backend.
  Add a `WorkspaceRef` (keyed by `workspaceOrgId`) beside `RepoRef`; the EE
  Postgres impl keys the workspace layer by org. OSS/local is unaffected.
- **Merge at read time** — a small `effectiveContracts(repo)` / `effectiveSpec(repo)`
  helper unions workspace ∪ repo (repo wins on collision). Used by BOTH the
  dashboard reads and the gate, so there's one merge definition.
- **Gate** — `driftsForCommit` sources the repo's **effective** contracts before
  verifying. A workspace Knowledge change re-generates workspace contracts → new
  drift may surface across repos. That ripple is the cost of always-latest;
  versioning (Deferred) is what would gate it behind a deliberate bump.
- **Connector framework** (`ee/packages/*`) — a single `KnowledgeConnector`
  interface, with one implementation per tool:
  ```
  interface KnowledgeConnector {
    kind: 'confluence' | 'jira' | 'notion' | 'linear' | 'gdocs' | ...
    // Lightweight listing — metadata only, no bodies. Used to diff what changed.
    list(cfg): Promise<DocRef[]>            // { id, title, url, version, updatedAt }
    // Fetch ONE document's content, transiently, only when (re)processing it.
    fetch(cfg, id): Promise<DocContent>     // normalized to markdown-ish spec text
  }
  ```
  A generic **sync engine** drives every connector identically: `list()` → diff
  against the stored provenance ledger (by `version`/hash) → `fetch()` only the
  changed items → consolidate → upsert derived artifacts + provenance; prune
  derived claims for removed items. The fetched bodies are **not stored**. Auth
  config is workspace-level + encrypted; sync on demand first (scheduled/webhook
  later).
- **Provenance ledger** — the content-addressed block cache + scan-state above are
  already the ledger; we add a thin **per-document** row (external id, url, title,
  version/hash, last-synced) so the doc→block mapping survives and the UI can do
  "where did this claim come from?" click-through. This document row + the existing
  block cache is ALL we keep from the source — we link to the tool, never host the
  content.

## UI

- **Sidebar → Knowledge** (workspace): Spec · Contracts · Decisions views of the
  workspace Knowledge, reusing `SpecPanel` / `ContractsPanel` / `DecisionsPanel`.
- **Settings → Integrations**: connect Confluence/Jira; pick space/project;
  "Sync now"; show last-sync status.
- **Repo Spec/Contracts tabs**: show the merged set (inherited workspace + the
  repo's own), with a provenance badge (workspace vs repo) so it's clear which
  layer a contract came from.

## Phases

1. **Workspace Knowledge storage + surface** — ✅ **DONE.** `WorkspaceRef` scope on
   the spec seam (Postgres, keyed by org); the **Knowledge** sidebar section reads
   it, reusing the OSS spec panels via a pluggable `SpecDataSource`. Seeded via
   **manual doc upload/paste** (transient bodies → `consolidate()` → derived
   artifacts only). Full conflict resolution lands here too, via the body-free
   `remerge()` (raw claims + chains persisted; decisions re-merge through the seam).
2. **Connector framework + first connector (Confluence)** — ✅ **DONE.** The
   `KnowledgeConnector` interface + generic sync engine + provenance ledger +
   **transient fetch (RAM, no body storage)**; Confluence implemented. Settings →
   Integrations UI + encrypted token + "Sync now". Also landed the **0-LLM-on-
   unchanged** cache migration + the **fully-in-memory** EE consolidate (no local
   files) — see the Architecture principle above.
3. **Effective merge + gate** — `effectiveContracts/Spec(repo)` (workspace ∪ repo,
   repo wins); the gate + dashboard reads use it; repo tabs show merged + provenance.
   - **Increment 1 — ✅ DONE: workspace contracts are real.** The contract
     extractor gained an in-memory generation path (`generateContractsInMemory` —
     injected canonical claims + a `{relPath → .tc}` map out, no disk; the disk
     `generateContracts` now shares the same `extractArtifacts` core). The slice
     extraction cache already rides the KV seam, so unchanged claims cost **0 LLM**
     on re-sync. New `workspace_contract_sets` table + `saveWorkspaceContracts`/
     `loadWorkspaceContracts`/`list`/`read` on the `ContractStore` seam (file impl
     throws/empty; `PgBlobContractStore` keys content-addressed blobs by `ws:<org>`).
     `generateWorkspaceContractsInProcess(org)` runs on every connector sync AND
     after every workspace decision (the canonical claims changed → contracts
     auto-refresh, **no manual Generate button** — the deliberate low-touch model,
     forward-compatible with auto-sync). Generation is triggered from the EE layer
     (sync engine + decision routes), best-effort on the decision path so a
     regen hiccup never undoes the persisted decision; core's `remerge`/decision
     mutators stay LLM-free. `GET /api/ee/knowledge/contracts/{tree,file}` serves
     the corpus; the Knowledge → Contracts tab renders it via the reused
     `ContractsPanel` + `CodeViewer`.
   - **Increment 2 — ✅ DONE: the gate verifies EFFECTIVE contracts.** The merge
     is by `${kind}:${identity}` (NOT filename, so it's robust to hand-authored
     repo contracts): the verifier's `resolve(files, { baseFiles })` lifts the
     workspace (base) layer first, then the repo (primary) layer overrides it on a
     key collision (silently — a within-layer duplicate is still an error), and
     cross-references resolve over the union. `verify({ baseContractsDir })` →
     `verifyInProcess({ workspaceOrgId })` → `withContracts` materializes the
     workspace corpus under the repo's (and, when the repo has NO contracts of its
     own, the workspace IS the corpus — the cross-repo ripple). The gate threads
     the repo's linked `workspaceOrgId` through `runGateVerify`/`driftsForCommit`
     AND `runBaseline` (so base vs head use the same corpus); neutral only when
     BOTH layers are absent. OSS/local (file store → no workspace layer) is
     unchanged.
   - **Increment 3 — ✅ DONE: the repo Spec AND Contracts tabs show the EFFECTIVE
     set + a provenance badge.** Both merges are server-side in the OSS routes,
     gated on `req.eeUser.organizationId` (set by the auth gate) + core's
     workspace helpers — NO ee import (`AuthUser` is from `@truecourse/shared`),
     inert in OSS (file store → empty workspace → repo-only).
     - **Contracts** (`routes/contracts.ts` `effectiveContractFiles`): repo files
       (authored + inferred) ∪ workspace corpus, repo wins on a relpath collision,
       tagged `provenance`; the file route falls back to `readWorkspaceContractFile`.
       Relpath-level is correct for generated contracts (writer maps key→path); the
       GATE does the authoritative artifact-key merge. `ContractsPanel` badges
       inherited files.
     - **Spec** (`routes/spec.ts` `effectiveClaims`): repo claims ∪ workspace claims,
       repo wins on a `(module, topic, subject)` collision, each tagged `layer`
       ('workspace'|'repo'). Canonical tree tags a topic/module `inherited` when ALL
       its claims are workspace; the section returns layered claims.
       `SpecCanonicalFile` badges each inherited claim; `SpecCanonicalPanel` badges
       inherited topics/modules. (Union, not enforcement — the gate verifies
       contracts, not claims.)
4. **Repo-level additions** — ✅ **DONE (as part of Phase 3).** The repo's own
   spec/contracts ARE the repo (winning) layer in every merge: the gate uses
   `loadContracts(ref)`, the dashboard Contracts tab uses `listContractFiles(repoKey)`,
   the dashboard Spec tab uses `claimsFor(repoKey)`. A repo with its own spec docs
   gets them generated by the existing scan/generate pipeline and merged on top of
   the workspace (repo wins on collision — tested). No separate work remained.
5. **More connectors** — NOT STARTED. Jira, Notion, Linear, Google Docs, … each is
   just a new `KnowledgeConnector` impl on the Phase-2 framework; no consolidator/
   gate/UI changes. **This is the only remaining plan item.**

## Deferred

- **KB versioning** — pin a workspace-Knowledge version per repo (like a versioned
  dependency) so spec edits don't instantly re-gate the fleet; upgrades become a
  deliberate, reviewable bump.
- **Multiple KBs + per-module scoping** — a repo subscribing to a specific KB / a
  slice of modules rather than the whole workspace Knowledge.

## Open questions

- Source → spec-doc normalization fidelity per tool (Confluence page hierarchy →
  modules/topics; Notion blocks; Google Docs structure; Jira/Linear issue →
  acceptance-criteria → claims).
- Incremental-sync change detection per tool — some expose a reliable `version`
  (Confluence), others only `updatedAt` or require a content-hash we compute on
  transient fetch.
- How much provenance to keep for click-through — id + url + title only, or also
  a short anchor/excerpt for the derived claim (still tiny vs the full body).
- Sync trigger (manual → scheduled → webhook) per tool.
- Exactly how a "true conflict" is keyed (contract id / module+topic) for the
  repo-wins merge.
