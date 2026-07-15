# EE Knowledge page on Spec/Guard — workspace corpus, conflicts, scenarios

Status: **PLANNED — awaiting review.** Base: `sm/spec-guards-ee` (PR #743).
Companion to docs/EE_JIRA_CONNECTOR_PLAN.md (the connector + Sync/Process flow,
IMPLEMENTED). This plan rebuilds the workspace **Knowledge** page — removed in
the guard-era restructure — on the new spec-scan corpus + guard (spec →
scenario) model, and fixes the multi-connector union bug found in live testing.

## Context

- The old Knowledge page (Sources + Contracts tabs) is gone; nothing in the UI
  renders the workspace corpus today. Filtering outcomes (kept / skipped /
  reasons), conflicts, and decisions are invisible except by SQL.
- Live testing proved the pipeline works (18/18 relevance verdicts correct,
  within-Jira supersession detected) and exposed the structural bug: each
  connector's Process consolidates ONLY its own docs and saves the result as
  the WHOLE workspace corpus — Jira's run wiped Confluence's corpus, and a
  cross-source conflict (Jira ticket vs Confluence ADR) can never be paired.
- The guard-era OSS dashboard has everything we want to reuse: the corpus Spec
  tab (`SpecCorpusView` + `SpecOverlapDetail` + `SpecDocViewer` — areas, kept
  docs, overlaps/conflicts with pick-a-side/dismiss verdicts, force-include/
  exclude, skipped docs) and the guard suite (`GuardCoveragePage`,
  `GuardScenariosPanel`, `GuardBlockedPanel`, …). They are currently
  repo-coupled (call `/api/repos/:id/spec/*` via `@/lib/api`).

## Locked decisions (proposed)

1. **Processing is workspace-scoped (the union fix).** The processing job
   fetches EVERY connected source (loop over the org's connections), builds the
   union doc set, consolidates ONCE, and reconciles each source's ledger slice.
   Single-flight key becomes `knowledge.sync:<org>` (not per kind). On success
   it clears ALL connectors' pending records (their content was consumed).
   Unchanged docs from other sources are cache hits — processing Jira after
   Confluence costs ~the Jira delta.
   - The per-row **Process buttons remain** but all dispatch the same workspace
     job; the confirm dialog shows the COMBINED pending estimate (sum of every
     connector's stored pending: deltas listed per source, costs summed,
     `costPartial` OR-ed). Sync stays per-connector.
2. **Workspace decisions ride the existing store, injected via the scratch
   tree.** Decisions (manualIncludes/manualExcludes/manualAreas/
   conflictResolutions — the `decisions.json` shape) persist as the
   `workspace_spec_sets` artifact `'decisions'` (column already exists).
   `syncWorkspaceCorpusInProcess` gains an optional `decisions` input and
   materializes it as `.truecourse/specs/decisions.json` inside the scratch
   tree before `curateInProcess` — curate then folds it exactly as it does for
   a repo. No consolidator changes.
3. **Decision writes BATCH; the last open conflict's resolution re-processes.**
   Workspace decision endpoints write the artifact, then enqueue the workspace
   processing job ONLY when zero conflicts remain open afterwards — resolving a
   batch of conflicts one by one re-processes exactly once, on the final
   verdict (the EE analog of OSS's "resolve all → dot on Rescan", auto-fired
   because EE has no scan button). While conflicts stay open, writes persist
   silently. No corpus yet ⇒ never auto-enqueue (the first process is
   user-dispatched). The corpus GET also folds decisions at read time (same
   `buildCorpusConflicts` shared derivation the OSS route uses) so verdicts
   render instantly without waiting for the re-process.
4. **UI reuse via a data-source seam, not forks.** Generalize the spec
   components' data access behind a small provider (a React context exposing
   the ~8 calls `SpecCorpusView`/`SpecOverlapDetail`/`SpecDocViewer` make:
   corpus GET, doc GET, includes/excludes/conflict-resolution
   POST+DELETE). Default implementation = the current repo `@/lib/api` calls
   (OSS pages unchanged); the EE Knowledge page provides a workspace
   implementation targeting `/api/ee/knowledge/spec/*`. This is the same
   pattern the pre-redesign branch used (`SpecDataSource`), re-applied to the
   corpus-era components. Repo-only affordances (the Scan button, PR gating
   hints) are hidden by the source (`supportsScan: false` — the workspace
   equivalent is Sync/Process on Integrations).
5. **Scenarios are generated automatically after a conflict-free Process, not by
   a button.** When the `knowledge.sync` (processing) job succeeds AND
   `openConflicts(corpus, decisions)` is zero, its settle hook chains a
   `knowledge.guard` job (org single-flight `knowledge.guard:<org>`; best-effort —
   a chain failure never fails the completed process): materialize union docs +
   corpus + decisions into a scratch tree, run the OSS guard generate in-process,
   persist the scenario corpus + result under workspace scope. With open conflicts
   the chain does NOT fire (generation stays blocked); the decision-write rule
   (decision 3) re-processes when the last conflict resolves, whose settle then
   chains. The Scenarios tab therefore has **no Generate button** — it renders
   coverage, the `GuardBlockedPanel` while conflicts are open (same
   `openConflicts(corpus, decisions)` derivation the repo uses), and a
   "Generating…" affordance from any active `knowledge.guard` job. `POST
   /guard/generate` + `/guard/estimate` are **retained** (wire-compat + tests) but
   are no longer the primary trigger. The generation follow-up is unpriced up
   front, so the Process confirm dialog's `costPartial` (`$X+`) already covers it.
   Workspace scenarios are stored via the existing guard stores keyed
   `repoKey = 'ws:<org>'` (the convention workspace contracts blobs already use).
   Running workspace scenarios against repos (the effective-merge gate analog) is
   explicitly OUT of this plan.
5b. **Repo parity (decided 2026-07-14): hosted repos become self-driving the
   same way.** The hosted repo **Generate button is removed** (its endpoint
   stays wire-compat). Two transition-to-zero chains, mirroring the workspace
   rules and reusing the same shared derivations:
   - A hosted repo decision write that closes the LAST open spec conflict
     dispatches the repo baseline scan (`enqueueBaseline`); writes batch while
     conflicts remain open. A conflict-free scan already chains scenario
     generation (`chainGuardOnboarding`/`generateWasBlocked`) — so resolve-all
     → scan → generate, end to end.
   - A guard-decision write (dismissedClaims) that dismisses the LAST active
     finding dispatches the repo guard generate (`enqueueGuardGenerate`), so
     the scenario corpus regenerates honoring the dismissals.
   Scope: hosted EE repos. OSS local keeps its explicit scan/estimate UX
   (cost confirms are the OSS contract); where the decision routes are shared,
   the auto-dispatch rides the established OSS→EE enqueue seams (the
   `setGuardGenerateEnqueue` pattern), inert in OSS.
6. **Workspace contract generation is REMOVED (corpus + scenarios are the
   model).** It crashed processing on the guard-era store:
   `syncWorkspaceCorpusInProcess` used to call `generateFromCorpusInProcess` +
   `saveWorkspaceContracts` after curating, but the guard-era base retired the
   enterprise workspace-contract store — so the save hit the file default, threw
   `workspace-scoped contracts require the enterprise store`, and the whole
   `knowledge.sync` job failed before the ledger reconcile. `syncWorkspaceCorpusInProcess`
   is now **corpus-only** (curate → persist corpus → return the area count); it
   never generates or stores workspace `.tc` contracts. The workspace model is
   the curated corpus + the auto-chained scenarios (decision 5). The Knowledge
   page has no Contracts tab, and the workspace contract read routes
   (`/contracts/tree`, `/contracts/file`) are removed.

## The page

`ee/packages/client/src/KnowledgePage.tsx` (new), nav-registered like the old
one. Tabs:

1. **Spec** (default) — the reused corpus view: areas → kept docs + overlaps;
   right pane = doc markdown viewer / conflict resolution detail
   (pick-a-side / dismiss / exclude); skipped docs surfaced with reasons +
   force-include; force-exclude on kept docs. All actions call the workspace
   decision endpoints.
2. **Scenarios** — the reused guard coverage view over the workspace scenario
   corpus: per-section scenarios, punts, gap reasons, totals; no Generate button
   (generation auto-chains off a conflict-free Process — decision 5), the blocked
   panel while conflicts are open, a "Generating…" affordance while the job runs,
   and an EmptyState (scenarios generate automatically once Knowledge is
   processed) before the first generate.
3. **Sources** — the provenance ledger (restored from the old page), now
   **server-side paginated** with search + source-kind filter (see Scale).

## Scale — thousands of Jira tickets

The corpus model already concentrates meaning into AREAS (bounded, tens), so
the Spec tab's primary nav scales by construction. The raw-list surfaces are
the risk:

- **Corpus GET returns kept docs grouped by area + a skipped SUMMARY only**
  (`skipped: { total, byReason: [{ reason, count }] }`) — never the full
  skipped array. A 10k-ticket project with 7k skipped bugs must not ship 7k
  rows into the page payload.
- **`GET /api/ee/knowledge/spec/skipped?query=&reason=&limit=&offset=`** — the
  paginated skipped listing behind a "Not included (7,012)" expander with
  search; force-include acts per row. Server slices the corpus's `skippedDocs`.
- **`GET /api/ee/knowledge/documents?query=&kind=&limit=&offset=`** — Sources
  tab pagination (extend `PgKnowledgeStore.listDocuments` with a paged variant;
  the existing unpaged call remains for the sync engine's reconcile).
- Kept-doc lists inside an area are naturally small (relevance-filtered), but
  the doc LIST rows must stay metadata-only — bodies load per-doc on selection
  (already how the viewer works).
- Jira rows render as `KEY: summary` with the deep link the ledger already
  stores — no connector-specific UI.

## Server endpoints (all under /api/ee/knowledge, org-scoped)

| Endpoint | Purpose |
| --- | --- |
| `GET /spec/corpus` | Workspace corpus payload: areas + kept docs + conflicts (decisions folded, `buildCorpusConflicts`) + skipped summary. 404 before first process. |
| `GET /spec/doc?ref=` | One doc's markdown — read from its STORED body via the ledger row (docPath → contentHash → content store). 404 for an unknown ref. (Superseded by EE_SYNC_STORE_PLAN: bodies are now stored at Sync time; no per-view connector re-fetch, no 410.) |
| `GET /spec/skipped` | Paginated skipped docs (query/reason/limit/offset). |
| `POST/DELETE /spec/includes`, `/spec/excludes`, `/spec/conflict-resolution` | Decision writes mirroring the repo routes; write the `'decisions'` artifact + enqueue re-process. |
| `GET /guard/coverage` · `GET /guard/scenario?…` | Scenario corpus reads for the Scenarios tab (shape mirrors the repo guard reads). |
| `POST /guard/generate` · `POST /guard/estimate` | Explicit generation with pre-flight estimate; 409 while conflicts are open. |
| existing `/sync`, `/estimate`, `/documents` (now paged) | unchanged flows from the connector plan. |

`GET /spec/doc` note: **superseded by EE_SYNC_STORE_PLAN.** The doc body is now
persisted at Sync time (content-addressed in the shared `content` table, keyed by
the ledger's `contentHash`), so the viewer reads the stored body via the ledger
row — no connector credentials, no per-view re-fetch, and no 410. An unknown ref
is a clean 404. Postgres now deliberately holds a mirror of synced doc content.

## Files

New: `ee/packages/client/src/KnowledgePage.tsx`; workspace spec/guard route
modules under `ee/packages/server/src/knowledge/`; the client data-source seam
module in `apps/dashboard/client/src/` (context + repo default); workspace
guard generate in-process wrapper in core (mirrors `syncWorkspaceCorpusInProcess`).
Modified: `knowledge/sync.ts` (union processing + combined pending),
`syncWorkspaceCorpusInProcess` (decisions injection), worker (union job +
`knowledge.guard` job), `IntegrationsPage` (combined confirm dialog),
`SpecCorpusView`/`SpecOverlapDetail`/`SpecDocViewer` (api calls → seam, no
behavior change), nav registry entry, `PgKnowledgeStore` (paged listing),
shared wire types.

## Tests

- Union: two stub connectors → one consolidate over the union; per-source
  ledger reconcile; ALL pendings cleared; cross-source docs land in one corpus
  (the conflict-detection precondition); single-flight per org.
- Decisions: artifact round-trip; scratch-tree injection reaches curate
  (corpus reflects manualExcludes); decision endpoint writes + enqueues;
  corpus GET folds verdicts.
- Scale: skipped summary + paginated skipped/documents endpoints (fixtures
  with 1k+ docs); corpus GET payload contains no skipped array.
- Guard: generate blocked on open conflicts; estimate → job → stored scenario
  corpus readable; coverage GET shape.
- Client: seam default = repo behavior unchanged (existing spec tests keep
  passing); Knowledge page tabs render from workspace endpoints; conflict
  verdict flow; skipped expander pagination; Sources search.

## Phasing (for the implementing agents)

- **A (server core):** union processing + combined pending + decisions
  artifact/injection + spec read/decision endpoints + paged listings.
- **B (client):** data-source seam extraction + Knowledge page (Spec +
  Sources tabs) + combined Process dialog.
- **C (scenarios):** workspace guard generate (core wrapper + job + endpoints)
  + Scenarios tab.
A and B can run in parallel once the wire shapes are fixed; C follows A.

## Wire-contract precision (fixed so client + server build in parallel)

- `GET /spec/corpus` returns the SAME payload shape as the repo route's
  `corpusPayload` (apps/dashboard/server/src/routes/spec.ts — the authority),
  with ONE difference: `skippedDocs` is replaced by
  `skipped: { total, byReason: [{ reason, count }] }`.
- The client data-source seam therefore exposes skipped docs ONLY through a
  paged `listSkipped({ query?, reason?, limit, offset })` call.
  `SpecCorpusView` consumes skipped exclusively via that call; the REPO default
  implements it client-side by slicing the full `skippedDocs` array it already
  fetched (repo behavior unchanged in substance), the workspace source hits
  `GET /spec/skipped`.
- The combined Process confirm dialog is computed CLIENT-side from the
  integrations list (every connector's stored `pending` is already in that
  payload): deltas listed per source, tokens/costs summed, `costPartial` OR-ed.
  No new endpoint.
- The union processing job's single-flight key is `knowledge.sync:<org>`; the
  client derives "Processing…" from ANY active `knowledge.sync` job in the
  org-scoped jobs context (every row shows it — the union touches all sources).
  Sweep keys stay per-kind (`knowledge.estimate:<kind>`).

Decided (2026-07-14): per-row Process buttons kept, all dispatching the one
workspace-scoped job; `GET /spec/doc` re-fetches from the source per view (no
cache) in v1; no Sync affordance on the Knowledge page itself in v1.

Superseded (2026-07-14): scenario generation is now **auto-chained** off a
conflict-free Process (decision 5), not a manual button — the endpoints stay for
wire-compat but the Scenarios tab has no Generate action.
