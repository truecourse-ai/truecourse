# ADR (Architectural Decision Records) — Implementation Plan

## Context

Replaces the original Phase 19 in `PLAN.md`. The goal is to surface, enforce, and evolve Architectural Decision Records alongside the code graph — bridging "what the code looks like" and "why it was built that way."

**Phase map.**
- **19.1 — Suggest.** LLM generates draft ADRs from an existing codebase; user reviews, accepts, rejects. Includes Living Fragments — `adr-graph` / `adr-flow` blocks inside ADR bodies that render live from the current analysis with drift highlighting. The dogfooding priority.
- **19.2 — Rule codification.** Turn accepted ADR prose into enforced detection rules.
- **19.3 — Consistency checks.** Automated LLM pass after analyze flags contradictions and intent-level violations as warnings.
- **19.4 — Diff integration.** `diff-check` cites linked ADRs and codified rules in PRs.
- **19.5 — Add.** Blank-slate authoring for writing ADRs by hand (empty repo / greenfield / ADR-first workflows).
- **19.6 — BYO.** Support externally-authored ADRs (Nygard, custom paths, malformed handling).
- **19.7 — AI agent skill (Claude Code first).** Provider adapter teaching the user's coding agent to read ADRs before coding, author ADRs from design conversations, and answer ADR Q&A. Claude Code first; neutral surface supports more providers later.

**Ordering rationale.** 19.1 ships first because we don't have a repo with hand-written ADRs to dogfood against — generating from existing code is our realistic testing path. 19.2–19.4 then complete the full enforcement cycle on top of generated ADRs (codify → check consistency → integrate with diff) so the whole loop is proven before we broaden inputs. 19.5 (Add) opens blank-slate authoring once the pipeline downstream of it is already solid. 19.6 and 19.7 broaden inputs (external ADRs) and outputs (ADR → code via Claude Code).

## Design principles

- **Dogfood the generation loop first.** The first real ADRs in any TrueCourse-using repo will be ones we generated.
- **MADR is the canonical format.** We write it, we read it. Other formats are a tail-phase concern.
- **Enforcement over documentation.** ADRs earn their keep when they become detection rules — a read-only panel is not enough.
- **LLM features ranked by hallucination risk.** Generation is the riskiest, so it ships with strict noise control (dedupe, novelty filter, confidence threshold, max-per-run) from day one.
- **Linking is first-class.** ADRs ↔ graph nodes ↔ rules is the data model, not an afterthought.
- **Offline mode.** Any LLM feature is disableable; parsing, linking, and rendering work with no LLM.

---

## Phase 19.1: Suggest — Generate ADRs from Existing Code `STATUS: DONE`

**The code → ADR workflow.** For a user who already has a codebase and wants ADRs, TrueCourse generates draft ADRs from the analyzed graph, presents them for review, and writes accepted drafts back to `docs/adr/`. This phase also ships the shared foundation (MADR parser, storage, Decisions tab, auto-linking, staleness) that every subsequent phase builds on.

Authoring ADRs from scratch (for empty-repo / ADR-first workflows) is Phase 19.5 — it ships after the full enforcement cycle (19.2–19.4) is proven on generated ADRs.

### Sub-status

- **Core suggest loop** (generation, review queue, accept/reject/edit, CLI + HTTP + UI, MADR parser/writer, structural staleness) — `STATUS: DONE`
- **Flows in the suggester's graph context** — `STATUS: DONE`
- **Living Fragments** (embedded `adr-graph` / `adr-flow` blocks, dashboard rendering, decision-time snapshots, fragment-driven staleness) — `STATUS: DONE`

Living Fragments differentiate TrueCourse-generated ADRs from hand-written ones: rather than prose that goes silently stale, ADR bodies render the exact subgraph and flows they're about, auto-updated against the current analysis.

### Generation (LLM)

Generation is the core of 19.1: given a repo with no ADRs, produce draft ADRs that describe the architectural decisions already embedded in the code.

- **Manual trigger.** The user starts a generation run by clicking **Suggest undocumented decisions** in the Decisions tab (or running `truecourse adr suggest`). Generation never runs automatically on analyze — LLM calls cost time and money, and drafts need explicit review.
- **What the LLM does.** It examines the code graph, the existing ADR corpus (initially empty), and the rejected-draft signatures, then proposes draft ADRs for architectural patterns that are (a) present in the code and (b) not already covered by an existing ADR.
- **Candidate topics.** Service boundaries, shared-database patterns, circular dependencies, facade modules, communication patterns (REST vs events), auth placement, caching strategies.
- **Output format.** Drafts are produced in **MADR** format with pre-filled context, decision, and consequences sections.
- **Linkage prefill.** Each draft includes the graph entities it's about (services, modules, files), which are stored on the draft and become `requiredEntities` + `linkedNodeIds` when the user accepts it.

### Noise control (non-negotiable from day one)

- **Topic-signature dedupe** — rejected drafts don't resurface on subsequent runs
- **Novelty filter** — LLM must justify why a decision is non-obvious; generic choices ("we chose React") don't qualify
- **Confidence threshold** — drafts below threshold are hidden; user can lower it to see more
- **Max drafts per run** — hard cap to avoid flooding the review queue
- Rejected-draft signatures persist in `.truecourse/adr-rejected.json`

