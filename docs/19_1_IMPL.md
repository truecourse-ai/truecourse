# Phase 19.1 — Suggest: Implementation Plan

Source spec: `docs/ADR_PLAN.md` § Phase 19.1. This document is the execution plan.

## Branch strategy

Long-lived epic branch **`phase-19-adrs`** off `main`. All phase-19 sub-phases merge into it; a final batch PR merges `phase-19-adrs` → `main` when the epic closes.

For 19.1 specifically: work happens directly on `phase-19-adrs` (it's the first sub-phase — nothing else to collide with). If a later sub-phase needs a working branch, it can fork off `phase-19-adrs` and PR back into it. Sub-milestones below are separate commits on `phase-19-adrs`.

## Architecture note — two integration surfaces

The CLI does **not** call the server over HTTP. Same pattern as existing commands (`truecourse analyze` imports `analyzeInProcess` from `@truecourse/server/analyze`). Everything has two parallel consumers of the same underlying library:

- **In-process (CLI):** imports from `@truecourse/server/adr-suggester`, `@truecourse/server/adr-store`, `@truecourse/server/adr-writer`. No HTTP.
- **HTTP + Socket.io (web UI only):** thin route wrappers in `apps/server/src/routes/` around the same library functions, for the React dashboard in `apps/web/`.

Progress events use a callback / EventEmitter abstraction (matching the existing `StepTracker` / `@truecourse/server/progress` pattern) so both consumers subscribe: CLI → `@clack/prompts` progress render; HTTP wrapper → Socket.io forward.

## Locked-in design decisions

- **Agent-style LLM orchestration.** Pass 1 surveys the graph for candidate topics. Pass N drafts one ADR per topic, capped at the existing per-domain concurrent-spawn limit (commit `e615f94`). No single-call JSON blast.
- **Auto-linking = LLM manifest only.** Each draft returns an `entities` list; those become `linkedNodeIds` on accept. No fuzzy matching, no confidence scoring in 19.1. `adr link` / `adr unlink` is the manual escape hatch. Fuzzy matching is deferred to 19.5/19.6 where it's load-bearing.
- **Topic signature for dedupe:** `{topic: <fixed-vocab category>, entities: <sorted graph-node IDs>}`.
- **Fixed topic vocabulary** (constant in shared package): `circular-dependency`, `shared-database`, `facade-module`, `service-boundary`, `auth-placement`, `caching-strategy`, `communication-pattern`. The LLM must pick from this list; drafts with unknown topics are discarded.
- **`suggest` auto-runs `analyze`** if `.truecourse/LATEST.json` mtime is older than any tracked source file.
- **Test fixture:** `tests/fixtures/sample-project/`. Extend in M3 if it doesn't surface enough draft-worthy topics — still realistic code per the no-synthetic-fixtures rule.
- **Fallback drop reflected in `ADR_PLAN.md`** as part of M9 (remove confidence-score language from 19.1).

**For M10–M13 (flows + Living Fragments):**

- **Fragment syntax:** fenced code blocks with language `adr-graph` / `adr-flow`, body is YAML-ish `key: value` lines (reuse the existing frontmatter grammar parser — same key-value semantics). Not JSON, not TOML. Matches how MADR frontmatter already reads.
- **One snapshot per fragment at accept time.** No snapshot history; fresh snapshot would require a new accept. Drift visualization = snapshot vs. current, no timeline of past states.
- **Fragment validation strips, doesn't reject.** If a draft's fragment references an unknown node, the block is removed from the body but the prose stays — we don't throw out a whole draft because the LLM slightly hallucinated a service name.
- **Drift is not staleness.** Fragment nodes still present + new/missing edges around them = show drift in the render, do NOT flag stale. Only node/flow deletion flags stale. This keeps staleness meaningful (actionable) vs. noisy.
- **Reuse existing rendering components.** Graph fragment = filtered React Flow with existing dagre layout. Flow fragment = existing `FlowDiagramPanel` scoped to a flow id. No new diagram infrastructure.
- **No Mermaid fallback for GitHub rendering** in this scope — plain readers see the fenced block as readable YAML. Revisit only if users complain about GitHub surface.

## Sub-milestones

Ordering is sequential — later milestones depend on earlier ones.

### M1 — Shared foundation (no LLM, no UI)

New:
- `packages/shared/src/adr.ts` — types: `Adr`, `AdrDraft`, `AdrStatus` (`proposed` | `accepted` | `deprecated` | `superseded` | `stale`), `TopicSignature`
- `packages/shared/src/config.ts` — extend config schema with `adr: { path, defaultThreshold, maxDraftsPerRun }`
- `apps/server/src/lib/adr-store.ts` — persistence layer plus MADR parser/serializer and graph-entity collector (consolidated: parser and `collectGraphEntityIds` live here rather than in their own files, so "how ADR state gets on and off disk" is one module)
- `apps/server/src/lib/adr-store.ts` — atomic I/O via existing `atomicWriteJson`; manages `.truecourse/adrs.json`, `.truecourse/drafts/<draft-id>.json`, `.truecourse/adr-rejected.json`
- `apps/server/src/types/adr-snapshot.ts` — on-disk shape (server-internal)

Tests: `tests/shared/adr-schema.test.ts`, `tests/server/adr-parser.test.ts`, `tests/server/adr-store.test.ts`.

### M2 — Topic vocab + signature

New:
- `packages/shared/src/adr-topics.ts` — `ADR_TOPIC_VOCAB` constant
- Signature compute/compare helpers live alongside rejected-sig persistence inside `apps/server/src/lib/adr-store.ts`

Tests: `tests/server/adr-signatures.test.ts` — including "semantically-same draft reworded by LLM produces same signature" and "same topic, different entity set, different signature."

### M3 — Suggest orchestration (LLM, library-level)

New:
- `apps/server/src/llm/adr-suggester.ts` — agent runner exported as `suggestAdrsInProcess(opts)`:
  - **Survey pass:** one spawn with graph summary + rejected-signatures + `maxDraftsPerRun` budget + topic vocab; returns `{topic, entities, rationale}[]`
  - **Drafting pass:** one spawn per survey topic, parallel under the existing spawn cap; each returns `{madrBody, topic, entities}`
  - **Validation:** reject drafts whose `entities` reference unknown graph node IDs or whose `topic` is outside the vocab; log count as a quality metric
  - **Progress:** emits events via a callback or EventEmitter argument (matching existing `StepTracker` pattern). No Socket.io coupling in the library — that's the HTTP wrapper's job (M4).
- `apps/server/src/llm/prompts/adr-survey.ts`, `adr-draft.ts`

Tests: `tests/server/adr-suggester.test.ts` — mocks LLM CLI at the spawn boundary with canned JSON; asserts concurrency cap respected, rejected signatures filtered before presentation, invalid entities/topics dropped, progress callback invoked in order.

Extend fixture if needed: add one clear instance each of facade, circular-dep, and shared-DB patterns to `tests/fixtures/sample-project/`.

### M4 — HTTP + Socket.io wrapper (web UI only)

Thin route wrappers that call the same library functions from M1–M3 and M5. **The CLI does not use these routes** — it imports the libraries directly.

Modify `apps/server/src/routes/`:
- `GET /api/adrs` — accepted corpus
- `GET /api/adrs/drafts` — review queue
- `GET /api/adrs/:id`
- `POST /api/adrs/suggest` — spawns `suggestAdrsInProcess(...)` with a Socket.io-forwarding progress callback; returns `runId`
- `POST /api/adrs/drafts/:id/accept`
- `POST /api/adrs/drafts/:id/reject`
- `POST /api/adrs/drafts/:id/edit`
- `POST /api/adrs/:id/link` / `DELETE /api/adrs/:id/link/:nodeId`

Socket.io events emitted by the `suggest` route's progress callback: `adr:suggest:progress`, `adr:suggest:draft`, `adr:suggest:complete`.

Shared Zod schemas in `packages/shared/src/adr-api.ts`.

Tests: `tests/server/adr-api.test.ts`.

### M5 — Accept flow + MADR writer

New: `apps/server/src/lib/adr-writer.ts` — writes `docs/adr/ADR-NNNN-<slug>.md`; numbering = `max(existing ADR-NNNN-*) + 1`, defaulting to `0001`. On accept: write → parse → add to corpus → delete draft file.

Tests: `tests/server/adr-writer.test.ts` — empty-repo (0001), repo with 0001/0003 gaps (writes 0004, not 0002), slug normalization.

### M6 — Structural staleness in analyze pipeline

Modify the analyze pipeline (in `packages/analyzer/` or the server's analyze orchestrator, per current structure): for each accepted ADR, verify `linkedNodeIds` still exist in the new graph. Set an internal `stale: true` flag on the ADR record in `.truecourse/adrs.json` — **no mutation of the MADR file on disk**.

Tests: `tests/analyzer/adr-staleness.test.ts` — seed ADR linked to a module, remove the module from the fixture, re-analyze, verify flag.

### M7 — CLI subcommand tree (in-process)

New files under `tools/cli/src/commands/adr/`. Each command imports from `@truecourse/server/*` directly — **no HTTP calls**, matching the existing `analyzeInProcess` / `diffInProcess` pattern:
- `suggest.ts` — imports `suggestAdrsInProcess`, passes a `@clack/prompts`-rendering progress callback; interactive flow + `--non-interactive --json` + `--threshold <n>` / `--max <n>` / `--topic <hint>`; auto-runs analyze via the existing CLI helper if LATEST is stale
- `drafts.ts` / `accept.ts` / `reject.ts` / `edit.ts` (edit limited to drafts in 19.1) — all use `adr-store` / `adr-writer` directly
- `list.ts` / `show.ts` / `stale.ts` — read via `adr-store`
- `link.ts` / `unlink.ts` — mutate via `adr-store`
- All read commands support `--json`

Register in `tools/cli/src/index.ts` as the `adr` subcommand tree. Version bump lives in M9.

Tests: `tests/cli/adr-suggest.test.ts`, `tests/cli/adr-lifecycle.test.ts` — drive the CLI end-to-end against the fixture with mocked LLM.

### M8 — Decisions tab UI

Modify `apps/web/`:
- New Decisions route + sidebar entry
- Two-pane component: list (collapsible sections: Review Queue, Accepted, Superseded, Stale) + detail panel
- Top bar: "Suggest undocumented decisions" button, status + linked-service filters, "Show ADR badges on graph" toggle (off by default)
- Generation modal: threshold slider, max-per-run, topic hint
- Review row inline actions: Accept / Edit / Reject
- Edit modal: MADR editor (frontmatter form + markdown body, live validation)
- Detail panel: markdown render + linked-node chips (click → focus graph) + supersedes chain + staleness banner
- Node detail panel (existing) gets a Decisions section listing linked ADRs
- Socket.io client subscribes to `adr:suggest:*` events

Tests: `pnpm build` typecheck only; feature verification is manual via `pnpm dev` per CLAUDE.md rule on dev servers.

### M9 — Docs + PLAN status

- Update `README.md`: new `adr` CLI, `adr` config block, Decisions tab
- `ADR_PLAN.md`: remove confidence-score references from 19.1 language; confirm fallback-drop; flip `STATUS: BACKLOG` → `STATUS: DONE` on 19.1 and each of its sub-sections
- `PLAN.md`: mirror 19.1 status
- Release: version bump in `tools/cli/package.json`, `apps/server/package.json`, `tools/cli/src/index.ts` `.version()` call — per the three-place sync rule

---

> Milestones M1–M9 shipped in v0.6.0. **M10–M13 below are the remaining `BACKLOG` work inside 19.1** — flows-in-context + Living Fragments (see `ADR_PLAN.md` § Phase 19.1 for spec).

### M10 — Flows in the suggester's graph context

Modify:
- `apps/server/src/services/llm/prompts.ts` — extend `buildGraphSummary` with a `Flows` section. For each flow (capped at top-N by step count, default 15): name, trigger (http/event/cron/startup), entry service + method, step count, step sequence as `src-svc → tgt-svc (call|http|event|db-read|db-write)` up to ~8 hops.
- No prompt template change — the summary is the prompt context. Survey + draft passes both benefit.

Tests:
- `tests/server/adr-suggester.test.ts` (extend): fixture graph with a 3-service HTTP flow → mock the LLM; assert the captured survey prompt includes the flow name and step sequence.
- Cap test: graph with 50 flows → summary truncates to top-N; summary length stays bounded.

Notes:
- No new dependency; the `FlowRecord[]` is already on the `Graph` type.
- No new CLI / HTTP / UI surface for this milestone.

### M11 — Living Fragments: parser, data model, snapshot capture

New / modified:
- `packages/shared/src/types/adr.ts` — add types:
  - `FragmentKind = 'graph' | 'flow'`
  - `FragmentSnapshot { kind, locator, capturedAt, nodes?, edges?, steps?, graphHash }`
  - Extend `AdrIndexEntry` with `fragments?: FragmentSnapshot[]`
  - `AdrFragmentSchema` Zod for the locator (parsed block parameters): `{ services?: string[], modules?: string[], show?: 'dependencies'|'modules'|'all' }` (graph) or `{ flowId: string, fromStep?: number, toStep?: number }` (flow)
- `apps/server/src/lib/adr-store.ts` — add `extractFragmentsFromBody(body: string): ParsedFragment[]`. Walks the markdown looking for fenced blocks with language `adr-graph` or `adr-flow`; parses the YAML-ish body via a small hand-rolled parser (reuse existing frontmatter helpers — same grammar, just key:value lines).
- `apps/server/src/lib/adr-writer.ts` — on accept:
  - Parse fragments from each section
  - Resolve against `core.graph` (passed in from the analysis, or read from LATEST)
  - Build a `FragmentSnapshot[]` with captured nodes/edges/steps + `graphHash` (stable hash of the filtered subgraph / flow steps)
  - Persist on the written `AdrIndexEntry`
- `apps/server/src/lib/adr-store.ts` refresh (M6 staleness extension):
  - For each accepted ADR, compare each fragment's snapshot to the current graph. If referenced nodes/flow id no longer exist, flag stale with reason `fragment references removed entities` / `fragment references removed flow`.
  - Drift without deletion (same node set, different edges) → NOT stale. Recorded separately for the dashboard to render.

Tests:
- `tests/server/adr-store.test.ts` (extend):
  - `adr-graph` block with known service names → parses correctly; snapshot captures the right nodes/edges
  - `adr-flow` block with a valid `flowId` → snapshot captures the flow steps
  - Invalid references (unknown service, unknown flowId) → block is dropped from the captured fragments with a warning; the ADR body text is unchanged
  - Fragment-driven staleness: delete a node in a fragment → re-run staleness → ADR flagged with the new reason

### M12 — Living Fragments: generation prompt + validation

Modify:
- `apps/server/src/services/llm/prompts.ts` — extend the draft prompt:
  - Instruct the LLM to emit at most one fenced `adr-graph` or `adr-flow` block in the Context section, showing the specific services/flows the decision is about
  - Show the block syntax inline in the prompt
  - Forbid fabricating service/flow names — must reference the graph summary already in context
- `apps/server/src/services/llm/adr-suggester.ts` — extend draft post-validation:
  - Parse fragments from the LLM's `madrBody`
  - Validate each against the graph node-id set + flow ids
  - Invalid blocks: strip the block from the body (regex around the fence); log a warning. Keep the rest of the draft.
  - Valid blocks: leave in place (snapshot capture happens on accept in M11)

Tests:
- `tests/server/adr-suggester.test.ts`:
  - Mocked LLM emits an `adr-graph` block with known nodes → body preserved intact
  - Mocked LLM emits an `adr-graph` block with a ghost service → block stripped, prose preserved, warning logged
  - Mocked LLM emits an `adr-flow` with unknown `flowId` → block stripped

### M13 — Living Fragments: dashboard rendering

New / modified:
- `apps/web/src/lib/api.ts` — extend `AdrResponse` / `AdrListItem` to include `fragments: FragmentSnapshot[]`
- `apps/web/src/components/decisions/AdrViewerPanel.tsx` — markdown renderer now swaps `adr-graph` and `adr-flow` fenced blocks for live components:
  - `<AdrGraphFragment snapshot={...} locator={...} />` — renders a subgraph via React Flow, scoped to the referenced nodes. Uses the existing graph service + dagre layout pipeline. Side-by-side with the snapshot nodes/edges; new edges highlighted in amber, missing nodes struck through.
  - `<AdrFlowFragment snapshot={...} locator={...} />` — reuses `FlowDiagramPanel` scoped to the flow id, with optional `fromStep` / `toStep` slicing. Drift vs snapshot shown at step granularity.
- Click-through: clicking any node in a fragment focuses the main graph on that node (same pattern as existing node-detail navigation).
- `react-markdown` integration: custom `code` renderer that detects `language-adr-graph` / `language-adr-flow` fences and swaps them for the fragment components. Unknown languages fall through to the default `<pre>` rendering.

Tests:
- No unit tests beyond `pnpm build` typecheck. Manual verification via `pnpm dev` per the CLAUDE.md rule on UI testing.

### M9 follow-up — docs + release

After M10–M13 land:
- `ADR_PLAN.md`: flip the three sub-status tags inside 19.1 to `DONE`, update the phase's top-level status to `DONE`
- `PLAN.md`: mirror
- `README.md`: brief note in the ADRs section about Living Fragments with a syntax example
- Version bump (three-place sync rule) — aim for v0.6.0 given the scope

---

## Out of scope for 19.1

- Confidence scoring on links — introduced in 19.5/19.6
- Fuzzy matching of any kind
- Nygard parsing, custom paths, malformed-file recovery (19.6)
- Rule codification (19.2)
- Consistency checks (19.3)
- Diff-check integration (19.4)
- `adr new` CLI / "New ADR" button (19.5)
- AI agent skill (19.7)
- Graph badges on by default
- Date-range filters on Decisions tab

## Risks & mitigations

- **LLM cites entities not in the graph.** Mitigation: validate every draft's `entities` against the known node-ID set; drop invalid drafts and log.
- **LLM invents topics outside the fixed vocab.** Mitigation: drop on receipt; surface drop count in logs.
- **Agent-style spawns exceed concurrency cap.** Mitigation: reuse the existing spawn pool, don't create a new one. Add a test asserting the per-domain cap is never exceeded.
- **Fixture too sparse to produce draft-worthy topics.** Mitigation: extend fixture in M3 with realistic instances — no synthetic one-off files.
- **Accept races: user hits Accept twice.** Mitigation: adr-store uses existing `atomicWriteJson`; accept is idempotent (re-parse-and-upsert on the target path).

## Verification flow

**Core loop** (M1–M9, shipped in v0.6.0):

1. `pnpm install && pnpm build && pnpm test 2>&1 | tee /tmp/test-output.txt` — all green
2. `cd tests/fixtures/sample-project && truecourse analyze` — completes
3. `truecourse adr suggest` — drafts stream; per-draft Accept / Edit / Reject prompts work
4. Accept one → `docs/adr/ADR-0001-<slug>.md` written with valid MADR, visible in `truecourse adr list`
5. `truecourse adr show ADR-0001` prints body + linked-node IDs
6. Reject a draft; re-run `suggest` → rejected topic does not reappear
7. `pnpm dev`, open Decisions tab → review queue, accepted list, detail panel, generation modal all render; accept/reject/edit from UI works; progress streams
8. Remove a module referenced by an accepted ADR → re-run `truecourse analyze` → stale flag appears in UI + `truecourse adr stale` output

**Flows + Living Fragments** (M10–M13, pending):

9. On a fixture with a cross-service HTTP flow, run `suggest` → at least one draft references the flow by name, grounded in the actual step sequence (confirms M10)
10. Accept a draft whose body contains an `adr-graph` block → `.truecourse/adrs.json` has a `fragments[]` entry with captured nodes/edges + `graphHash` (confirms M11)
11. Open the accepted ADR in the dashboard → the `adr-graph` block renders as a filtered subgraph, click a node → main graph focuses on it (confirms M13)
12. Accept a draft with an `adr-flow` block → dashboard renders the flow diagram scoped to the referenced flow (confirms M13)
13. Modify the fixture to add a new dependency between fragment nodes → re-run analyze → dashboard shows drift highlighting; ADR is NOT flagged stale (confirms M11 drift semantics)
14. Delete a service referenced by a fragment → re-run analyze → ADR flagged stale with the fragment-specific reason (confirms M11 stale semantics)

## Review checkpoints

**Core loop (shipped):**

- **After M3** — agent-style orchestration runs end-to-end against the mocked LLM. Sanity-check prompt shape and validation before building UI/API around it.
- **After M7** — full CLI lifecycle (suggest → accept / reject) is usable from terminal. Sanity-check the UX and shared schemas before building UI.
- **After M8** — full UI works. Final review before M9 docs/status and merge.

**Flows + Living Fragments (pending):**

- **After M10** — flows context landed; inspect a sample captured survey prompt to confirm flows are included + bounded.
- **After M11** — snapshot capture + staleness semantics verified against a fixture with mutated graph. This is the riskiest milestone (new data shape + cross-cutting staleness rule).
- **After M12** — end-to-end with mocked LLM: drafts carry valid fragment blocks; invalid blocks are stripped but prose survives.
- **After M13** — dashboard rendering done. Final review before closing 19.1 and releasing v0.6.0.
