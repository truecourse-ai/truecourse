# Agentic Pipeline Plan — spec scan, guard setup, and guard generate as agent sessions

The plan of record for rebuilding the spec-to-scenario pipeline's LLM cores
from staged one-shot prompting into agentic sessions over one owned agent
loop. Scope: THREE commands, one architecture — `spec scan`, `guard setup`,
and `guard generate`. This document is SELF-COMPLETE: implementation agents
work from it alone, and anything load-bearing from earlier plans lives in
here, never by reference.

This plan supersedes all earlier plans within its scope; implementation
restarts from scratch.

STATUS: document under extension. Structure: §§1–3 are the common
foundations every workstream shares (why, ontology, the agent loop); §4 is
the reference corpus, the hand-authored ideal output that comes first and
becomes the benchmark once confirmed; §5 is Phase 0, the shared
precondition that narrows the engine (drivers arrive reference-first, in
the order CLI → API → web), landing in parallel with the reference work;
§§6–8 are the three workstreams — Spec Scan, Guard Setup, and Guard
Generate — each owned by one developer on this shared branch and written to
stand alone like its own doc: problems, sessions, and implementation
details all live inside the owning section; §9 is the Guard Run
workstream (the deterministic runner and run store); §10 is the Web
Driver workstream (browser-driven verification, after API).
Each owner extends their own section; do not start implementation from a
workstream section until its owner marks it ready. One carve-out
(decision 2026-08-06): the store schemas, the runner's execution of
them, and the dashboard views for every ontology layer are implemented
ahead of the workstreams, so the reference corpus (§4) is fully
representable, runnable, and reviewable. How that data is GENERATED (the
agent sessions of §§6–8) remains reserved for the owners.

## 1. Why (the problem, from field evidence)

Two from-scratch field runs on the TrueCourse corpus exposed a structural trap,
not a bug list:

- **Judgment arrives after the machinery shut down.** Triage (the "is this
  failure the test's fault?" verdict) runs once, after the last execution
  round. Its verdicts — 51 of them in one run — can only be written down as
  "re-author next generate". 33 of 106 flows ended one run with no scenario,
  no gap, and a "Not generated" chip. The user runs a tool once; a tool that
  ends with silent homework is broken (issue #861's core complaint, still
  standing after its first fix round).
- **The author is the same model that diagnoses these failures instantly when
  allowed to act — and we forbid it.** Authoring calls are one-shot, tool-less,
  sealed-context ("You have NO tools and NO repository access"). When the
  guess is wrong we build another deterministic stage to package more context
  for the next guess (grammar blocks, evidence retries, partition calls,
  grounding probes). Every edge case becomes a new engine feature; the fixes
  compound instead of converging.
- **A single malformed reply strands a flow.** One authoring reply with broken
  JSON ended a flow for the whole run, with a red chip and no recovery — a
  conversation would have shrugged it off.
- **The multi-model cost split is a false economy.** Cheap models produce
  broken artifacts whose retries, judgments, and re-authors are paid at
  premium prices. A meaningful fraction of a $124 run purchased work that was
  then thrown away.

## 2. Ontology (final; decisions of 2026-08-06)

| layer | is | derived from | role |
|---|---|---|---|
| **claim** | one testable sentence, identity = doc+anchor+title | docs | the unit of meaning and coverage |
| **flow** | an ordered grouping of claims (a user journey) | docs (synthesis) | WHAT to verify |
| **journey** | the code-derived public contract: command tree with full grammar (flags, requiredness, values, choices) plus each command's input/output contract (consumes: args, stdin, read state; produces: stdout, written state, exit codes), API operations with schemas | code (deterministic extraction) | WITH WHAT to verify |
| **scenario** | setup + ordered steps in a sandbox; milestone-tagged steps prove claims | authored from flow × journeys | HOW to verify |
| **sandbox** | fresh, hermetic execution | runner | the judge of record |

Binding decisions:

- **One flow ↔ one scenario per surface.** No `.2` files. Partial coverage
  stays per-milestone inside the one scenario (a blocked claim is a
  milestone-scoped gap, and the scenario grows when blockers clear).
  Supersedes the N-files requirement briefly recorded on #868.
- **The driver belongs to the STEP, not the scenario** (foundational;
  decided 2026-08-09). A scenario is driver-agnostic: each step declares
  how it acts (a CLI invocation, an API request), and the sandbox is ONE
  world that can both start the service and run the CLI — because real
  promises span surfaces ("create it through the API, the CLI lists it")
  and a scenario locked to one driver cannot state them. The
  scenario-level driver is derived, "the drivers its steps use". Every
  workstream designs against this; nothing new may deepen the
  scenario-level-driver assumption. Migration details (what "per
  surface" coverage counts under mixed scenarios) live with the §9
  entry.
- **The word is "scenario", never "test"**, in every user-facing surface (CLI
  copy, dashboard copy, summaries, docs). "passing/failing" remain the verdict
  words.
- **Scenarios are built from flows and journeys, never from source code.**
  Journeys are the only bridge from code. This keeps every scenario
  user-replayable (public surface only), keeps inputs fingerprintable
  (incrementality survives), and concentrates argument/contract defects in the
  journey mapper where one fix heals every flow. A worker that discovers the
  sandbox contradicting a journey reports a **journey defect** — the feedback
  loop that improves the contract layer.
- **Coverage accounting is claim-keyed.** A flow's status is an aggregation
  over its claims' proof states; chips derive from claim states, which always
  exist — no mute "Not generated".

## 3. The agent loop (common infrastructure)

The loop — turn budget, tool dispatch, transcript, malformed-turn re-ask,
streaming — is written **once**, and every workstream builds its sessions
on it. The provider seam stays where it is today: a single turn.

### 3.1 One loop, two transport modes

- `LlmTransport` grows a turn-level call: messages + tool results in, next
  reply (text or tool call) out.
- **claude-code mode**: `claude -p` per turn with `--resume <session>` — the
  session keeps server-side context; our loop keeps client-side control. Same
  binary, same login, same stream-json parsing.
- **api / EE mode**: the AI SDK's native tool-calling per turn. EE inherits via
  `ee-llm` re-exporting `llm-api`, as today.
- The Claude Agent SDK is **not** used: it is a second loop, and Claude-only.

### 3.2 The only LLM call shape

**The loop is the pipeline's only LLM call shape** (decision 2026-08-06).
Every LLM task in every command runs as an agent session: it gets a prompt
(the task's role and rules), inputs, and tools; it acts, ingests what its
tools return, and revises until it reaches a structured outcome. No stage
may be structurally limited to a single prompt; a task simple enough to
converge in one turn simply converges in one turn. Session budgets, the
malformed-turn re-ask policy, and the outcome requirement (a session cannot
end without a structured outcome) apply uniformly. Where an earlier design
describes an LLM stage as one-shot or "unchanged", this decision supersedes
the CALL SHAPE only: the stage's job and its deterministic parts stay. Each
workstream section defines its sessions: prompt, inputs, tools, and
done-condition per task.

### 3.3 Loop implementation decisions (2026-08-05)

Decisions made at implementation start; they bind the loop work. Every
decision below covers BOTH transport modes; only claude-code mode needed a
spike, because api mode's turn mechanics were already known.

**claude-code session mechanics (spike result).**
`claude -p --resume <session-id>` retains full server-side
context across print-mode invocations (verified live). Mechanics: the prompt
goes over **stdin** (the variadic `--tools` flag would swallow a trailing
positional); turn 1 passes `--session-id <uuid>`, later turns `--resume <id>`;
`--system-prompt` is re-passed on **every** turn (cheap, and removes any
dependency on resume re-applying it); `--no-session-persistence` is never
passed. The full-context-resend fallback is not needed.

**api session mechanics.** There is no server-side session to resume: the
api adapter resends the full message history on every turn and uses the AI
SDK's native tool calling. Per-turn prompt caching rides `cache_control`;
per-turn usage is recorded identically to claude-code mode. EE inherits
this adapter unchanged.

**Seam shape.** `LlmTransport` stays `(req) => Promise<string>`. The turn
call is an **optional property on the transport function**:
`transport.turn?: LlmTurnFn`. Every existing bare-function transport (and the
~30 test fakes) stays valid; a consumer that needs turns checks for the
property. `LlmTurnFn` takes the **full message history** plus an opaque
`sessionId` and returns the next reply — normalized to
`{ text }` or `{ toolCall: {name, arguments} }` plus the new `sessionId` and
per-turn usage. The claude-code adapter sends only the newest message under
`--resume` (the session carries history server-side); the api adapter resends
the whole history with AI SDK native tools. Per-turn usage feeds
`recordStageUsage` exactly as today; `calls` counts turns.

**Tool-call representation.** api mode: native AI SDK tool calling —
tools declared without `execute`, one step per turn, the SDK returns the tool
call without running it. claude-code mode: a **text action protocol** — the
system prompt requires each reply to end with exactly one fenced JSON action,
either `{"tool": "<name>", "args": {...}}` or `{"outcome": {...}}`; the loop
extracts it with the existing balanced-JSON parser. The loop owns
normalization: native tool call when present, text parse otherwise.

**Malformed-turn policy.** A turn whose action cannot be parsed or fails the
tool/outcome schema gets **one re-ask** (invalid output quoted back, same
turn budget); two consecutive malformed turns end the session with a
structured `malformed` failure — never an exception, never a stranded task.

**Module placement.** The loop (`runAgentLoop`: turn budget, token ceiling,
tool dispatch, transcript events, re-ask) lives in
`packages/shared/src/llm/agent-loop.ts` — transport-agnostic, next to the
seam, exported through `transport.ts` like `guardrail.ts`. The claude-code
turn adapter lives beside `cliTransport` in `transport.ts`; the api turn
adapter in `packages/llm-api` (the only OSS package allowed to import `ai`).
The loop emits transcript events (system, turn, reply, tool result, re-ask,
outcome, budget-exhaustion) through a sink callback; consumers wire the sink
to their transcript artifacts.

**Delivery (decision 2026-08-07).** The loop is shared infrastructure
built ONCE, BEFORE the workstreams, and shared by §§6–8; no workstream
builds loop machinery of its own. This supersedes the loop's slotting
inside §8.9 Phase 1 — that phase consumes the shared module rather than
producing it.

### 3.4 Model policy (decision 2026-08-06)

One model everywhere. Every session in every workstream (authoring,
judging, curating, discovering) runs on the same capable model: Opus in
claude-code mode, the configured flagship equivalent in api mode.

The multi-model cost split is retired, not just discouraged. Field
experience (§1) showed it is a false economy, and the deeper reason is
compounding: a smaller model's mistakes do not stay local; they become
malformed inputs that every later step must diagnose, retry, and repair at
the strong model's prices. Per-stage model tiers, and the earlier policy
"cheap models only judge", are superseded. If a genuinely cheap step ever
earns an exception, it is proposed per case with evidence, never assumed.

### 3.5 Pre-flight estimation (needs rework)

Sessions break the current estimator's core assumption of fixed per-stage
call counts, so the estimate is rebuilt rather than patched:

- The unit of estimation becomes the session: work items (docs, areas,
  flows) × a [min, max] turn range from each session type's budget, at
  the one model's prices (§3.4 makes pricing single-model).
- Estimates stay cache-aware and honest: unchanged work is excluded and
  labeled ("N of M changed"), and when nothing changed the confirm prompt
  is skipped, as today.
- Ranges are honest about variance: a session that can take 2 or 8 turns
  is presented as that range, never as an average dressed up as a fact.
- **Each workstream defines its own estimation algorithm** in its section,
  as part of its design: which session types run, over which work items,
  with which turn ranges, and what its caches exclude. This common section
  fixes only the principles and the presentation shape, so all three
  commands present the same estimate shape to the user.

## 4. The reference corpus (the benchmark)

The first work of the plan. The corpus is hand-authored and depends on
nothing (no engine, no Phase 0), so it starts immediately and proceeds
while Phase 0 lands. Its scope grows driver by driver, in the §5 order:
the CLI surface first, then the API surface, then web (§10) — each new
driver enters the corpus the same way (hand-authored journeys, flows, and
scenarios, reviewed in the dashboard, run by the real runner) before any
generation is designed for it.

We hand-author the IDEAL output for one real repository: TrueCourse
itself. The spec source (decision 2026-08-06) is TrueCourse's published
documentation site (the Mintlify-hosted docs): the documentation users
actually read, and what claims anchor to. Repo files like the README are
not the spec source. Every layer of §2 is authored and mapped by hand,
then reviewed and confirmed by the user:

- the curated spec: kept docs, areas, and the claims extracted from them,
  each claim anchored to its doc section;
- the journeys of the TrueCourse CLI: full argument grammar plus each
  command's input/output contract;
- the flows, mapped to the claims they carry: happy paths, edge and
  corner cases, and a flow per supported configuration path (the coverage
  rules of §8.2);
- the scenarios that prove the flows, runnable in the sandbox.

Authoring is a review loop: the corpus is drafted, the user reviews it
and gives feedback, the draft is updated, and the loop repeats until the
user confirms it. Only then does the corpus freeze and become the
benchmark: the engine is built until `spec scan`, `guard setup`, and
`guard generate`, run on TrueCourse from scratch, produce output with
this coverage and quality.

The reference is REVIEWED IN THE DASHBOARD, so it must be viewable as
real data: `reference/` is the durable hand-authored source (working
stores can be deleted or regenerated at any time and the reference must
survive that), and the reference files themselves are stored in the
engine's real store schemas, the exact formats the dashboard reads. A
copy step places them into the live store locations, so the dashboard
renders the reference exactly as it renders engine output.

The reference boundary (binding, 2026-08-06): the reference replaces
exactly what the pipeline GENERATES, the outputs of scan, setup, and
generate, including the result records a real run of those commands
would write (the setup record, the generate result). Everything
downstream is real: scenarios execute through the real runner in real
sandboxes, runs write the real run store and evidence, and every view
renders from the same files it renders for engine output. The reference
must therefore be complete enough to RUN, recipe included; hand-authored
does not mean inert.

There is exactly ONE representation of the reference: the store-schema
files. Once a layer is transformed into its store schema, that file IS
the reference and any drafting format is deleted; no parallel versions
are ever maintained. A layer whose store schema does not exist yet
(claims and journeys today) keeps a provisional authored file only until
its schema lands. Both cases are decided (2026-08-06): journeys get a
store schema and dashboard view, owned by Guard Setup (§7.2), and claims
become a first-class stored layer, owned by Guard Generate (§8.2); their
provisional files convert and disappear when those schemas land. Layers the
dashboard has no view for yet (claims, journeys) become reviewable there
as the new views land; until then they are reviewed as files.

The transform into store schemas is also a DISCOVERY TOOL: every
reference layer that fits no existing store schema, and every reference
detail an existing schema cannot carry, is a found gap in what the
engine and dashboard support. Each gap is recorded and added to this
plan as work for the owning workstream, so the reference corpus drives
the plan's completeness, not just the engine's quality bar.

Anti-overfitting rules (binding):

- **No workarounds, no special-casing.** The engine closes gaps against
  the reference through general mechanisms only. Nothing in the engine may
  recognize TrueCourse, its docs, or its commands; every miss is a
  root-cause fix that would help any repository with the same shape.
- **Semantic comparison, never byte comparison.** Matching the reference
  means covering the same claims, producing equivalent flows, and proving
  the same behavior; wording, ordering, and file layout may differ. A
  byte-diff target would reward memorization, which is exactly the overfit
  this rule exists to prevent.
- **Generality is checked elsewhere.** Engine changes prompted by the
  benchmark are validated against repositories the reference was never
  authored for (the guard battle-test list), so an improvement that only
  moves the TrueCourse numbers is treated as suspect, not celebrated.

## 5. Phase 0 — the narrowed engine (shared precondition)

Phase 0's goal is an MVP: fewer capabilities that actually work, not many
that half-work. It deletes what the MVP does not need, and it lands before
the workstreams begin, so every owner designs against the narrowed engine.

**Decision reversed (2026-08-09): the API surface stays.** An earlier
version of this section deleted API generation end to end, on the argument
that the engine should prove itself on one surface first. That deletion is
withdrawn: the API stays a VERIFIED surface — the engine derives journeys,
flows, and scenarios for it — because the docs already specify it (the
seeding, external-services, and recipe pages are largely about it; deleting
the surface stranded 175 documented statements untestable) and the runner
machinery for it exists. What changes is the METHOD, not the scope: the API
surface is rebuilt reference-first, exactly like the CLI surface — the
reference corpus's API flows and scenarios are hand-authored and reviewed
first, the schemas and runner are grown until that reference represents
and RUNS, and only then is API generation designed, from this document.
CLI remains the first driver through every stage; API follows it stage by
stage, never in parallel with an unproven stage.

What Phase 0 still deletes:

- **The agent transport.** A third LLM transport exists today besides
  claude-code and api: a file mailbox answered by an orchestrating agent.
  It is extra overhead for the MVP and is deleted; the engine keeps exactly
  the two transports of §3.1, claude-code and api.
- **The scenario Story mode.** The dashboard's scenario detail had three
  display modes: View, Story, and YAML. Story is feature surface the MVP
  does not need and is deleted; View and YAML stay.
- **The externals-need-api coupling.** External services are configured
  through the recipe's api block today, and the externals surface refuses
  to save an account without one. External services serve ANY driver's
  scenarios — a CLI under test depends on third parties too — so the
  coupling and its warning are deleted: external services are declared and
  configured whether or not the recipe has an api block.

## 6. Workstream: Spec Scan (owner: Doil)

### 6.1 Scope

The corpus-path scan (relevance, area-tags, vocabulary reconciliation,
overlap, chains, curation) re-shaped as agent sessions, over a doc
universe this workstream also acquires.

STATUS: design in progress (owner: Doil, from 2026-08-08).

**Boundary.** This workstream owns everything from doc acquisition to
`specs/corpus.json`, and nothing after it. Acquisition is in scope
because §4 settles the spec source as the published documentation site,
not repo files: the registered llms.txt sites (`spec source add` →
`specs/sources.json` plus the page snapshots under
`specs/sources/<id>/`) are a doc source of this scan, and discovery
already joins them to the repo walk as one universe. Claims and every
layer built on them belong to §8, by two standing decisions of
2026-08-06: claims "become a first-class stored layer, owned by Guard
Generate" (§4), and are "produced by this workstream's planning layer"
(§8.2), which §8.3 keeps as `sections → claims → flows`. The scan's
output contract is therefore `specs/corpus.json` — the kept docs, their
area tags, the doc-to-doc relations, and the relevance-dropped docs with
their reasons — consumed by §8's planning layer as its doc universe.
`specs/decisions.json`, the user's curated resolutions over that corpus,
is this workstream's user-decision surface and stays here.

**Architecture principle: budget-bounded, never silently thinned**
(decision 2026-08-08). The scan's cost grows with the corpus, and the
stage that grows fastest — overlap — is bounded by giving each session
an explicit turn budget and letting it narrow its own reading (outlines
first, drilling in only where topics collide), never by the engine
pre-filtering what it will consider. A bound that binds is REPORTED, so
a reader can tell "no overlap found" from "the budget ran out";
`CuratedCorpusSchema` v3 has no field for this, and the gap is recorded
in §6.2. Silently reducing what the engine considers is the one failure
this workstream refuses.

**Vocabulary reconciliation** is named above because §3.2 admits no
unclassified LLM stage and `curate()`'s vocab pass is one today (cached
under `consolidator/vocab`). It is corpus-wide by construction — it
reads the complete tag map after every doc is tagged — so it cannot fold
into a per-doc session; its disposition is settled in §6.3.

### 6.2 Known problems the design must solve

- **Overlap checking does not scale to big documentation sets.** The
  number of candidate overlaps to check grows much faster than the corpus
  itself, so on large documentations the overlap pass produces far too
  many checks to run (and far too many results for a user to review). The
  design must bound how many overlap checks happen, without silently
  thinning what the engine considers. Two properties of the current pass
  set the size of the problem. Nothing is capped: the work list is every
  within-area doc pair PLUS the heading-widened cross-area pairs (an
  outside doc whose heading slug-matches an area's concern is paired with
  each doc already in that area), and every pair is judged. And the pass
  runs on a cheap, fast model today, which §3.4 retires — the same
  uncapped count moves onto the one flagship model, so the cost curve
  steepens with the count.
- **Section identity survives real docs — landed 2026-08-07, do not
  regress it.** Section derivation read ATX headings only, so a claim
  anchored in a doc's lead paragraph bound to nothing and 6 of 17
  reference scenarios read `stale`. The lead region is now a section of
  its own, named by the frontmatter title and fingerprinted over the
  lead text alone (`transform-gaps.md` G33; every reference doc reports
  no orphaned sections today). It is recorded here because the rebuilt
  scan must preserve it: a doc's lead is anchorable, and the corpus's
  preamble marker (`OverlapSectionSchema.heading: null`) is its
  spec-side counterpart. `transform-gaps.md` still carries the
  superseded open statement as G27.
- **The product-axis rule is stated but never enforced.** Areas are a
  two-level `product/concern` pair, and the rule already exists,
  emphatically — but only inside the area-tagger's prompt: most
  repositories are one product, that product is `core`, a feature or
  module name is a concern, and when in doubt the product is `core`.
  Nothing outside that prompt carries it. The schema does not encode it,
  nothing validates it, and the one stage that touches product names
  afterwards is explicitly barred from correcting it — the vocabulary
  normalizer keeps only mappings within the same axis, "never to
  `core`/`process`" — so an invented product survives the whole pipeline.
  The hand-authored reference is the demonstration: it tagged its single
  area `truecourse/code-analysis` and recorded the reason as "a product
  axis the reference never chose", because the authoring path never
  reads the tagger's prompt and `core/code-analysis` was the stated
  answer all along. Under §3.2 every session ends on a structured
  outcome, so the design must decide whether the doc-curation session's
  done-condition VALIDATES the product axis or whether a deterministic
  backstop corrects it afterwards — the scan already runs one such
  backstop for third-party drops (`thirdPartyRestored`).
  `transform-gaps.md` G29 states this as a forced axis; the axis is not
  forced — `core` exists for exactly this case.
- **The corpus cannot say how complete it is.** §6.1's principle
  requires the scan to record where a session's budget stopped it, so a
  reader can tell "no overlap found" from "the budget ran out".
  `CuratedCorpusSchema` v3 carries `version`, `generatedAt`, `docs`,
  `areas`, and `skippedDocs`; no field expresses an exhausted budget,
  and `AreaSchema.overlaps` holds found overlaps only. The completeness
  signals the scan already computes live in `CurateStats`, which
  `curate()` returns and never writes, while the corpus itself is
  committable and inherited from git like `LATEST.json` — so the
  teammate who pulls the corpus sees none of them. The engine already
  accepts this failure mode for a sibling signal: `llmFailures` exists
  because "without this a partially failed scan is indistinguishable
  from a clean one". A bounded scan has exactly that problem and no such
  field. Carrying completeness in the corpus file is a schema addition
  this workstream owns.

### 6.3 Sessions

Per §3.2, every LLM task is an agent session; these are the seed
definitions for the owner to refine.

- **Doc curation session** (one per doc). Prompt: a spec curator deciding
  whether this doc describes user-facing behavior worth verifying, and
  which areas it belongs to. Inputs: the doc's content, the corpus's
  current area vocabulary, and the corpus doc list (titles and paths).
  Tools: read another doc (to resolve a reference, or to compare against
  an area's existing docs before tagging). Done: keep or drop with a
  reason, plus area tags. This session absorbs today's separate relevance
  and area-tag calls.
- **Overlap session** (one per area). Prompt: find the real overlaps and
  conflicting statements among this area's docs. Inputs: the area's kept
  docs as titles and outlines, not full contents. Tools: read a doc
  section. Done: the overlap/conflict set with section anchors, or an
  explicit "none found". This session is also the answer to the scaling
  problem above: the engine stops enumerating candidate pairs entirely,
  and the session narrows its own reading (outlines first, drilling in
  only where topics collide) under a per-area turn budget, so the bound
  is an explicit budget, never a silent thinning of what is considered.
- **Relation session** (one per flagged group). Prompt: decide the
  doc-to-doc relation (replaces, takes precedence, keep both) for a group
  the overlap sessions flagged. Inputs: the flagged group with its
  anchors. Tools: read the disputed sections in full. Done: a proposed
  relation for every flagged pair, feeding the same curated corpus and
  user decision surfaces as today.

### 6.4 Estimation algorithm

To be defined by the owner per §3.5: the scan's session types over their
work items (docs, areas, flagged groups), turn ranges per session type,
and what the scan's caches exclude from the estimate.

### 6.5 Implementation plan

To be authored by the owner.

## 7. Workstream: Guard Setup (owner: Sarkis)

### 7.1 Scope

Recipe discovery and verification, dependency detection and the
dependency catalog, auth state, and journey generation, re-shaped as
agent sessions with the executor as their tool.

STATUS: design settled 2026-08-07 (owner grilling session). §§7.4–7.8
are the binding design; implementation may start per the phasing in
§7.8.

The workstream's architecture principle (decision 2026-08-07):
**deterministic-first**. The deterministic layers — the recipe proposer,
the detection channels, journey extraction — stay the primary evidence
generators; sessions classify, condition, verify, and repair. A session
never re-derives what deterministic extraction gets for free; it settles
what deterministic extraction cannot, and facts no tool establishes stay
unknown, never guessed.

### 7.2 Known problems the design must solve

- **Proper recipe generation is missing.** Setup does not yet produce a
  trustworthy recipe for the CLI: how to build the program under test and
  how to invoke it. This is the workstream's largest gap: without a
  correct recipe every downstream stage degrades. (Field note
  2026-08-07: the propose→verify machinery EXISTS — deterministic
  proposer, LLM fallback, live install/build/entry-probe/boot
  verification, cached. The gap is derivation quality and coverage plus
  the missing PATH expression, not absent machinery; §7.4's session
  upgrades the hand-rolled one-retry fallback into a real repair loop.)
- **Authentication seeding is partial.** Seeding an authenticated starting
  state works only partially today; scenarios that need credentials or a
  logged-in state cannot rely on it.
- **External service detection is partial.** Detection of the external
  services a scenario depends on is incomplete, which misclassifies flows
  as runnable or blocked.
- **Journey generation is partial, and setup owns it.** Journeys (the
  code-derived public contract of §2) are derived here, at setup time, and
  nowhere else — for the CLI surface first, the API surface following
  stage by stage (§5), web later (§10). A journey must
  carry the COMPLETE argument grammar: every command, every flag and
  argument, requiredness, value shapes, and choices (the completeness
  guarantee of §7.3). Guard generate consumes journeys and may heal them
  in-run (§8), but never derives them.
- **Journeys must show input and output.** Beyond the argument grammar, a
  journey carries each command's input/output contract: what it consumes
  (arguments, stdin, files or state it reads) and what it produces
  (stdout, files or state it writes, exit codes). This serves two
  consumers: scenario authoring gets its assertion targets straight from
  the journey instead of guessing them, and the dashboard's journey view
  renders the full contract (grammar plus inputs and outputs) so a user
  can read what a command takes and returns at a glance. Facts the
  deterministic extraction and probes cannot establish are recorded as
  unknown, never guessed.
  Decided 2026-08-09: for an INTERACTIVE command, the contract also
  carries the question sequence — the prompts in order, each with its
  answer kind (pick / free text / confirm) and, where a question only
  appears after a particular earlier answer, that condition. It is a
  branching structure, not a flat list, because the real dialogue
  branches. This makes an interactive command scriptable from the
  journey alone: a generator writes the scenario's scripted answers
  without first running the command. Sequence facts the extraction
  cannot establish are recorded as unknown — an unknown sequence is a
  journey the mapper still owes, never a license to guess.
- **Starting-state dependencies are detected, never fabricated.** Every
  scenario runs against some starting state, and setup is where the
  program's classes of starting state are discovered. Alongside the
  recipe, setup produces a **dependency catalog**: each entry names a
  class of state the program needs and how a scenario may obtain it, in
  exactly one of three ways:
  - **step-creatable**: state the public surface itself can create (an
    init command, an add command). The preferred way; no seeding needed.
  - **seedable**: state that cannot be created through public steps but
    can be materialized deterministically before the steps run: files,
    configuration, database rows. Setup already detects the database;
    the catalog records that seeding it is possible and in what shape.
    Authenticated state belongs here too: the seeding gap above is one
    instance of this class.
  - **supplied**: real-world inputs the engine must never fabricate: a
    project or repository the program operates ON (the TrueCourse case:
    the CLI needs a codebase to analyze), a corpus, credentials to a
    third-party system. Setup detects that the dependency EXISTS and
    registers it in the catalog; the user registers concrete instances.
    This follows the exact pattern external services already use: the
    committed catalog declares WHAT is needed (so it enters fingerprints
    and travels with the repo), while a local, never-committed overlay
    holds the machine-specific instances (a path to a real project, a
    connection string, a key). External services are themselves one
    class of supplied dependency; the catalog is the umbrella over them.

  A supplied dependency with no registered instance is a first-class,
  user-actionable gap (register an instance), never a silent one, and
  never a license for the engine to generate a fake stand-in.

  Supplied entries carry a stated REQUIREMENT (decision 2026-08-07):
  what an instance must contain for the flows that bind it ("a project
  with at least one high-severity and one low-severity deterministic
  finding, committed clean"). The engine REASONS the requirement out of
  the claims a flow tests, declares it, and blocks until an instance is
  registered; setup may VERIFY a registered instance against its
  requirement by running once (verifying provided data is not
  fabrication). Tests rely on the dependency; they never manufacture
  their own test subjects.

  The boundary is TRANSACTIONAL vs DURABLE (decision 2026-08-07): a test
  may create and mutate only transaction-scoped state within its own run
  (write a row to test writing, dirty a tree to test stashing); anything
  durable that must pre-exist (a codebase with content, a database
  already holding data) is supplied. And a requirement is CONTRIBUTED,
  flow by flow: every flow binding the dependency states its own need,
  the catalog entry's requirement is the roll-up of those needs, each
  attributed to its flow — so the user sees why each expectation exists,
  one shared instance satisfies all binding flows, a dismissed flow's
  need drops out, and a new flow can grow the requirement (which may
  re-trigger instance verification).
- **Detection must scope to the program under test** (discovered in the
  reference field run, 2026-08-06). The setup detection pass scans the
  whole repository, so on TrueCourse it reported 16 external services
  (marketing-site fonts and social links, EE-only cloud SDKs, even the
  product's own domain) and an EE-only database with 161 tables, while
  missing the one service the CLI actually calls (the Anthropic API,
  reachable only through an SDK import). Detection must scope to code
  the program under test can reach, must catch SDK-only services, and
  must record evidence with repo-relative paths (today it emits absolute
  host paths, which a committed artifact cannot carry).
- **Detection has no channel for three whole classes of dependency**
  (discovered while authoring the reference setup record, 2026-08-07).
  An exhaustive sweep of what the CLI actually reaches found ten
  external dependencies where detection reports four, and the six it
  misses are missed structurally, not by accident:
  - **Spawned binaries are invisible.** Detection reads imports and URL
    literals only, so nothing that the program shells out to is ever
    seen — including `claude`, the Claude Code CLI that IS the default
    LLM transport (`packages/shared/src/claude-binary.ts`,
    `packages/core/src/services/llm/cli-provider.ts`), `git` (file
    discovery, baselines, hooks, spec scan, guard), the
    `pyright-langserver` LSP server that does Python semantic analysis,
    and `dotnet` running the Roslyn host, without which analyzing C#
    fails hard. Detection needs a spawned-subprocess channel: the
    `child_process` / `execFile` / `spawn` call sites and the binary
    name they resolve, including the env-var override chain a binary is
    looked up through.
  - **The SDK import map is per-package, and incomplete.** It matches
    `@ai-sdk/anthropic` but not its siblings `@ai-sdk/openai` and
    `@ai-sdk/amazon-bedrock`, imported four lines away in the very same
    file (`packages/llm-api/src/model.ts:7-10`). A provider family must
    be matched as a family, not one member at a time.
  - **User-supplied URL classes have no channel at all.** `truecourse
    spec source add/refresh` fetches arbitrary llms.txt documentation
    hosts the user names at run time
    (`packages/spec-consolidator/src/sources/fetcher.ts`). There is no
    host literal to find, so no amount of static URL scanning will see
    it; detection needs to record the CLASS of egress ("arbitrary
    user-supplied documentation hosts, on these commands") rather than
    a host identity.

  Two schema gaps block recording the above honestly, both owned here.
  `DetectedExternalService.source` is the closed enum `sdk | http`, so a
  spawned binary has no truthful source value — the reference record
  omits the field rather than claim `sdk`, which makes the externals
  view render it as an SDK hit; the enum needs a `binary` (spawn)
  member, and the evidence shape needs a pointer for it (the binary name
  and its resolution chain) alongside `importSource` and `url`. And
  nothing on the shape expresses CONDITIONALITY, though most of these
  dependencies are gated: `claude` only under the `claude-code`
  transport, `openai` and `aws-bedrock` only under their API provider,
  `pyright` only when Python files are present, `dotnet` only for C#.
  Every entry currently reads as unconditional, which over-blocks flows
  that would run fine.
- **Sufficiency-audit items (2026-08-07, from tracing all 1,545 knowledge
  atoms of the reference scenarios to worker inputs).** Owned here:
  journeys need ONE more narrow fact kind — the row grammar and value
  vocabulary of enumerated/tabular output ("Rules for X: N shown (E
  enabled, D disabled)") — which anchors 36 assertion atoms; prompt facts
  need an input-encoding member (how a select prompt is submitted; today
  unanswerable from the journey); the `config llm` command family has no
  journey at all (five parked claims, one unauthorable scenario); and
  reads/writes facts that name unassertable state (the user-level store,
  abstract subjects like "git index") should be marked as preconditions
  so a worker never burns turns trying to assert on them.
- **Store gaps discovered by the reference transform (2026-08-06).**
  Three, all owned here: the journey store carries little more than flag
  names, so nearly the whole journey contract (requiredness, value
  shapes, choices, exit codes, output promises, reads and writes,
  prompts) and the doc-vs-code diagnostics have no schema home; the
  store and its dashboard view must grow to the full contract of this
  section. The dependency catalog (the starting-state classes, including
  the supplied "blocks loudly when unregistered" state) has no store at
  all. And the recipe cannot express "expose the program under its real
  binary name on PATH", which any scenario driving the program through
  git hooks requires.

  STATUS on the journey store gap: LANDED 2026-08-07, then NARROWED by
  user decision the same day: the journeys artifact stores EXACTLY the
  calling interface a flow author needs — grammar, positionals, the
  consumes/produces contract (with honest unknowns), and behavior notes
  — and nothing else. The reference is the generation target, so every
  stored field is a field the pipeline must generate; authored
  decisions, doc-vs-code diagnostics, and shared blocks are REMOVED from
  the schema and the data (shared facts denormalize into each command's
  own contract). The io contract is STRUCTURED FACTS, never free prose
  (decision 2026-08-07): entries like stream+marker, exit+when, prompt
  kind+marker+when, file writes — each with an optional short `when`
  condition, nothing free-form beyond the marker string. Facts are what
  probes establish and what workers turn into assertions and scripted
  answers; narrative descriptions are neither generatable honestly nor
  consumed by anything, so they do not exist in the artifact. Discrepancies the mapper finds at derivation are
  transient run reporting, never stored journey data; this supersedes
  the §7.5 amendment that placed diagnostics per-journey. Still open
  here: the MAPPER producing the calling-interface contract (it still
  emits the thin shape), the dependency catalog store, and the recipe
  PATH expression.

### 7.3 Journey completeness (the load-bearing guarantee)

Everything downstream assumes journeys carry the COMPLETE public grammar.
That is enforced, not hoped for:

1. **Two derivation sources, cross-checked.** The mapper already has both a
   static extraction (the analyzer's command tree) and a runtime one (`--help`
   probes, parsed). At derivation the journey carries their UNION, and every
   discrepancy (a flag the probe sees that the tree missed, or vice versa) is
   recorded as a mapper diagnostic — the union keeps workers whole today, the
   diagnostic queues the extractor fix. (Field precedent: the chained
   `new Option().choices()` shape silently dropped `--transport` for weeks;
   the probe knew it all along. Cross-checking makes that class visible the
   day it appears.)
2. **Known structural gaps are in-scope work, not caveats**: the root-command
   journey (today `--version`/`--help` have no journey at all — one flow
   settled `unrealizable` for it), and program-level/inherited flags on
   subcommand journeys.
   Decided 2026-08-09: journeys are derived from CODE ONLY — the mapper
   never reads docs. Doc-vs-code disagreement surfaces downstream, where
   docs are the input: a doc claim nothing in the journey can serve
   settles its flow visibly as NOT TESTABLE with that reason ("nothing in
   the journey serves this claim"). The verdict on WHY stays the user's,
   never the engine's — stale docs and a feature accidentally dropped in
   a refactor look identical from here, and only the developer knows
   which side is wrong. The completeness guarantee above makes the signal
   trustworthy (it really means "the code offers nothing"), not
   self-judging.
3. **Self-verification test**: derive journeys from TrueCourse's own CLI and
   diff the option schemas against the commander registry introspected at
   runtime — a completeness gate over a real, rich CLI that runs in CI and
   breaks when an extractor regresses or a new registration idiom appears.
4. **Field feedback loop**: worker `journey-defect` reports (the sandbox
   rejected a promised flag, or demanded one the grammar lacks) are first-
   class run outputs, rendered like coverage gaps — each one is a mapper bug
   with a reproduction attached. Journey defects now also SELF-HEAL in-run
   (probe-verified against the live program, the corrected grammar resumed
   into the same session) while the report still queues the extractor fix.

### 7.4 Sessions (final; decisions 2026-08-07)

Per §3.2, every LLM task is an agent session. Common rules: one model
(§3.4), the standard malformed-turn policy (§3.3), a per-session turn
budget (defaults below, provisional until the reference benchmark run
calibrates them) and token ceiling. Per the deterministic-first
principle (§7.1), a step whose deterministic path settles everything
runs NO session at all — §3.2 mandates the call shape of LLM tasks, not
that every step involve one.

- **Recipe repair session** (turn budget 15). The deterministic
  propose→verify path stays primary and runs first; a deterministic
  proposal that verifies clean means no session runs. The session spins
  up only when the proposal is missing, ambiguous, or fails
  verification, and its job is repair-to-green, never re-derivation: it
  receives the failed proposal and the verification evidence as its
  starting draft. Prompt: a build engineer whose deliverable is a
  working recipe. Tools: read repository files; run commands in the
  sandbox (install, build, invoke the program). Lifecycle: ONE
  persistent working sandbox across the session's turns, so installs and
  builds accumulate and iteration is cheap; the only done-gate is a
  verification in a FRESH sandbox the session never touched (§8.5's
  confirmation principle): install and build clean, the entry probe
  answers, and every exposed binary (the `expose` field, §7.6) resolves
  and answers on PATH. Failing that: a structured failure naming exactly
  what could not be made to work.
- **Dependency-catalog session** (turn budget 12). Prompt: classify
  every dependency of the program under test into the catalog's three
  classes (step-creatable, seedable, supplied) and condition it. Inputs:
  the detection snapshot (the derived evidence layer, §7.6), the
  verified recipe, and repository signals. Tools: read files; run the
  program in the sandbox and observe how it fails (a missing env var, an
  unreachable service, or a "no project here" error each name a
  dependency) — the session may ADD entries detection missed, with the
  observed failure as evidence. Done: the curated committed catalog
  (§7.6) with every entry classified and conditioned (structured
  predicates, §7.6), and skeleton entries written for the supplied
  dependencies.
- **Auth verification session** (turn budget 5). Narrowed by the auth
  mechanism decision (§7.6): an authenticated state is a supplied
  catalog entry the RUNNER materializes (copy-in), so there is no seed
  to author. The session's whole job is proof: run the program in a
  fresh sandbox with the materialized state and demonstrate that it
  authenticates, or end blocked naming the missing registration. Tools:
  run commands in the sandbox.
- **Journey reconciliation session** (turn budget 10). Journey
  extraction stays deterministic (the tree-and-probe union of §7.3);
  this session exists for what extraction cannot settle. ONE session for
  the whole journey set's discrepancy list — discrepancies are few and
  correlated (one extractor bug repeats across commands; the field
  precedent's `--transport` case), and one resolution generalizes. Zero
  sessions when the list is empty. The session is SANDBOX-ONLY: no code
  access (decision 2026-08-07). Io facts settle by observation, so the
  run tool returns rich capture — exit code, streams, and a filesystem
  diff of the sandbox taken before/after the invocation; facts
  observation cannot establish stay `unknown`, never guessed. Done:
  every discrepancy resolved into the final grammar, each with a
  recorded diagnostic. The journey artifact itself stays deterministic
  and fingerprintable; the session settles facts, it does not freestyle
  grammar. A corpus whose discrepancy list outgrows one budget splits
  per case — not the default.

### 7.5 Journey completeness decisions (2026-08-05, carried from the seed)

- Union at derivation: the tree derivation always runs; when a probe
  executor and a recipe entry exist, probes **always** run too (same probe
  budget) and per-command grammars merge tree ∪ probe. Tree wins on
  descriptions; probe fills facts the tree missed (choices, value hints,
  whole flags). Every discrepancy is recorded on `JourneysFile` in a new
  `diagnostics` field (`{surface, path, flag?, kind, detail}`, kinds:
  `tree-missing-flag | probe-missing-flag | tree-missing-command |
  probe-missing-command`). `source` learns the value `union`.
- Root journey: derived from the tree too (`cli/root`, entry =
  `[programName]`); the analyzer keeps program-level flags (today dropped)
  and, for commander programs, synthesizes `--help` (always) and `--version`
  (when `.version()` is called).
- Program-level flags appear on subcommand journeys' grammars marked
  `scope: 'program'` (rendered as "pass before the subcommand"); option
  metadata stays out of journey fingerprints, so this rolls no identities.
- `parseCliHelp` joins wrapped option lines before parsing, so a
  `(choices: …)` clause split across lines survives.
- Extractor gaps the self-verify gate requires fixed: `.addOption(f())`
  where `f` is a module-scope factory returning an Option builder chain, and
  spread `[...CONST]` inside `.choices()` resolving a module-scope
  string-array const.
- Self-verify gate: `tools/cli/src/index.ts` exports its program and guards
  `program.parse()` behind an introspection env var; a CI test walks the
  commander registry (path set + per-path option facts: `flag = long ?? short`,
  `required = mandatory`, `takesValue = required || optional`, `valueHint`
  from the flags string, `choices = argChoices`) and diffs it against the
  static tree derivation. Surfaces journeys deliberately don't model
  (positional arguments, aliases, the auto `help` subcommand, hidden options)
  are excluded by construction.

**Amendment (2026-08-07).** Where the landed journey store schema
diverges from the 2026-08-05 wording above, the LANDED schema is
canonical: diagnostics live PER-JOURNEY with shape
`{kind, subject, detail, right?}`, not top-level on `JourneysFile`, and
the hand-authored reference is written against that shape. The one
schema addition still owed is the `union` member on the source enum.

### 7.6 Setup design decisions (2026-08-07)

- **Command shape.** One command, sequential sessions, resumable. Step
  taxonomy: **recipe → detect → catalog → journeys → auth** (the old
  externals and seed steps retire: externals fold into the catalog, and
  CLI auth is catalog + runner materialization with the auth session
  verifying; the api seed stays — the API surface stays a verified
  surface per the reversed §5 decision — and joins the taxonomy when the
  API path reaches setup, as part of the catalog/auth design rather than
  a standalone step). Each step's outcome
  persists as it lands; every step records an input FINGERPRINT in the
  setup record, so a re-run skips settled steps whose inputs are
  unchanged and resumes at the first unsettled or invalidated one.
  Journeys become an explicit recorded setup step (today they are an
  unrecorded byproduct of the detect pass). Auth runs last — it consumes
  the catalog and the recipe — and is the ONLY step that may end
  `blocked` (on a user registration) without failing setup: loud,
  actionable, never silent. `guard/setup.json` stays gitignored/derived.
- **Two-layer detection: evidence vs curation.** The detection snapshot
  stays in `setup.json` as the derived evidence layer, grown by three
  new channels (spawned binaries, SDK provider families, egress classes)
  and the schema fixes of §7.2 (a `binary` source member; an evidence
  pointer carrying the binary name and its env-var resolution chain;
  repo-relative paths; conditionality). The CATALOG is the curated
  committed layer the dependency-catalog session writes. All read
  surfaces (the externals view, flow gating) move to the catalog. This
  mirrors the corpus.json/decisions.json derived-vs-curated split, and
  re-running detection never destroys curated classifications.
- **Dependency catalog store.** `scenarios/dependencies.json` —
  committed, fingerprinted like the recipe. Machine-specific instances
  and secrets live in `scenarios/dependencies.local.json` — gitignored,
  merged over the committed file per field at load time, outside every
  fingerprint. External services are supplied-class entries: the catalog
  is the UMBRELLA (absorb, not sibling), so the recipe's `api.externals`
  block and `scenarios/externals.local.json` retire. The migration is a
  clean break: setup folds both in once if present (with a printed
  notice); no permanent dual-store reads.
- **Conditionality.** Structured predicates plus a required
  human-readable sentence. Closed vocabulary, starting with exactly the
  three kinds the reference record needs —
  `{kind: 'config-value', key, value}`,
  `{kind: 'language-present', language}`,
  `{kind: 'command-path', journeyId}` — grown per case, never
  free-form-only. Machine-readable so flow variants block ALONE (§8.2:
  the api path without a key blocks while the claude path runs); the
  sentence serves every dashboard surface.
- **Reachability scoping.** Detection scopes to a package-granularity
  dependency closure from the recipe's entry/build target (the workspace
  manifest graph); only files in reachable packages enter detection —
  the marketing site and EE never enter the closure from the CLI.
  Recipe-level include/exclude globs are the escape hatch for repos
  whose manifests don't delineate reachability. False inclusions WITHIN
  a reachable package are conditionality's job, not scoping's.
- **Recipe PATH exposure.** The recipe grows
  `expose: { <binName>: <argv | built entry path> }`; the sandbox builds
  a shim directory of executables and prepends it to PATH —
  ecosystem-neutral, no global mutation, the allowlist env model intact.
  The deterministic proposer pre-fills it from manifest bin declarations
  (package.json `bin`).
- **CLI auth mechanism.** An authenticated state is a SUPPLIED catalog
  entry; the local overlay points at the host state (e.g. the claude
  config dir); the runner materializes it into the fresh sandbox's HOME
  before steps — copy-in, never symlink or passthrough, so a run can
  never mutate the user's real state (§8.2's supplied rule). Hermeticity
  holds: no host-env leakage, no interactive login flows in sandboxes.

### 7.7 Estimation algorithm

Per §3.5. Work items are the setup steps whose input fingerprints
changed; per changed step, its session count × the session type's
[min, max] turn range, at the one model's prices:

- **recipe** — 0 sessions when the deterministic proposal verifies
  clean; otherwise 1 × [3, 15]. A changed-recipe estimate cannot know in
  advance whether the deterministic proposal will verify clean, so it
  shows the session range labeled "may resolve deterministically at $0"
  — a range honest about variance, per §3.5.
- **catalog** — 1 × [4, 12].
- **journeys (reconciliation)** — 0 when the discrepancy list is empty;
  otherwise 1 × [3, 10].
- **auth** — 1 × [2, 5] per supplied-auth entry with a registered
  instance.

Deterministic steps (detect, journey derivation) estimate as free.
Unchanged fingerprints are excluded and labeled ("N of M steps
changed"); when nothing changed the estimate has no stages and the
confirm prompt is skipped — identical presentation to scan and generate.
Turn budgets are provisional until the reference benchmark run
calibrates them.

### 7.8 Implementation plan

Prerequisites, external to this workstream: Phase 0 (§5), and the shared
agent loop (§3), built once beforehand and shared by §§6–8 — this
workstream builds no loop machinery (§3.3 Delivery).

**Phase A — deterministic + schema work.** Starts now, parallel to
Phase 0; needs no loop.

- Journey mapper: the tree∪probe union with diagnostics, the root
  journey from the tree, program-level flags, the `parseCliHelp`
  wrapped-line join, the two extractor gaps, and the self-verify CI gate
  (§7.5); the deterministic reach of the rich contract (grammar
  complete; io facts only where probes and static extraction honestly
  establish them); the `union` source member.
- Detection: the three new channels (spawned binaries, SDK provider
  families, egress classes), the schema fixes (`binary` source,
  binary/resolution-chain evidence, repo-relative paths,
  conditionality), package-granularity reachability scoping with the
  recipe glob override.
- The dependency catalog store + local overlay + the one-shot externals
  fold-in; retirement of `api.externals` and `externals.local.json`.
- Recipe `expose` + the sandbox shim-dir PATH mechanism.
- The rebuilt setup command: the step taxonomy of §7.6, per-step input
  fingerprints, the rebuilt `setup.json` record, and the runner's
  materialization of supplied instances (copy-in).

**Phase B — the sessions.** Blocked on the shared loop landing.

- The four sessions of §7.4, recipe first (without a correct recipe
  every downstream stage degrades): recipe repair, dependency catalog,
  journey reconciliation, auth verification.
- The estimation rework (§7.7) wired into the pre-flight.

## 8. Workstream: Guard Generate (owner: TBD)

### 8.1 Scope

The agentic authoring core: planning, flow workers, verification,
observability, incrementality, and the recorded implementation phases
below. This section is the full seed design carried from the original
guard-generate plan, for the owner to refine.

### 8.2 Known problems the design must solve

- **Generate duplicates journey generation.** Today generate derives
  journeys itself, duplicating setup's job. After the split, journeys are
  a setup output only: generate consumes them, and when the sandbox
  contradicts one it HEALS the journey in-run (the probe-verified
  correction of §7.3, resumed into the same session) while still
  reporting the defect for the extractor fix. It never generates journeys.
- **Per-scenario data seeding needs a proper mechanism.** Each scenario
  runs from a declared starting state, and generate is where that state is
  chosen and seeded, per scenario, from setup's dependency catalog (§7)
  and from nowhere else:
  - When the catalog marks the needed state **step-creatable**, the worker
    prefers creating it through public steps inside the scenario itself.
  - Otherwise the worker declares a **seed** as part of the scenario
    (files to materialize, rows to insert, the authenticated state to
    establish); the runner applies it in the fresh sandbox before the
    steps, so every replay is exact and the seed travels with the
    scenario artifact. Database seeding is this path.
  - State marked **supplied** is bound, never built: the scenario names
    the dependency, and the runner resolves the user-registered instance
    and copies it into the sandbox, so a run can never mutate the user's
    real data. The engine does not generate a stand-in project,
    repository, or dataset: a fabricated input would make every verdict
    reached against it meaningless.
  - A claim whose needed state the catalog cannot provide ends
    `blocked (missing-data)` with the dependency named: directly
    actionable (register an instance, extend the catalog), never silent.
- **Flow and scenario generation is weak.** The current authoring core
  produces weak flows and scenarios; the agentic worker design (§8.4) is
  the experiment meant to fix this, and this workstream carries that
  experiment to a properly working engine. Two coverage rules bind the
  fix:
  - **Not only the happy path.** Flow synthesis exercises the model's
    judgment to add the edge and corner cases that matter (error paths,
    invalid input, boundary values, empty or conflicting state), not just
    the documented golden path. Edge flows are still expressed through
    public journeys and mapped to the claims they stress.
  - **Every configuration path.** When the program offers alternative
    modes for the same capability (an enumerated choice in the grammar or
    configuration, such as TrueCourse's claude vs api transport), flows
    cover each supported path, never only the default. Each variant binds
    its own dependencies from the catalog (§7), so a variant whose
    dependency is unregistered blocks alone: the api path without a key
    blocks while the claude path still runs.
  - **No step without a purpose** (decision 2026-08-07). Every scenario
    step either proves a claim or prepares for a later claim step.
    Just-in-case sanity checks are not authored: they prove nothing the
    claim accounting counts, and insurance duplicating a claim another
    flow owns is redundant coverage. A DISCOVERY step that also proves a
    claim is purposeful (the reference's pattern: the step that observes
    a rule key doubles as the list-filter claim's proof).
- **Test subjects are supplied, never fabricated** (decision 2026-08-07,
  superseding the behavior-fixtures/seed-library proposal the
  sufficiency audit had raised). A flow that needs code with findable
  content does not invent it: the need becomes a supplied dependency
  with a reasoned requirement (§7.2), the user provides the fixture
  project, and the flow blocks until then. Assertions derive from the
  claims plus what the run observably shows on the bound instance —
  structural, fidelity-judged — never from a stored behavior map or
  probed product internals. Scenario-written files stay legitimate only
  where the claim is about the program's own mechanics (an ignore file,
  a config edit): arranging conditions, never manufacturing test
  subjects.

  Step time limits (decision 2026-08-08): a scenario step may declare
  its own time limit in the test definition; the runner's default stays
  tight. At generation time, a worker whose draft step times out treats
  that as a signal to RAISE that step's declared limit (within a
  ceiling) and retry — a timeout during authoring is calibration, not
  drift.

  The worker's authoring decision rule (binding, 2026-08-08): for every
  piece of state a flow needs, ask "is this durable state that must
  pre-exist, or transient state this flow itself arranges?" Durable →
  bind a dependency and CONTRIBUTE the flow's need to its requirement
  (§7.2); the flow blocks until the user provides an instance. Transient
  and truly specific to this one flow → arrange it in-scenario (a write,
  a git step, a config edit). When in doubt, it is a dependency: a
  blocked flow with a named need is honest and actionable; a fabricated
  test subject silently proves nothing.
- **Doc-vs-journey conflict policy at authoring time** (decision needed,
  flagged 2026-08-07): when a journey fact contradicts the doc's
  promise, the author asserts the DOC's promise and records the
  contradiction as a finding — the reference did exactly this for the
  per-file-budget warning and thereby caught a real silent-partial-
  analysis bug a journey-following author would have hidden.
- **The scenario format is too small for documented behavior**
  (discovered by the reference transform, 2026-08-06). Writing the
  hand-authored reference into the current schema dropped 68 of 170
  steps and 57 of 106 milestone tags. The format must grow: file write
  and delete steps between runs (diff-shaped claims are two-state), git
  invocations as steps with identity and repo-root control (hooks only
  trigger through git), per-step working directory and TTY with scripted
  prompt answers (prompt-path claims), a combined-stream output matcher,
  sandbox-path interpolation, milestones carried as claim identities
  with several allowed per step (today they are positional and one per
  step), flow kind and variant metadata, and an honest never-executed
  state (a hand-authored scenario that never ran must not render as
  birth-passed). The flow corpus file must also join the store's
  snapshot file walk; today it would be silently lost there.

  STATUS: LANDED 2026-08-07 as scenario format v3. Every capability
  above shipped with runner support (TTY steps run on a real
  pseudo-terminal with scripted answers), never-run is an honest state
  across status, flows, and coverage surfaces, the flow corpus file
  joined the snapshot walk, and the reference re-materialized in full:
  170/170 steps and all 106 milestone claim ids load through the real
  loader. Still open elsewhere: supplied-dependency bindings at the
  scenario level (Guard Setup owns the catalog), and milestone display
  grouping by claim identity (waits on the claims store).
- **Claim-level gaps must stay visible** (discovered in the reference
  field run, 2026-08-06). Section coverage ranks guarded above
  untestable, so when a section has both scenarios and gapped claims,
  the gap reasons vanish from the doc coverage view and survive only as
  counts in the status summary. A reader looking at a section must see
  its gapped claims alongside its scenarios.
- **Coverage status vocabulary** (decision 2026-08-07). Every user-facing
  coverage status, on sections, flows, and overview counters alike, is
  one of exactly FIVE words: Succeeded, Failed, Blocked, Not testable,
  Never run. Statuses derive from claim states per §2 (worst-first when
  a section mixes states); a section whose claims are all gapped shows
  what its gap reasons derive (Blocked or Not testable), never a mute
  bucket. A stale bind is Blocked (actionable), not a status of its own.
  "Not generated", "unguarded", and every other legacy status word
  disappears from user surfaces. Scenario-level RUN verdicts keep their
  pass/fail wording (§2).
- **Claims are a first-class stored layer** (decision 2026-08-06).
  Extracted claims persist in their own store: identity doc+anchor+title,
  the claim sentence, and content identity for invalidation, produced by
  this workstream's planning layer. Four consumers require it: the
  claim-keyed coverage accounting and its chips (which already reference
  claim ids today, as dangling references), user decisions (dismissals
  and disputes must attach to objects that survive regeneration),
  precise incrementality (a doc edit invalidates exactly the claims
  whose content changed, and only their flows re-author), and the
  benchmark comparison (engine claims against reference claims). Claims
  render WHERE the user already is (decision 2026-08-07): clicking a
  section shows its claims, with the trace from scenario to milestone to
  claim to doc sentence; there is no separate claims tab, because a
  parallel surface adds navigation without adding information.
- **One list UX** (decision 2026-08-07). Every list surface in the
  dashboard uses one shared list component: one search behavior, one
  filter idiom, one grouping mechanism (collapsible where a surface
  needs it, like coverage), one chip-label convention, one
  preview/pin interaction. Variation is configuration of the shared
  component, never a reimplementation per surface.

### 8.3 Planning layer (deterministic, unchanged)

Sections → claims → flows (synthesis, subsumption, epics) → journey mapping →
surface gating (no HTTP signal ⇒ no api candidate) → per-flow inputs hash.
Near-duplicate flows are dropped at synthesis, so no two workers can ever be
assigned overlapping paths — sharing questions are settled before workers
exist.

### 8.4 Flow workers (the pivot)

One worker per flow×surface, scheduled over a **dependency DAG** (epic members
settle before the epic; the epic worker receives members' settled scenarios as
read-only inputs). N workers run in parallel under a concurrency cap.

A worker is **one agentic session**:

- **Inputs**: the flow (claims, in order), the bound journeys (full grammar /
  operation schemas), the recipe + externals view, and the fixture catalog
  (the declared `setup.files`/seed assets a scenario may materialize — the
  data analog of the journey catalog; a flow whose data no fixture provides
  and no public step can create is `blocked (missing-data)`). No filesystem.
  The tool surface enforces the journeys-only rule.
- **Tool** (exactly one): `run_scenario(yaml)` — execute in the sandbox (the
  existing executor, budgets, group-kill, capture); returns the structured
  capture. There is deliberately no probe tool: journeys carry the complete
  grammar, and probing (`--help` parsing) happens once, at journey DERIVATION
  time in the mapper — contract construction, not consumption. A worker that
  observes the sandbox contradicting a journey (a promised flag rejected)
  reports a journey defect; it never works around one.
- **Loop**: draft → run → observe → revise, until the scenario passes or the
  worker concludes a structured outcome, within a per-flow turn/token budget.
- **Outcomes** (structured, exhaustive): `settled(scenario)` ·
  `blocked(per-milestone, named capabilities)` · `journey-defect(report)` ·
  `retired(attempts exhausted — ledger)`. A worker cannot end without one.
  "Re-author next run" is not an outcome; in-run completion is structural.

Triage disappears as a stage: its judgment (test's fault vs code's fault) is
the worker's own loop while the flow is still open. What a failing scenario
means when the worker *commits* it as failing (real drift) is recorded with
the worker's diagnosis — red with a verdict, in-run.

### 8.5 Verification (deterministic, outside the agent)

- **Confirmation run**: the final YAML executes once in a fresh sandbox the
  worker never touched — the gate of record (today's "birth", kept).
- **Fidelity judge — kept, but in-loop.** Execution feedback is blind to
  exactly one defect class: a green whose assertion doesn't prove its claim
  (a worker converging on "passes" can weaken a matcher until it passes, and
  the sandbox reports success — field data: 12 of ~35 greens discarded as
  unfaithful in one run). Faithfulness is semantic, so it needs a reader; and
  the author cannot be that reader — the context that wrote the weak
  assertion will find it faithful. So: a fresh-context judge call reviews the
  candidate INSIDE the worker's lifecycle, and a flag returns to the still-
  open session as an observation to revise against. Independence by context,
  not by sequencing; discard-as-afterwork ceases to exist. The judge runs
  on the same model as everything else (§3.4): its independence comes from
  fresh context, not from being a different model.
- **Model policy**: one model for authoring and judging alike, per §3.4.
- **Ledger**: per-flow attempt caps and retirement (with its three resets)
  unchanged from #861.
- **Claim accounting, settle line, gap vocabulary**: unchanged from #861/#868.

### 8.6 Sessions

Per §3.2, every LLM task is an agent session; the flow worker of §8.4 is
already one. These are the seed definitions for the owner to refine.

- **Claim extraction session** (per doc or area). Prompt: extract the
  testable claims. Inputs: the doc and its area context from the curated
  corpus. Tools: read a referenced or neighboring doc section. Done:
  claims with anchors (the identity unit of §2).
- **Flow synthesis session** (per area). Prompt: compose claims into
  ordered user journeys, with subsumption and epics, honoring the
  coverage rules of §8.2 (edge and corner cases, and every configuration
  path). Inputs: the area's claims, the journey catalog, and the
  dependency catalog (§7). Tools: one deterministic checker that
  validates a candidate flow set (duplicate and near-duplicate detection,
  journey bindability, claim coverage accounting) and returns its defects
  as the next observation. Done: a flow set that passes the checker, plus
  structured gaps for claims no flow can carry.

  The checker is not new machinery: the engine already runs these exact
  checks deterministically (near-duplicate subsumption, unbindable-claim
  detection, the coverage honesty rule), but today they run as one-way
  post-passes AFTER the one-shot synthesis call, so their findings end as
  silent drops and write-offs the model never sees: a near-duplicate flow
  is deleted, an unbindable claim is written off as a gap. The session
  repackages the same checks as its tool, so every finding returns as an
  observation ("this flow duplicates that one", "this claim binds to
  nothing") and the session revises the draft instead of losing the work.
  A gap survives to the done-outcome only when revision genuinely cannot
  carry the claim, not because a post-pass discarded it unseen.
- **Flow worker.** As specified in §8.4 and §8.12: the scenario-execution
  loop with the exhaustive outcome set. Unchanged by this list.
- **Fidelity judge session.** Independence comes from fresh context, not
  from being one-shot. Prompt: a skeptical reviewer asking whether the
  assertion proves the claim. Inputs: the claim, the candidate scenario,
  and the execution capture. Tools: read the claim's source section in
  context. Done: a verdict with confidence; same model as every session,
  per §3.4.

### 8.7 Observability

The split (decision 2026-08-06, supersedes both the #857 display spec and
the earlier per-flow-rows CLI draft): the CLI shows simple progress; the
dashboard gets everything.

- **No progress panel for the streaming commands** (decision 2026-08-08,
  scoped 2026-08-08): for scan, setup, and generate — the agentic,
  streaming work — the dashboard shows a TOAST with a link to the live
  streaming view; progress renders in exactly one place, the view the
  toast links to, and the progress panel dies for those commands with
  the implementation. `guard run` KEEPS its current progress panel as it
  exists today (a run is bounded execution, not a stream to follow).

- **CLI — simple progress.** One continuously updating summary built from
  the partition counter that always sums —
  `settled 41 · active 6 · queued 52 · blocked 7 — of 106`. Flows settle
  continuously, so the numbers move for real, not settles-last. No
  per-flow rows, no per-worker lines, no per-turn detail in the terminal:
  generate prints the dashboard deep link to the flows view at start
  ("watch live: <url>") and the rich view lives there. The dashboard is
  an independent process and can be opened before, during, or after the
  run.
- **Dashboard — the full stream.** Everything the run produces streams to
  the dashboard live: every session's transcript turn by turn, tool
  results, judge verdicts, outcomes, and settle events. The transcript
  artifact IS the live feed: workers APPEND each turn to
  `guard/authoring/<runId>/<flowId>.<surface>.jsonl` (gitignored, like
  evidence) as it happens; the dashboard server's existing store watcher
  tails the file and forwards appended lines over the existing sockets
  into the flow detail. The CLI knows nothing about the dashboard — if
  it's up you watch live, if not the same file replays later, and the
  cloud version tails the same artifacts from its store. One append-only
  file, two readers; no CLI↔server coupling.

  Transcripts persist with the run, so this view is not live-only: post
  factum, the user opens any flow and reads exactly how its scenario came
  to be (each draft, each execution and its result, each revision, the
  judge's flags, the final outcome). "Why does this scenario look like
  this" is answered by reading, not forensics, at any later time.

### 8.8 Incrementality, caching, cost

- The **settled scenario + outcome is the cache**; the per-flow inputs hash
  (flow fingerprint + journey fingerprints + recipe fingerprint + loop/prompt
  version) decides skip vs re-work, exactly as today.
- Worker transcripts are not KV-cached; per-turn prompt caching rides the
  provider session (claude `--resume`; api cache_control).
- **Estimate**: per-flow turn budgets make the pre-flight honest — flows ×
  [min, max] turns plus judge sessions, all at the one model's prices
  (§§3.4–3.5). No more per-stage call counts that assume the worst
  everywhere. The owner formalizes this into the workstream's estimation
  algorithm per §3.5 (session types, work items, turn ranges, cache
  exclusions).
- **Budgets**: per-flow turn cap (default ~8) and token ceiling; the ledger
  caps attempts across runs. A budget-exhausted worker retires the flow with
  its transcript — loud, in-run.

### 8.9 Implementation plan (seed record)

Recorded 2026-08-05. Phased so every phase lands green:

- **Phase 1 — the loop, and journey completeness.** `agent-loop` module: turn
  seam on `LlmTransport` (both modes), tool dispatch, budgets, transcript
  artifact, malformed-turn re-ask; no engine wiring yet. In parallel, the
  journey completeness work (§7.3, the Guard Setup workstream): tree∪probe
  union with discrepancy diagnostics, the root-command journey,
  inherited/program-level flags, and the self-verification gate over
  TrueCourse's own CLI.
- **Phase 2 — workers replace the authoring core.** The per-flow worker
  becomes THE path for cli-surface flows; the superseded orchestration
  (evidence-retry stage, partition call, triage stage, their prompts and
  caches) is deleted in the same change. Planning and verification layers
  reused as-is. No flags, no dual engine — the recorded baseline (106 flows,
  $124, 20 scenarios written, 33 stranded) is the comparison target on paper:
  the new engine's first full run must beat it on settled flows and cost per
  settled flow, with zero stranded by construction.
- **Phase 3 — the rest.** api surface + epic DAG scheduling **(DONE
  2026-08-05: api flows author through `runFlowWorker` under
  `WORKER_API_SYSTEM_PROMPT`, the one-shot author/runner/schema deleted;
  api settled candidates confirm ISOLATED per candidate under the existing
  isolation cap, overflow batched, one flip-resume routing for both surfaces;
  epics schedule as a second wave with settled member scenarios read-only in
  the prompt; `onFlowState` per-task lifecycle hook landed for the display
  cutover)**; CLI display cutover; dashboard live transcripts; the
  terminology sweep.

### 8.10 Testing strategy

- **Loop units** (no network): a scripted fake provider drives deterministic
  turn sequences — tool dispatch, budget exhaustion, malformed-turn re-ask
  (bad JSON turn → re-ask → recovery), transcript shape and persistence.
- **Worker units**: scripted provider + the REAL sandbox executor against
  `guard-fixture-cli` (relkit). The canonical convergence script: turn 1
  authors with a wrong flag → `run_scenario` returns the usage error → turn 2
  fixes it → settled. Plus: blocked outcome (named capability), journey-defect
  outcome (grammar contradicted by the sandbox), budget-exhausted retirement.
- **Verification gates**: existing birth/fidelity/ledger suites continue to
  run unchanged — they are the contract the workers must satisfy.
- **E2E**: the real CLI driver with the `fake-claude` binary extended to speak
  the `--resume` turn protocol (dispatch on session id + system prompt, as the
  existing fixture dispatches on system prompt today).
- **Benchmark harness**: a scripted run-and-compare against the recorded
  baseline metrics and, once confirmed, the reference corpus (§4) — real
  models, run manually/nightly, never in CI.
- **CI**: everything above except the benchmark is fake-provider and runs in
  the sharded suite.

### 8.11 Risks and open questions

- `claude -p --resume` session semantics (persistence window, caching
  behavior) needed a spike; fallback was full-context resend per turn
  (correct, costlier). **Spike done 2026-08-05: resolved, see §3.3.**
- Cost variance per flow is real; budgets bound it, and the estimate's ranges
  must be honest about it.
- Parallel workers vs provider rate limits: start with the executor's
  concurrency cap; make it configurable.
- EE observability (trace store) wants the transcript stream — later work,
  same event shape.

### 8.12 Worker implementation decisions (2026-08-05)

The worker's shape, bound before implementation.

**Worker = wrapper around `runAgentLoop`** in
`packages/guard-generator/src/worker.ts`. One worker per (flow, cli-surface)
authoring task, run under the existing shared `pLimit` in place of
`authorFlowScenario`. The api surface keeps the one-shot path until Phase 3.

**Prompts.** A new constant `WORKER_CLI_SYSTEM_PROMPT` teaches the scenario
format, composition rules, and worker conduct; ALL per-flow content (flow,
milestones, command grammar, recipe view, doc examples, externals) rides the
USER message — the system prompt stays byte-constant across flows for
provider prompt caching and for fake-claude's exact-identity dispatch (the
fixture matches stage constants as PREFIXES, since the loop appends its
action-protocol block). Authoring-time `--help` probes are NOT worker inputs
(journeys carry the grammar after §7.3); `ground.ts` stays for the api path
until Phase 3.

**The one tool.** `run_scenario` takes `{ scenario }` — the raw behavioral
scenario as a JSON object (same `RawGeneratedCliScenarioSchema` the one-shot
path parses; the "yaml" in §8.4 is the artifact, not the wire shape). The
tool: (1) Zod-parses; (2) runs the cheap engine validators first — composition
defect, invalid `matches` regex, doc-example byte fidelity — and returns a
structured validation error WITHOUT sandbox spend; (3) otherwise builds the
engine-owned scenario (`buildFlowScenario`, id assigned once per task and
reused) and executes it through the existing `GuardExecutor`
(`persist: false`, shared build, per-candidate timeout); (4) returns the
structured capture (`GuardScenarioResult` + failure excerpts) as JSON.
Milestone coverage is reported in the tool result as advisory; it is ENFORCED
at settle.

**Outcomes** (the loop's outcome schema, exhaustive):
- `settled` — the final scenario plus per-milestone statuses
  (`covered` / `blocked(blockedOn)`), and, when the scenario is committed
  FAILING, the worker's diagnosis (drift vs generation defect is the worker's
  call now — triage's judgment, in-run). The settled scenario must be
  byte-identical to the LAST `run_scenario` invocation — an unexecuted
  scenario cannot settle.
- `blocked` — nothing testable; per-milestone blockers named.
- `journey-defect` — the sandbox contradicted a journey (flag rejected,
  grammar missing something the CLI demands); carries the journey id, the
  argv, and observed vs promised. Recorded as a first-class run output.
- Budget/malformed/turn-error endings map to the EXISTING attempt ledger:
  bump, and past the cap the flow retires (machinery unchanged).

**Verification stays outside the agent.**
- In-loop fidelity: when the loop settles a PASSING scenario, the existing
  fidelity runner (fresh context, judge model) reviews it before acceptance;
  a high-confidence flag RESUMES the still-open session (the loop grows a
  `resume` option: prior messages + sessionId + a new observation message)
  for one heal attempt; a second flag rejects + ledgers exactly as today.
- Confirmation: settled-passing candidates from all workers batch into ONE
  final birth round in fresh sandboxes (today's machinery, kept — the gate
  of record). A confirm flip re-opens the session once with the evidence
  (replacing the evidence-retry stage); a second failure commits the
  scenario failing with the worker's diagnosis.

**Deleted in the same change** (cli path): `partitionFlowScenario` + its
schemas/prompt/cache-key, the evidence-retry stage (`guard.retry`) + its
prompt context + cache key + model policy entry, the whole triage stage
(`triage.ts`, runner, orchestration, `.cache/guard/triage`), and their
progress hooks. Partial coverage becomes the settled outcome's per-milestone
statuses (same manifest `milestones` shape, so read surfaces keep working).

**Caching.** The settled outcome IS the cache, under the existing
`guard/generate` cache name: key = today's `authorCacheKey` with the worker
system-prompt fingerprint replacing the one-shot's; value = the worker
outcome (scenario/blocked/diagnosis). A hit re-validates exactly as today
and skips the session entirely. Transcripts are never cached.

**Transcript artifact.** Loop events append to
`guard/authoring/<runId>/<flowId>.<surface>.jsonl` (runId minted per
generate run and recorded on the report), via store helpers next to the
evidence writers; `guard/authoring/` joins GITIGNORE_CONTENTS. The dashboard
tail comes with the display cutover; the files land with the workers.

**Stage accounting.** Worker turns account under `guard.generate` (calls =
turns). `guard.retry`/`guard.triage` leave the usage stages with their
stages; fidelity accounting unchanged.

## 9. Workstream: Guard Run (owner: TBD)

### 9.1 Scope

The deterministic runner and its run store: executing committed scenarios,
recording results, and the status/coverage read surfaces built on them. No
LLM is involved anywhere in this workstream — items here are correctness
fixes to the run machinery itself.

### 9.2 Known problems the design must solve

- **A scoped run replaces the whole board** (field evidence 2026-08-08).
  Running a single scenario overwrites the recorded current-state view
  with just that one result: every other flow's last verdict is lost and
  reads "never run", even when a full board ran minutes earlier. A scoped
  run must MERGE into the existing board — update the scenarios it
  actually ran, leave every other scenario's last recorded verdict (and
  its run timestamp) standing — so the board always shows the latest
  known verdict per scenario, whatever mix of full and scoped runs
  produced it. Corollary: a scenario deleted from the corpus drops out of
  the merged view rather than surviving as a stale verdict.
- **A step cannot reuse what an earlier step produced** (decided
  2026-08-09: build it, both drivers). Real workflows chain — a CLI
  prints an id and the next command takes it; an API response carries an
  id and the next request uses it. A scenario today cannot express that:
  every argument is literal, so any claim of the form "take what it
  printed and pass it on" is untestable, and the whole flow-curation
  command family (which operates on run-time ids) is unreachable. The
  format grows CAPTURE: a step names a piece of its output (a pattern
  over stdout for CLI steps, a field of the response for API steps), and
  later steps reference the captured value in their arguments, requests,
  and expectations — the same reference mechanism scenarios already use
  for registered dependency values. Captured values are also usable
  inside EXPECTATIONS, with comparison (equals, at-most, at-least), so a
  claim like "the real bill lands at or below the estimate" is testable:
  capture the estimate in one step, compare the actual against it in a
  later one. Determinism discipline: a capture that does not match is
  that step failing (with the output as evidence), never an empty value
  flowing on.
- **No network isolation — an accepted limitation, with manual-run flows**
  (decided 2026-08-09). The runner does not offer an offline switch —
  OS-dependent machinery whose cost outweighs the claims it would unlock.
  But the offline claims ("a fresh clone scans offline", "the estimate is
  deterministic and offline") still get their flows AUTHORED, not
  dropped: such a flow is marked as requiring a MANUAL precondition (the
  network off), a normal board reports it Blocked with that reason rather
  than running or hiding it, and the user runs it scoped after arranging
  the condition. The scenario's first step PROVES the precondition — it
  attempts a network reach and expects failure — so a manual run with the
  network still up stops at the probe instead of passing for the wrong
  reason. Revisit real isolation only if offline promises multiply.
- **No mid-run interrupt — an accepted limitation** (decided 2026-08-09).
  A step runs its command to completion; there is no "terminate it once
  the output shows X" verb, so the resume-from-cache promises (an
  interrupted scan or generate resumes from cache on the next run) stay
  recorded gaps rather than growing process-control machinery.
- **The driver belongs to the STEP, not the scenario** (decided
  2026-08-09). A real promise often spans surfaces — "create it through
  the API, the CLI lists it" — and a scenario that is wholly one driver
  cannot state it. The target: a scenario is driver-agnostic; each step
  declares how it acts (a CLI invocation, an API request), the sandbox
  is ONE world that can both start the service and run the CLI, and the
  step detail already renders its driver as a per-step chip. The
  scenario-level driver field becomes derived ("the drivers its steps
  use"); what "one scenario per (flow, surface)" and per-driver coverage
  counting mean under mixed scenarios is redefined by the owning
  workstreams when they land this — the decision here is the principle,
  not the migration. Sequenced behind the api reference wave: the
  current api-family flows do not need mixing; the first flow that
  states a cross-surface promise does.
- **A step can edit only whole files — grow a patch step** (decided
  2026-08-09: build). A flow that must change ONE field of a supplied
  instance's structured file (break the build command in the registered
  subject's recipe to prove the error path) cannot: the write step
  replaces whole files, and the test may not invent the rest of a file it
  does not own. The format grows a PATCH step: set (or remove) a named
  key path in a structured file, leaving everything else as found. A
  patch against a missing file, an unparseable file, or an absent key
  path is that step failing — never a silent create or a partial apply.
- **Scripted terminal answers must be keyed to their prompts** (field
  evidence 2026-08-09: build). Today an interactive step's answers are
  typed on a silence heuristic — the child goes quiet, an answer is
  typed — with a bounded retry when the terminal echoes it back. A long
  non-prompt phase before the question (an LLM login preflight with a
  spinner) defeats both: quiet gaps spend every answer before the real
  prompt appears, and the step hangs to its timeout. The format grows
  the fix the interactive-sequence decision (§7) already implies: each
  scripted answer names the PROMPT it replies to (its marker, from the
  journey's question sequence), and the runner types an answer only
  after that marker has appeared. No heuristic, no retry ambiguity; an
  answer whose prompt never appears is the step failing with "the
  question was never asked" as evidence.

## 10. Workstream: Web Driver (owner: TBD)

### 10.1 Scope

A third driver class (decided 2026-08-09): web surfaces verified through a
real browser. Scenarios stay declarative and deterministic — navigate,
click, fill, assert on visible text and the address — executed by a
browser-automation engine (Playwright-class), with no model anywhere in
the verification loop. The first subject is TrueCourse's own dashboard,
through the reference corpus: the dashboard's documentation page gains its
claims, flows, and hand-authored web scenarios like any other area.

Sequencing and method are the same reference-first ladder as CLI and API,
and strictly after the API path is stable:

1. Hand-author the reference — web journeys (the surface's pages and
   interactions), flows, and scenarios — and review them in the dashboard.
2. Grow the schemas and the runner until the reference is represented and
   RUNS: a web scenario executes in a sandbox, produces a verdict, and
   leaves evidence.
3. Only then design web generation, from this document.

The coverage machinery already expects this driver: web is a named
awaiting-driver today, so every surface that counts gaps per driver picks
it up without vocabulary changes.

### 10.2 Known problems the design must solve

- **Web journeys are a new mapping problem.** A CLI journey is a command
  grammar; a web journey is pages, navigation, interactive elements, and
  the authenticated states that gate them. What the mapper extracts, what
  a journey fingerprint covers, and what "the calling interface" means for
  a page must be defined before anything generates.
- **Determinism against browser flake.** A browser run is slower and
  noisier than a process run. The discipline is explicit waits on
  observable state (an element present, a URL reached), never timed
  sleeps; and any retry policy must be incapable of masking real drift —
  a flaky pass is worse than a red.
- **The subject must be running.** A web scenario needs the application
  serving before the first step; the recipe must be able to describe how
  the web surface starts and how readiness is observed, the same way it
  describes install, build, and entry today.
- **Evidence is visual.** A failing step's evidence is a screenshot, the
  relevant page excerpt, and the browser console — captured per failure,
  stored like CLI evidence, and rendered by the same drift surfaces.