### Review & export

- Drafts appear in a review queue in the Decisions tab
- User edits, accepts, or rejects each draft
- Accept → MADR file written to `docs/adr/` using `ADR-NNNN-<slug>.md` format; numbering auto-increments from the highest existing `ADR-NNNN-*` file we wrote in that directory (starts at `0001` in a fresh repo)
- The accepted file is immediately re-parsed and joins the corpus (same code path as any other MADR ADR)
- Export is an explicit user action — no auto-write
- Respecting non-default numbering schemes in pre-existing ADR directories is a BYO concern (see 19.6)

### Parsing

- MADR-only parser (full schema support: title, status, date, deciders, context, decision, consequences, supersedes/superseded-by)
- Malformed MADR files produce a clear error in the Decisions tab, not a silent skip

### Data model

- `Adr { id, number, title, status, date, path, sections, linkedNodeIds, supersedes, supersededBy, requiredEntities, sourceDraftId? }`
- `requiredEntities` — file/module/service names the ADR references, extracted by the LLM at draft time and preserved through accept
- Supersedes / superseded-by graph for decision lineage
- Persisted to `.truecourse/adrs.json` (gitignored, rebuilt on analyze)

### Linking (from LLM manifest)

- Each draft comes with an explicit `entities` list — the graph node IDs the LLM drafted about
- On accept, those IDs become `linkedNodeIds` on the ADR record (1:1 copy from manifest)
- No fuzzy matching, no confidence scoring in 19.1 — every link is valid by construction
- Manual adjustment after accept via `truecourse adr link <adr> <node>` / `adr unlink`
- Fuzzy matching for hand-authored and externally-authored prose is introduced in 19.5 (Add) and 19.6 (BYO), where confidence scoring also first becomes meaningful

### Staleness (structural)

- For each ADR, persist `requiredEntities` at link time
- On each analyze, check whether required entities still exist and still have the relationships the ADR asserts ("X depends on Y")
- Flag stale ADRs in the Decisions tab and on their detail panel
- Intent-based staleness ("the ADR's intent is violated") is deferred to 19.3

### Flows in the suggester's context `STATUS: DONE`

Today's `buildGraphSummary` passes services, service-to-service dependencies, top modules, and databases. Flows (request-handling sequences, cross-service call chains) are omitted, which leaves the LLM blind when drafting communication-pattern, service-boundary, and caching decisions — exactly the topics flows would clarify.

**Scope:**
- Extend `buildGraphSummary` to include a `Flows` section: name, trigger (http/event/cron/startup), entry service/method, step count, and the sequence of hops (source service → target service) for the top-N flows by step count.
- Pass the same summary into both survey and draft passes (no new prompt, just richer context).
- Keep the summary bounded — cap at ~15 flows or truncate step details so the context window doesn't bloat.

**Test:** fixture with a request-handling flow spanning 3 services → `suggest` run should surface the flow in the graph summary; LLM should be able to ground its "communication-pattern" draft in that concrete sequence rather than inventing one.

### Living Fragments `STATUS: DONE`

The feature that distinguishes TrueCourse-generated ADRs from hand-written ones. Rather than prose that describes structure in words and then silently drifts, ADR bodies embed **live subgraphs and flow references** that render against the current analysis and show drift inline.

#### On-disk syntax

Structured fenced blocks inside the MADR body:

~~~
```adr-graph
services: [auth-service, billing-service]
show: dependencies
```

```adr-flow
flowId: user-registration
```
~~~

- Plain-text readers (GitHub, VS Code) see the fenced block as readable YAML — not broken, just textual.
- Dashboard replaces each block with a live-rendered subgraph or flow diagram.
- Each block can appear in any section (Context is the usual place).

**Parameters (initial set):**
- `adr-graph`: `services` (array of ids/names), optional `modules`, optional `show: dependencies | modules | all` (default `dependencies`)
- `adr-flow`: `flowId` (required), optional `from-step` / `to-step` for slicing a long flow

#### Decision-time snapshot

At accept time, each fragment is resolved against the current graph and a compact snapshot is captured alongside the ADR's index entry:

```
FragmentSnapshot {
  kind: 'graph' | 'flow'
  locator: string                // the raw block parameters
  capturedAt: string             // ISO-8601
  nodes: Array<{ id, name, kind }>    // graph kind only
  edges: Array<{ source, target, count }>  // graph kind only
  steps: FlowStepRecord[]        // flow kind only
  graphHash: string              // hash of the captured subgraph for drift detection
}
```

Stored on `AdrIndexEntry.fragments: FragmentSnapshot[]` in `.truecourse/adrs.json`. Never written into the MADR file — the file stays human-readable.

#### Dashboard rendering

- Live-rendered subgraph reuses the existing React Flow + graph service. Filter to the fragment's node set; layout via the existing dagre pipeline.
- Flow blocks reuse the existing FlowDiagramPanel rendering, scoped to the flow id (and optional step range).
- **Side-by-side drift view** — render the decision-time snapshot next to the live view. When nodes/edges/steps differ, highlight additions / removals. Drift is the killer feature: readers see "this ADR decided X given Y services; you now have Z."
- Clicking any node in a fragment jumps to that node on the main graph (same pattern as the existing node-detail panel).

#### Generation (LLM)

Update the draft prompt so the LLM emits at most one `adr-graph` or `adr-flow` block per draft, placed in the Context section, showing the specific services/flows the decision is about. The suggester validates every block post-generation:
- All node ids/names resolve in the current graph
- `flowId` resolves in the current graph
- If any reference is invalid, strip the block (don't reject the whole draft — the prose may still be valuable)

#### Staleness integration

Structural staleness (already in the done core) extends to fragments:
- If any node in a fragment's snapshot no longer exists → ADR flagged stale with reason "fragment references removed entities"
- If a flow referenced by `flowId` no longer exists → same
- Drift alone (graph changed but nothing missing) does NOT flag stale — it's shown in the rendered view but isn't a staleness condition

#### Scope (what 19.1 Living Fragments does NOT do)

- No authoring UI for fragments from scratch — the LLM emits them during generation; hand-authoring is via MADR text editing (same as the rest of the body)
- No GitHub-renderable image fallback — plain readers see the fenced block as text. We can revisit a pre-rendered Mermaid fallback if GitHub-surface matters.
- No interactive-edit inside the dashboard — click-to-jump only. Editing a fragment means editing the MADR text.

### UI design

**Sidebar tab.** New **Decisions** tab alongside Services / Files / Rules. Tab header shows count chips: `Drafts: 3 · Accepted: 7 · Stale: 1`.

**Top bar of the tab.**
- Primary button: **"Suggest undocumented decisions"** (opens generation modal)
- Filters: status (All / Accepted / Superseded / Stale), linked service
- Toggle: **"Show ADR badges on graph"** (opt-in, off by default)
- *(The "New ADR" button for blank-slate authoring is added in Phase 19.5.)*

**Two-pane layout.**
- **Left — list.** Collapsible sections in order: *Review Queue* (drafts), *Accepted*, *Superseded*, *Stale*. Each row: status dot · `ADR-NNNN` · title · linked-nodes count.
- **Right — detail panel.** Full MADR body rendered as markdown, metadata strip (status, date, deciders), linked graph nodes as clickable chips (click → focus node on graph), supersedes chain (visual breadcrumb), staleness banner when applicable.

**Generation modal.**
- Triggered by "Suggest undocumented decisions"
- Fields: confidence threshold (slider), max drafts per run (number), optional topic hint (free text, e.g. "focus on data layer")
- Submit → streaming progress view (we already stream LLM CLI output); drafts appear in the Review Queue as they arrive
- Cancel mid-run supported

**Draft review row (inside Review Queue).**
- Inline **Accept · Edit · Reject** buttons
- Accept → confirmation showing target filename (`docs/adr/ADR-0003-<slug>.md`) before writing
- Edit → full-screen MADR editor with live markdown preview + frontmatter form fields
- Reject → persists topic signature to `.truecourse/adr-rejected.json`; draft disappears; not re-proposed on subsequent runs

**Graph integration.**
- Node detail panel (existing) gains a **Decisions** section listing linked ADRs with status dot + link
- When "Show ADR badges on graph" is on: a small badge dot on nodes with ≥1 linked ADR
- All links shown in the detail panel are authoritative (from the LLM manifest); there is no "suggested" sub-state in 19.1

### CLI design

Follows the existing subcommand pattern (`truecourse rules ...`). All commands are scriptable and accept `--json` for machine output.

```
truecourse adr suggest        # Interactive: LLM generates + user reviews drafts via @clack/prompts
  --threshold <0-1>           #   confidence floor (default: from config)
  --max <n>                   #   cap drafts per run
  --topic <hint>              #   optional focus hint
  --non-interactive           #   write drafts to .truecourse/drafts/ without prompting
  --json                      #   machine-readable output (implies non-interactive)

truecourse adr drafts         # List pending drafts in the review queue
truecourse adr accept <id>    # Accept a draft → writes ADR-NNNN-<slug>.md to docs/adr/
truecourse adr reject <id>    # Reject a draft → persists to adr-rejected.json
truecourse adr edit <id>      # Open a draft in $EDITOR, validate MADR on save
                              #   (editing accepted ADRs is added in 19.5)

truecourse adr list           # List accepted ADRs (--status, --linked-to <node>)
truecourse adr show <id>      # Print full MADR body + linked nodes + staleness
truecourse adr stale          # List stale ADRs with reasons

truecourse adr link <adr> <node>     # Manually add a link between an ADR and a graph node
truecourse adr unlink <adr> <node>   # Remove a link
```

*(`truecourse adr new` for blank-slate authoring is added in Phase 19.5.)*

**Interactive `suggest` flow** (mirrors `truecourse analyze` UX):
1. Runs analyze if the graph is stale
2. Streams LLM progress inline
3. For each draft: show title + summary + confidence, then prompt *Accept / Edit / Reject / Skip*
4. Accept writes the MADR file and prints the path; Edit opens `$EDITOR`; Reject persists the signature

**Headless `suggest --non-interactive --json`** (CI-friendly):
- Writes drafts as pending to `.truecourse/drafts/`
- Prints JSON array of `{draftId, title, confidence, targetPath, topicSignature}`
- Downstream tooling can pipe to `truecourse adr accept <id>` / `reject <id>`

**Config fields** (`.truecourse/config.json`) added in 19.1:
```
adr: {
  path: "docs/adr",          // output directory
  defaultThreshold: 0.6,
  maxDraftsPerRun: 5
}
```

**No graph-node badges by default** — opt-in via the UI toggle and via `truecourse adr list --with-badges` which prints linked-node IDs inline. Date-range filter deferred.

### Scope

- Only generates MADR; only parses MADR
- Only scans `docs/adr/` and configured `adrPath` in `.truecourse/config.json` (standard location + one override)
- No CI integration, no rule codification, no consistency/Q&A yet
- LLM disableable; if disabled, the tab still renders accepted ADRs (they're just files on disk) but the "Suggest undocumented decisions" action is hidden

### Test Plan (Phase 19.1)

**Core suggest loop** `STATUS: DONE`

- Fixture with a clear undocumented pattern (e.g., facade module) and no ADRs → generation produces a draft
- Fixture with patterns already covered by existing accepted ADRs → zero drafts
- Reject a draft → re-run generation → rejected topic does not reappear
- Accept a draft → MADR file written with correct `ADR-NNNN-slug.md` numbering, parseable on reload
- Linking: the LLM's `entities` manifest for each accepted draft maps directly to `linkedNodeIds` (no fuzzy matching in 19.1)
- Structural staleness: removing an entity from `requiredEntities` flags the ADR stale on next analyze
- Supersedes chain renders correctly (seeded via test fixtures)
- Malformed MADR file → visible error card, not silent skip
- Confidence threshold hides low-confidence drafts
- Max-drafts cap enforced
- `pnpm build` and `pnpm test` pass

**Flows in suggester context** `STATUS: DONE`

- `buildGraphSummary` output includes a `Flows` section when the graph has flows
- Top-N cap enforced — no context-window blow-up on repos with hundreds of flows
- Mocked-LLM suggester test: when graph has a multi-service flow, the captured survey prompt includes the flow summary

**Living Fragments** `STATUS: DONE`

- `adr-graph` block parsed out of a MADR body: node references resolve in the graph → snapshot captured on accept
- `adr-flow` block parsed with a valid `flowId` → snapshot captured on accept
- Invalid references (unknown service name, unknown flowId) → block stripped from the drafted body (core draft stays), warning logged
- Decision-time snapshot persists in `.truecourse/adrs.json` under `fragments: []`
- Dashboard renders an `adr-graph` block as a filtered subgraph (React Flow) with drift highlighting vs the snapshot
- Dashboard renders an `adr-flow` block via the existing FlowDiagramPanel scoped to the flow id
- Fragment-driven staleness: deleting a node referenced by a fragment flags the ADR stale with reason "fragment references removed entities"
- Drift without deletion (graph has new edges but fragment nodes still exist) → NOT flagged stale, visible in rendered view only

### Verification (Phase 19.1)

**Core suggest loop** (done):

1. Run TrueCourse on a fixture repo with no ADRs → click "Suggest undocumented decisions" → drafts appear
2. Edit + accept a draft → `docs/adr/ADR-0001-*.md` written → re-parsed → appears in accepted list with links to graph nodes
3. Click a linked graph node → ADR appears in the node's detail panel
4. Reject a draft, re-run generation → rejected topic does not reappear
5. Manually remove an entity from the graph that an ADR references → stale flag appears
6. Filter by status works; graph-node badge toggle works

**Flows + Living Fragments** (pending):

7. On a fixture with a cross-service HTTP flow, run `suggest` → one of the drafts references the flow by name, grounded in the actual step sequence
8. Accept a draft that includes an `adr-graph` block → dashboard renders the subgraph; `adrs.json` has a matching `FragmentSnapshot`
9. Accept a draft that includes an `adr-flow` block → dashboard renders the flow diagram for the referenced flow
10. Modify the code to add a new service-to-service dependency touching the fragment's nodes → re-run analyze → dashboard shows drift highlighting ("new edge since decision") but ADR is NOT flagged stale
11. Delete a service referenced by a fragment → re-run analyze → ADR is flagged stale with a fragment-specific reason

---

## Phase 19.2: ADR → Rule Codification `STATUS: BACKLOG`

Turn accepted ADR prose into enforced detection rules. The feature that distinguishes us from "yet another ADR viewer."

### Design

- Per-ADR action **"Codify as rule"** in the detail panel
- LLM reads the ADR's decision and consequences sections and proposes one or more candidate rules in our existing rule format (see `packages/analyzer/src/patterns/`)
- Candidates include: rule name, severity, rationale, pattern (AST/tree-sitter query or TS-Compiler predicate), back-reference to the source ADR
- User reviews each candidate — edits, accepts, or rejects
- Accepted candidates are written as first-class rules; their explanation cites the source ADR

### Data model

- Rules gain optional `sourceAdrId` and `sourceAdrSection` fields
- ADRs gain `enforcedRuleIds` — the list of rules codified from this ADR
- Detail panel shows "Enforced by: N rules" with clickable links

### Scope

- Works on any accepted MADR ADR (generated or otherwise)
- Candidate rules are always reviewed — never silently added to the catalog
- Rules generated here are per-repo, not pushed to the global catalog
- LLM-disableable

### Test Plan (Phase 19.2) `STATUS: BACKLOG`

- ADR stating "API handlers must not import from `db/*`" → candidate rule flags exactly that pattern
- Accepted rule fires on a fixture violating it, does not fire on compliant code
- False-positive rate is 0% on a realistic fixture before acceptance
- Rejected candidates leave no trace
- `pnpm build` and `pnpm test` pass

### Verification (Phase 19.2)

1. Click "Codify as rule" on an accepted ADR → candidate rule(s) appear in review panel
2. Edit + accept → rule added, fires on next analyze
3. Run `truecourse diff-check` on a PR violating the rule → output cites the source ADR
4. ADR detail panel shows "Enforced by: N rules" with correct links
5. Rejecting a candidate → no persistence

---

## Phase 19.3: Consistency Checks `STATUS: BACKLOG`

Automated LLM pass over the ADR corpus after analyze, surfacing contradictions and intent-level staleness as warnings. No chat UI — interactive Q&A over ADRs is handled by the Claude Code skill (19.7), which sits in a surface the user already has open.

### Design

- **Retrieval-augmented, not pairwise.** Embedding-based clustering rather than O(n²) LLM-compares-every-pair. For each ADR compute an embedding over title + decision + consequences; use cosine similarity to pick its top-K most similar siblings; run one LLM call per ADR that compares it against that local cluster. Scales to hundreds of ADRs without quadratic LLM cost. (Rationale: research on ADR generation shows retrieval-augmented context consistently outperforms "all history" and wins on cost — arxiv 2604.03826v2.)
- The LLM is asked to flag two classes of issue per cluster: **inter-ADR contradiction** (two decisions that can't both hold) and **intent violation** (an ADR's decision is no longer honored by the current code graph, beyond structural staleness — e.g., ADR says "all writes go through repository layer" but graph shows direct writes from handlers).
- Contradictions and intent violations surface as warnings in the Decisions tab with a summary and the involved ADR IDs.
- Results cached per (embedding-hash, cluster-hash, graph-hash) triple — re-running analyze without changes triggers no extra LLM calls.

### Embedding choice (open during 19.3 impl)

- Two candidates: (a) local model via `@xenova/transformers` (no network, no provider dep); (b) OpenAI / Anthropic / another provider embedding API (higher quality, runtime cost, privacy considerations). Default: local. Swap-out point: a single `EmbeddingProvider` interface, decided alongside the suggester's LLM provider.
- Store embeddings on `.truecourse/adr-embeddings.json` keyed by ADR id; rebuilt when the MADR file's hash changes.

### Scope

- LLM-disableable (no warnings when disabled)
- No write operations on the ADR files themselves
- No chat / conversational surface in TrueCourse — user questions about ADRs go through Claude Code via the 19.7 skill
- Cache invalidates when any ADR file changes or on major graph changes

### Test Plan (Phase 19.3) `STATUS: BACKLOG`

- Two ADRs with contradictory decisions → inconsistency flagged (and both land in each other's similarity cluster)
- ADR asserting "X depends on Y" when the graph shows Y depends on X → flagged
- ADR asserting an intent ("no direct writes from handlers") violated by current code → flagged even when all referenced entities still exist
- Corpus of 100+ ADRs completes in O(n) LLM calls, not O(n²)
- Cache hit on re-analyze without changes (no extra LLM calls, no re-embed)
- `pnpm build` and `pnpm test` pass

### Verification (Phase 19.3)

1. Seed two contradictory ADRs → warning appears in Decisions tab
2. Introduce an intent violation in code → warning appears on the relevant ADR
3. Re-run analyze without changes → no extra LLM calls and no re-embed
4. Disable LLM in config → warnings pane hides cleanly
5. Seed 50 ADRs → LLM call count is ~50, not ~2500

---

## Phase 19.4: Diff Integration `STATUS: BACKLOG`

Surface ADRs where engineers actually work — PRs and diff-checks.

### Design

- `truecourse diff-check` gains ADR awareness:
  - Changed file linked to ADRs → list them ("This change touches code governed by ADR-0003, ADR-0012")
  - Change violates a codified rule (19.2) → cite the source ADR in the violation
  - Change removes/renames an entity in an ADR's `requiredEntities` → flag the ADR as potentially stale
- New `--adr-strict` flag: non-zero exit on unresolved ADR concerns (CI opt-in)
- Dashboard diff view shows the same info inline with the diff

### Scope

- No auto-generation of drafts from diffs
- CI integration via existing `diff-check` exit code — no new surface

### Test Plan (Phase 19.4) `STATUS: BACKLOG`

- PR touching a linked file → diff-check mentions the ADR
- PR violating a codified rule → diff-check cites the ADR
- PR removing an entity from `requiredEntities` → ADR flagged stale
- `--adr-strict` exits non-zero on unresolved concerns, zero otherwise
- `pnpm build` and `pnpm test` pass

### Verification (Phase 19.4)

1. PR modifying a linked file → diff-check mentions the linked ADR
2. PR violating a codified rule → output cites the ADR
3. Dashboard diff view shows the same information

---

## Phase 19.5: Add — Author ADRs From Scratch `STATUS: BACKLOG`

**The blank-slate authoring workflow.** For users writing ADRs by hand — greenfield projects, ADR-first workflows, or teams who know what decision they want to document without any LLM suggestion. Reuses the parser, storage, Decisions tab, linking, and staleness infrastructure from 19.1, and slots in alongside the codification / consistency / diff features proven on generated ADRs (19.2–19.4).

### UI additions

- **"New ADR"** button in the Decisions tab top bar (alongside "Suggest undocumented decisions")
- Click → modal with a blank MADR editor: frontmatter form fields (title, status, deciders, date) + markdown body panes for context / decision / consequences
- Live MADR validation while editing (missing required sections highlighted)
- Save → writes `docs/adr/ADR-NNNN-<slug>.md` using the standard numbering, parses, appears in the Accepted list
- Status defaults to `proposed`; user sets to `accepted` when the ADR is ratified
- Editing accepted ADRs: detail panel gains an **Edit** action that opens the same editor against the existing file

### CLI additions

```
truecourse adr new [title]    # Open $EDITOR with a MADR template
                              #   writes docs/adr/ADR-NNNN-<slug>.md on save
  --status <status>           #   default: proposed
  --from-stdin                #   read MADR body from stdin (piping friendly)
```

- `truecourse adr edit <id>` (introduced in 19.1 for drafts) extends to accepted ADRs

### Scope

- No LLM involvement — this is a pure editor path
- MADR only (matches 19.1)
- Numbering increments from existing `ADR-NNNN-*` files the user has accepted (respecting external numbering schemes is 19.6)
- Supersedes relationships can be set manually via a frontmatter field in the editor
- Hand-authored ADRs are first-class inputs to 19.2 (rule codification), 19.3 (consistency/Q&A), and 19.4 (diff integration) — same corpus, same pipelines

### Test Plan (Phase 19.5) `STATUS: BACKLOG`

- "New ADR" modal opens, saves a valid MADR file to `docs/adr/`, and the file appears in the Accepted list
- `truecourse adr new` opens `$EDITOR` with a MADR template; save writes the file; Ctrl-C aborts without writing
- `truecourse adr new --from-stdin` reads MADR from stdin and writes it
- Editing an accepted ADR updates the file; staleness/link state recomputes on save
- Invalid MADR on save → clear error, no file written
- Supersedes field set in the editor → supersedes chain renders correctly in the detail panel
- Hand-authored ADR flows cleanly through "Codify as rule" (19.2), consistency check (19.3), diff-check (19.4)
- `pnpm build` and `pnpm test` pass

### Verification (Phase 19.5)

1. Click "New ADR" in an empty repo → editor opens → fill in → save → `docs/adr/ADR-0001-<slug>.md` written and appears in list
2. `truecourse adr new "Use event bus"` in CLI → `$EDITOR` opens with MADR template prefilled with title → save → file written
3. Edit an accepted ADR to set `supersedes: ADR-0001` → chain renders
4. Author a malformed ADR → save errors out with specifics, no partial file
5. Codify a hand-authored ADR as a rule → rule fires correctly (confirms 19.2 works identically on hand-authored input)

---

## Phase 19.6: BYO — External & Legacy ADR Support `STATUS: BACKLOG`

Once the core loop is proven with generated ADRs, extend detection/parsing to handle ADRs authored outside TrueCourse.

### Expanded detection

- Additional standard locations: `docs/decisions/`, `adr/`, `architecture/decisions/`
- Multiple configured `adrPaths` (array, not single override)
- Ignore/include globs in `.truecourse/config.json`

### Expanded parsing

- **Nygard format** — best-effort heading-based extraction (title/status/context/decision/consequences), with clear error surfacing for missing sections
- Custom numbering schemes (`0001-*.md`, `ADR-0001-*.md`, `adr-0001.md`) — detect scheme per directory, preserve on new writes
- Malformed / partial ADRs → visible error card with a "what we could extract" preview
- **External references (`externalRefs: string[]` on `Adr`).** Hand-written ADRs commonly reference Confluence, wikis, issue trackers, RFC docs — "documentation debt" in arxiv 2604.03826v2's terms. Extract URLs from Context / Decision / Consequences at parse time and preserve on the record so the UI can render them as outbound links. Generated ADRs may also carry these if the agent cites external sources. Does not affect staleness or linking — purely a captured sidecar for UI and Q&A grounding.

### Auto-linking tuning

- Fuzzy match retuned for human-authored prose (more variance, informal entity names)
- Confidence scoring calibrated against a corpus of real external ADRs

### Migration helper

- "Import existing ADRs" action: scans the repo for non-standard ADR locations, offers to bring them into the corpus with user confirmation

### Scope

- No format changes to ADRs we write — MADR remains canonical
- Nygard is read-only: we never write Nygard ADRs, even when editing an imported one (edits convert to MADR on save, with user confirmation)

### Test Plan (Phase 19.6) `STATUS: BACKLOG`

- Nygard-formatted ADR with all standard headings → parsed correctly
- Nygard ADR with missing headings → visible warnings, partial extraction
- ADRs under custom paths discovered when configured
- Custom numbering scheme preserved on new ADR writes in that directory
- "Import existing ADRs" helper finds and imports ADRs in non-standard locations
- Editing an imported Nygard ADR → confirmation prompt before converting to MADR
- `pnpm build` and `pnpm test` pass

### Verification (Phase 19.6)

1. Repo with Nygard ADRs in `architecture/decisions/` → detected, parsed, rendered
2. Malformed ADR → error card with partial extraction visible
3. Custom numbering scheme respected when new ADRs are accepted into that directory
4. Import helper finds ADRs in a non-standard location and offers confirmation

---

## Phase 19.7: AI Agent Integration — ADR Skill (Claude Code first) `STATUS: BACKLOG`

Integrate ADRs into whatever AI coding agent the user already has open, rather than building conversation/codegen UIs inside TrueCourse. Ship Claude Code as the first provider; the same pattern (provider-specific adapter over a neutral read/write surface) extends to other agents in future phases.

This phase stays on TrueCourse's thesis — *understand, enforce* — and defers *create, modify, converse* to the agent, which is already in that space.

### Provider-neutral architecture

- **TrueCourse exposes a neutral surface.** JSON-read commands (`adr list --json`, `adr show --json`, `adr relevant-to <path> --json`) and file conventions (`docs/adr/ADR-NNNN-*.md` in MADR), both stable contracts.
- **Each provider gets a thin adapter** that teaches it how to use the surface: for Claude Code, that's a skill markdown file at `.claude/skills/truecourse-adrs/SKILL.md`; for other providers (e.g., Cursor, Cline, Aider, or future Anthropic-sanctioned agents), a future phase adds an equivalent adapter (rule file, config entry, etc.).
- **No provider-specific logic in TrueCourse itself** beyond the installer — the surface is the contract.

### What ships in 19.7 (Claude Code first)

A skill installed via `truecourse install-skill truecourse-adrs` following the repo's existing skill-install pattern under `.claude/skills/`. The skill teaches Claude Code three capabilities:

1. **Read ADRs before coding.** Before producing or modifying code, the agent consults the ADR corpus, identifies decisions relevant to the task, and honors their constraints. Violations are called out in the agent's response rather than silently produced.
2. **Author ADRs from conversation.** When the user is designing something new in chat, the agent can propose and write a MADR ADR to `docs/adr/` directly — seeding the corpus for an ADR-first project.
3. **Answer questions about architectural decisions.** "Why did we choose Postgres?" / "What constrains how we handle auth?" — the agent answers from the ADR corpus + linked graph nodes, citing ADR IDs. If no ADR covers the question, it says so rather than hallucinating. This replaces a dedicated Q&A UI inside TrueCourse.

### Skill design

**Location.** `.claude/skills/truecourse-adrs/SKILL.md`.

**What the skill tells the agent:**
- Where the corpus lives: `.truecourse/adrs.json` (parsed index) and `docs/adr/*.md` (source files)
- The MADR schema and how to read/author it
- A decision protocol before code changes: *find relevant ADRs → summarize constraints → produce code that respects them → cite the ADRs in the response*
- A Q&A protocol: *given a question, retrieve relevant ADRs via `adr relevant-to` or keyword search of the corpus, answer citing ADR IDs, explicitly say "no ADR covers this" when the corpus is silent*
- **A criteria-first chained authoring protocol** (for authoring a new ADR from design conversation). Adapted from Salesforce's "human-led, AI-powered" workflow — the agent does NOT jump to a final MADR in one shot. The sequence:
  1. **Elicit criteria.** Generate a list of candidate assessment criteria grounded in the decision's context (service boundaries, data ownership, failure modes, operational cost, etc.). Present to the user.
  2. **Refine criteria (human).** Wait for the user to edit/add/prune. The user's project-specific nuance matters more than the agent's generic list.
  3. **Compare options.** For each candidate option, produce a side-by-side table scoring it against the refined criteria using Low / Medium / High risk ratings.
  4. **Challenge (human).** Wait for the user to override assumptions. The agent must accept overrides without re-litigating.
  5. **Draft.** Only then, draft the full MADR — context, decision, consequences — using the refined criteria and final comparison as the skeleton.
  Skip the chain only if the user explicitly says "just draft it."
- How to author a new ADR file on disk: *write to `docs/adr/ADR-NNNN-<slug>.md` with next available number → set `status: proposed` until user accepts*
- How to validate: `truecourse diff-check --adr-strict` — on failure, read the output and reconcile the code with the cited ADR
- Explicit **don'ts**: never silently violate an ADR; never mark `status: accepted` on authored ADRs (user does that); never rewrite an existing ADR's decision (that requires a supersedes chain); never skip the criteria-first chain above unless the user explicitly opts out

### TrueCourse-side support

- **Installer.** `truecourse install-skill truecourse-adrs` writes the skill into `.claude/skills/` using the existing installer pattern.
- **Read endpoints.** `truecourse adr list --json`, `truecourse adr show <id> --json` (from 19.1), plus new `truecourse adr relevant-to <path> --json` returning ADRs linked to the given file.
- **Agent-authored ADRs** flow through the same parsing/linking pipeline as human-authored ones — no special case.

### Workflows the skill unlocks

**ADR-first greenfield:** empty repo → `install-skill` → user chats with the agent about a new service → agent writes ADRs to `docs/adr/` → user reviews in Decisions tab → agent scaffolds code honoring those ADRs → `analyze` + `diff-check --adr-strict` validate.

**Ongoing code changes:** user asks the agent to add a feature → skill prompts the agent to find relevant ADRs first and honor them → post-change `diff-check --adr-strict` → on failure, agent cites the ADR and asks the user how to reconcile.

**Q&A:** user asks the agent "why did we choose X?" → agent retrieves relevant ADRs and answers with citations, or says no ADR covers it.

### Scope

- We ship only the skill, not a code generator or a Q&A UI
- The skill is stateless markdown + the existing CLI — no new runtime component in TrueCourse
- Version compatibility: skill pins a minimum TrueCourse version in its metadata
- Works with any Claude Code installation that supports skills
- **Other providers are out of scope for 19.7** — adding Cursor / Cline / Aider / etc. adapters is a follow-up phase (19.8+) once the Claude Code skill is validated; the neutral surface defined here is designed to support them

### Test Plan (Phase 19.7) `STATUS: BACKLOG`

- `truecourse install-skill truecourse-adrs` installs to the correct `.claude/skills/` location
- Skill content validates against Claude Code's skill schema
- `truecourse adr relevant-to <path> --json` returns ADRs linked to the given file
- Manual integration test: fresh repo + skill → ask the agent to design a feature → ADR file appears in `docs/adr/` with valid MADR
- Manual integration test: existing ADR says "no direct DB access from API layer" → ask the agent to add a handler → it respects the constraint or flags the conflict
- Manual integration test: ask the agent "why did we choose X?" with a relevant ADR in the corpus → cites the ADR; with no relevant ADR → says "no ADR covers this"
- `pnpm build` and `pnpm test` pass

### Verification (Phase 19.7)

1. Fresh repo, install skill, converse with the agent about a new service → ADR file written, appears in Decisions tab
2. Ask the agent to scaffold code from the ADR → scaffolded code respects the constraints; links form on next analyze
3. Ask the agent to make a change that would violate an ADR → it flags the conflict instead of silently producing it
4. Ask the agent an architectural question → correct ADR citation or honest "no ADR covers this"
5. `diff-check --adr-strict` correctly gates problematic changes during the agent's workflow

---

## Cross-cutting concerns

### Storage

- `.truecourse/adrs.json` — parsed ADR corpus + link graph (gitignored, rebuilt on analyze)
- `.truecourse/adr-rejected.json` — rejected draft signatures (gitignored)
- No new global state under `~/.truecourse/`

### Offline mode

- Parsing, rendering, linking, and structural staleness work with zero LLM calls
- Generation (19.1), rule codification (19.2), and consistency checks (19.3) are gated by `config.llm` and surface no UI when disabled
- Q&A (19.7) runs entirely inside the user's AI agent, so TrueCourse's `config.llm` doesn't apply — disabling TrueCourse's LLM still leaves the agent skill fully functional as long as the agent itself has access
- Accepted ADR files remain readable and linkable regardless of LLM state

### Competitive positioning

- 19.1 delivers a feature no existing ADR tool has: generate the first ADRs from existing code
- 19.2 is the enforcement differentiator — codify decisions into rules
- 19.3 + 19.4 integrate ADRs into daily developer workflow (consistency warnings, PR checks)
- 19.5 adds a clean first-class authoring path for ADR-first workflows, built on a pipeline already proven with generated ADRs
- 19.6 closes the loop for teams that already write ADRs in other tools
- 19.7 pushes ADR intelligence (codegen, authoring-by-chat, Q&A) into the user's existing AI agent rather than rebuilding those surfaces in TrueCourse — agent does the conversational work, we provide the guardrails and data surface. Claude Code first; the neutral surface extends to other agents in follow-up phases.

---

## Open questions

- Should codified rules (19.2) be shareable across repos via the global catalog, or strictly per-repo? Default per-repo; revisit after dogfooding.
- Staleness UX: passive flag vs. required acknowledgement? Starting passive, can escalate if users ignore stale ADRs.
- Generation prompt strategy: single-pass (one LLM call proposes all drafts) vs. agent-style (LLM surveys graph, then drafts per topic). Single-pass is simpler; agent-style is likely higher quality. Decide during 19.1 implementation based on draft quality.
- Q&A scope (defined per-provider in the skill): ADRs only, or ADRs + linked code? Starting ADRs + linked code; wider scope risks hallucination. Re-evaluate per provider as adapters are added.
- Future-provider adapters (Cursor, Cline, Aider, others): which to prioritize after Claude Code? Depends on user pull after 19.7 ships.
