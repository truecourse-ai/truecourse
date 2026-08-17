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
- **The concept is named INTERFACE, one entry per invocable thing**
  (foundational; decided 2026-08-10). What the catalog stores is the
  code-derived calling interface, not a user's path — so the word
  "journey" retires everywhere (stores, schemas, views, CLI copy) in
  favor of "interface". Granularity follows the api precedent: ONE
  entry per command or operation, carrying its own fingerprint, with an
  explicit GROUP for the family it belongs to (the `rules` command
  tree, the `analyses` route family) — never a tree of commands in one
  entry, and never independent invocations rendered as sequential
  steps. Flows reference the exact entries their scenarios invoke. The
  web surface's contract shape adopts this vocabulary from birth.
- **Interfaces realize, never originate** (foundational; decided
  2026-08-10, recorded under the pre-rename word). Flows come from the SPECS and nowhere else; journeys
  answer only "with what can this flow be realized". A surface the docs
  do not promise (today, the dashboard server's HTTP API — it exists to
  serve the UI) is a REALIZATION surface: its journeys are derived and
  recorded, including the UI-to-API relation, so a scenario can act
  through it — but it grows flows of its own only on the day the docs
  promise it as a feature. Testing through the promised surface is
  enough; the un-promised one is a tool, not a subject.
- **The driver belongs to the STEP, not the scenario** (foundational;
  decided 2026-08-09; LANDED 2026-08-12). A scenario is driver-agnostic: each
  step declares how it acts (a CLI invocation, an API request), and the
  sandbox is ONE world that can both start the service and run the CLI —
  because real promises span surfaces ("create it through the API, the CLI
  lists it") and a scenario locked to one driver cannot state them. There is
  now ONE scenario schema and NO scenario-level driver field: the drivers a
  scenario exercises are read off its steps, and so is which executor it
  takes. Every workstream designs against this; nothing new may reintroduce
  the scenario-level-driver assumption. Migration details (what "per
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
on it. The provider seam is the SESSION DRIVER (decision 2026-08-17,
superseding the single-turn seam): a policy shell owns the semantics —
budgets, outcomes, transcript, resume — and a driver owns the mechanics
of running one session against one backend.

### 3.1 One loop, two transport modes (revised 2026-08-17)

- **claude-code mode**: the **Claude Agent SDK in streaming-input mode** —
  ONE live subprocess per session (the user's installed `claude` binary,
  the user's own harness login, exactly as today), tools as in-process
  SDK MCP handlers, the structured outcome via the SDK's native
  json-schema output format.
- **api / EE mode**: our own per-turn loop on the AI SDK's native tool
  calling. EE inherits via `ee-llm` re-exporting `llm-api`, as today.
- **Decision reversed (2026-08-17): the Agent SDK is now used** — as the
  claude-code SESSION DRIVER, not as a second loop. The earlier rejection
  ("a second loop, and Claude-only") predates two spike-verified facts:
  provider session ids are STABLE across resume hops (context carried,
  forking clean), and one subprocess serves every turn of a session, with
  subscription login inherited and no API key. Together those eliminate
  the per-turn design's two worst risks — the fenced-JSON text-action
  protocol and the per-turn process spawn. "Claude-only" stands and is
  priced in: the SDK driver exists in OSS claude-code mode ONLY; EE and
  api mode run our own loop, and the session-driver contract (§3.3) plus
  its conformance suite are what keep the two semantically one.

**First production consumer (2026-08-17).** The loop's first caller in the
product is INTERFACE AUTHORING — the web tasks no derivation produces —
shipped as `truecourse guard interfaces author`
(`packages/interface-author`, SPEC_GUARD_PLAN item 104): one session per
derived place, five read-only tools, an outcome the write path validates,
and the transcripts in the standard sessions store under a
`guard-interfaces` command. It also lands the piece every later workstream
needs — `createConfiguredSessionDriver` in core, the session analog of
`install-transport.ts`: the Agent SDK driver on Opus in claude-code mode,
the api driver on the configured flagship in api mode (§3.4). It is
deliberately a stage OUTSIDE §§6–8, so the loop is proven against a real
subject before the three owned workstreams build on it.

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

### 3.3 Loop implementation decisions (2026-08-05; driver architecture 2026-08-17)

Decisions made at implementation start; they bind the loop work. The
driver-architecture block of 2026-08-17 supersedes the per-turn seam;
the superseded paragraphs are preserved further down as the recorded
FALLBACK — paper only, built solely if the SDK path fails in the field,
never maintained alongside.

**The seam is a session driver (2026-08-17).** `runAgentLoop` in
`packages/shared` is the POLICY SHELL — the only entry workstreams call
— over a `SessionDriver` contract with two implementations: the api
driver (our per-turn loop, `packages/llm-api`) and the Agent SDK driver
(a new `packages/llm-claude-agent`, the only package allowed to import
the SDK wrapper). The contract:

- `runSession({ def, initialMessages, resume, onEvent, signal })`
  returns a handle: `done` (a promise that never rejects for semantic
  failures — those are events plus a structured result), an observable
  `status` (`running | waiting | parked | completed | failed`),
  `steer(message)`, and `interrupt()`.
- Every driver declares a CAPABILITIES struct (steer timing,
  structured-outcome mechanism, resume-at-message support). Driver
  divergence is a declared fact the shell reads, never an engine `if`
  on the driver's name.
- Turn end is DERIVED from session state transitions, never trusted
  from a provider turn event alone — provider lifecycle events are
  hints, and stale or out-of-order ones are dropped, not applied.
- The shell owns: budget counting, token/context ceilings with
  pre-emptive interrupt, resume grants, the malformed policy, sequence
  stamping, and sub-session depth. A CONFORMANCE SUITE runs both
  drivers through one spec — budget stop, steer ordering, resume,
  malformed mapping, outcome-less success — and is what keeps two
  mechanical drivers one semantic loop.
- Every tool DECLARES its identity — a `kind` plus read-only and
  destructive hints — and every invocation is bound to the session's
  identity in the transcript. Tool nature is declared at definition,
  never inferred from a tool's name downstream. One tool definition
  compiles to both the api driver's toolset and the SDK driver's
  in-process MCP server.

**Budget counts assistant messages (2026-08-17).** Every assistant
message — tool call or text — is one turn against the budget, counted
by the SHELL from its own events and enforced by `interrupt()` at the
boundary. The SDK's own turn limit is a distant backstop only, and its
`num_turns` is never read (spike: it is not on the budget's scale).
Ceilings enforce between turns and may overshoot by one turn; that is
recorded honestly, never hidden.

**Text turns are legal in both drivers (2026-08-17).** A text-only
reply is deliberation, appended and budget-counted, never re-asked.
Malformed narrows to: an unparseable action, an unknown tool,
schema-failing arguments, or a session ending without a valid outcome
(in the SDK driver: structured-output retries exhausted, or a success
result missing its structured output — both map to `malformed`).

**Resume is a fresh budget grant over an opaque cursor (2026-08-17).**
The semantics of the 2026-08-11/12 decisions are unchanged — hard
limit, N automatic grants, `budget-exhausted` on the last. The
mechanics are per driver: the SDK driver continues its LIVE process on
an in-run grant, and resumes a parked session by CURSOR (provider
session id, optionally a resume-at-message point) in a fresh process;
the api driver rebuilds from the persisted transcript. `resumeCursor`
is an opaque value owned and interpreted only by the driver, persisted
in the session index (§3.9). The transcript is audit truth, never
agent state.

**Failures carry a retryability axis (2026-08-17)**, orthogonal to
their kind: TRANSIENT (network, timeout — the shell retries the turn
once, and a retried turn does not count against the budget) versus
BLOCKED (auth, configuration, permission — the session parks loudly;
hammering a blocked dependency is forbidden).

**Isolation is invariant (2026-08-17).** The SDK driver always runs
with: no built-in tools (and deferred tool search disabled — the spike
showed tool discovery otherwise consuming the first turn), no settings
sources, no auto-memory, the system prompt fully replaced, the
subprocess environment spread from the parent's (a replaced
environment breaks credential lookup), strict MCP config, and
auto-compaction OFF. No session type may weaken these; a session that
needs the harness's own tools is a plan amendment, not a configuration
knob.

**Context exhaustion is a failure; compaction never runs
(2026-08-17).** Compaction silently rewrites what the model saw — the
transcript-fidelity hole this plan refuses. The shell tracks
cumulative context from usage envelopes and interrupts BEFORE the
wall; the session fails `context-exhausted`, a sibling of
`budget-exhausted` with the same resume path.

**Sub-sessions are depth 1 (2026-08-17).** Orchestrator → worker is
the only topology (§3.7's dispatch); a child dispatching its own child
is a structured error the parent sees as a tool result. The run-level
cap on live processes reserves child slots, so a full complement of
parents waiting on children can never deadlock the run.

**Provider session state lives in OUR store (2026-08-17).** The SDK's
session-store adapter points the harness's own session persistence
into the run's sessions store (§3.9), so a parked session survives the
harness's retention window, a machine move, or a wiped harness home.

**Distribution (2026-08-17).** The SDK driver spawns the USER'S
installed `claude` binary, resolved exactly as the one-shot transport
resolves it today. The SDK wrapper is version-pinned exactly and
declared optional, behind a lazy import with a clear install message,
so the published CLI never drags the SDK's bundled ~300 MB binary into
every install. A capability preflight on the session-init message
gates startup with a loud upgrade error — feature detection, never
version sniffing.

**One-shot stages migrate per workstream (2026-08-17).** Today's
single-request transport stages keep running beside the loop; each
workstream retires its own as its sessions land. §3.2's call-shape
rule is the finish line, not a precondition of the loop's delivery.

**SDK driver rules (spike-verified, binding).** The query iterator
THROWS after yielding an error-subtype result, so iteration is always
wrapped. `system/init` fires per TURN — never a process-lifecycle
signal; the session id is. Message handling is an exhaustive switch:
a compile-time exhaustiveness check PLUS a runtime warning fallback,
with an explicit known-and-deliberately-ignored list, so a new SDK
message type fails the build in development and degrades loudly, not
silently, in the field.

The paragraphs below are the original per-turn decisions. Only
claude-code mode needed a spike; api mode's turn mechanics were
already known.

**FALLBACK RECORD (2026-08-17).** Of the paragraphs below, the
per-turn claude-code mechanics, the `transport.turn` seam shape, and
the text-action tool-call protocol describe the superseded per-turn
design, preserved verbatim as the recorded fallback build. The api
session mechanics remain binding (they are the api driver's
internals), and the malformed-turn policy applies as narrowed by the
driver-architecture block above; everything from "Hard limit + resume"
onward remains binding as amended.

**claude-code session mechanics (spike result; FALLBACK).**
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

**Seam shape (FALLBACK).** `LlmTransport` stays `(req) => Promise<string>`. The turn
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

**Tool-call representation (claude-code half FALLBACK).** api mode: native AI SDK tool calling —
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

**Hard limit + resume (decision 2026-08-11).** The turn budget is a HARD
LIMIT with one purpose: no session may loop forever. Reaching it IS a
failure — the session ends with the structured `budget-exhausted` failure
outcome naming what it did not reach; it is never a success, never a
partial success, never a silent truncation, and no workstream may
re-interpret it. The other half of the same decision is RESUME,
implemented once in `runAgentLoop`: every session persists its transcript
and provider session id as it runs, so a session that failed on the limit
(or was interrupted) can be resumed with a fresh budget and continues from
the exact point it stopped — claude-code mode re-enters via
`--resume <session>`, api mode replays the persisted message history, and
resume also accepts a new observation message (the shape §8.12's fidelity
re-entry consumes). Command re-runs offer resume over restart. Workstreams
set NUMBERS only — each session type's hard limit and token ceiling — plus
the session definitions §3.2 assigns them (prompt, inputs, tools,
done-condition). All limit mechanics, the failure semantics, and resume
live in the shared loop; no workstream section defines or re-implements
any of it.

**No deterministic substitution on failure (decision 2026-08-11).** When
a session fails — budget-exhausted, malformed, transport error — the
engine NEVER falls back to a deterministic approximation of the
session's job and never completes the work another way. The failure
persists as a structured status in the command's result JSON (the
store's existing convention: scan's `llmFailures`, generate's
`result.json` / `llm-failed`), the command reports it loudly, and the
path forward is resume (above) or a re-run. Deterministic-FIRST is
unaffected: running a deterministic path BEFORE deciding a session is
needed (§7.1) is design, not fallback. What is forbidden is
deterministic work standing in for a failed session's outcome.

**Resume is AUTOMATIC, N times per run (decision 2026-08-12, from
Sarkis's §6 review).** The mechanics above are unchanged; what changes is
who triggers them. Resume as decided on 2026-08-11 is offered on a command
re-run — a user action — and at documentation scale that is not enough: a
budget that binds is the NORMAL path there, not a rare failure, so a
single scan would become a hand-driven sequence of 3–5 invocations of the
whole command. So the loop itself re-enters an exhausted session with a
fresh budget, up to `maxResumes` times within the one run, before the
failure surfaces at all. The count is a NUMBER each session type sets
(§§6–8) per the rule above, defaulting to 0 so a session that does not opt
in behaves exactly as it does today. Each resume emits its own transcript
event, so turns stay attributable; the hard limit becomes
`(maxResumes + 1) × budget` and is never negotiable at runtime; and the
session that exhausts the LAST budget fails exactly as this section
already requires — `budget-exhausted`, naming what it did not reach.
Resume grants time, never leniency.

**Module placement (revised 2026-08-17; package split settled with
Sarkis the same day).** ONE package defines the loop:
`packages/agent-loop` holds the session contract (transcript events,
session defs, the driver seam, the sessions-store shapes) and the
policy shell (`runAgentLoop`: budgets, ceilings, resume grants,
malformed policy, sub-session depth) — driver-agnostic, importing
neither `ai` nor the Agent SDK nor node builtins, with persistence
injected. One package per backend implements it: the api driver in
`packages/llm-api` (the only OSS package allowed to import `ai` —
kept there, NOT in agent-loop, because it shares internals with the
one-shot transport and the `ai` boundary plus EE's `ee-llm` re-export
hang off that package); the Agent SDK driver in
`packages/llm-claude-agent` (the only package allowed to reference the
SDK wrapper, so its optional-peer packaging stays scoped to one leaf).
`packages/shared` carries no loop code. The shell emits transcript
events through a sink callback; consumers wire the sink to the
sessions store (§3.9). The driver conformance suite lives in `tests/`
and runs both drivers through one spec.

**Delivery (decision 2026-08-07).** The loop is shared infrastructure
built ONCE, BEFORE the workstreams, and shared by §§6–8; no workstream
builds loop machinery of its own. This supersedes the loop's slotting
inside §8.9 Phase 1 — that phase consumes the shared module rather than
producing it.

**Implementation status (2026-08-17).** Landed, test-first, on
`sm/agentic-pipeline-plan`: the contract + policy shell
(`packages/agent-loop`, `tests/agent-loop/`),
the OSS file sessions store with the boot reconciliation sweep
(`packages/core/src/lib/sessions-store.ts`,
`tests/server/sessions-store.test.ts`), the api driver
(`packages/llm-api/src/session-driver.ts`,
`tests/llm-api/session-driver.test.ts`), the Agent SDK driver in the new
`packages/llm-claude-agent` (isolation invariants hardcoded; SDK wrapper an
optional peer behind a lazy import, pinned 0.3.233;
`tests/llm-claude-agent/session-driver.test.ts`), and the conformance suite
running both drivers through one spec
(`tests/llm-drivers/session-driver-conformance.test.ts`). The
`@anthropic-ai/claude-agent-sdk` import boundary is enforced by
`tests/architecture/ee-import-boundary.test.ts`. Still ahead per §3.9: the
session API library (inbound POSTs with command-id idempotency) and the
dashboard-server read routes; and per-workstream migration off the one-shot
`cliTransport` stages. The SDK driver has run only against the scripted
fake so far — a live smoke run against the real binary is the next
verification step.

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

### 3.6 Observability (decision 2026-08-11, generalizing §8.7)

Common to EVERY agentic command (scan, setup, generate — any command
that runs sessions); workstream sections define only their own display
specifics on top of it.

- **The dashboard gets everything, live.** The loop's transcript events
  (system, turn, reply, tool result, re-ask, outcome,
  budget-exhaustion) append to a gitignored jsonl artifact per work
  item in the sessions store (§3.9) as they happen; the dashboard server's existing store watcher
  tails the files and forwards appended lines over the existing
  sockets. The CLI knows nothing about the dashboard — if it is up you
  watch live, if not the same files replay later. One append-only file,
  two readers; no CLI↔server coupling. Transcripts persist with the
  run, so "why does this output look like this" is answered by reading,
  at any later time.
- **The CLI shows simple progress only** — continuously moving counters
  that always sum, no per-item rows, no per-turn detail — and ALWAYS
  prints the dashboard deep link to the live view at start
  ("watch live: <url>").
- **Progress renders in exactly one place**: the dashboard's live
  streaming view. The dashboard shows a toast linking to it; no
  separate progress panel for streaming commands. `guard run` keeps its
  bounded progress panel as today — a run is bounded execution, not a
  stream to follow.

### 3.7 Interactive sessions (decision 2026-08-13)

A session can converse with the user while it runs, the Claude Code
model: the user watches the live transcript and interjects; the
session ingests the message and revises course. Two loop capabilities
carry it, both built once in `runAgentLoop`:

- **User steering (renamed from "interjection", 2026-08-17).** A user
  message enters a running session as its next observation. WHEN it
  lands is a driver capability, not a uniform promise: the SDK driver
  feeds the live loop, so the message joins the running turn (a
  steer); the api driver delivers at the next turn boundary. Either
  way the transcript records the message at the moment the session
  ingests it. It is the same message shape §3.3's
  resume-with-observation consumes; steering and resume are one
  mechanism arriving at different times.
- **Sub-session dispatch.** A session may run other sessions as tools
  (the orchestrator pattern): the child runs on its own budget with
  its own transcript artifact, and its structured outcome returns to
  the parent as a tool result. A child's failure is a tool result
  naming the failure, never the parent's failure.

The chat surface is the DASHBOARD, never the CLI. §3.6 stands
unchanged: the CLI shows its moving counters and prints the deep
link; the user follows the URL to see the session and chat there. The
live transcript view gains a chat input for an active session.
Inbound delivery is the session API of §3.9: the run process serves
it locally, the dashboard server discovers the endpoint through the
run record and POSTs the user's message, and the message enters the
transcript at the moment the session ingests it, so the record stays
faithful to what the model saw when. Outbound stays §3.6's tailed
transcript files, which keep working after the process exits. The
decoupling holds in both directions: the agent knows nothing about
the dashboard (it only listens), and the dashboard finds the agent
through the store.

Interactivity is optional everywhere. In a non-interactive run (CI, a
PR gate, cron) a session never blocks on a question: it proceeds on
the persisted decisions it has, and a question it cannot settle ends
in the structured outcome as a pending question, reported loudly,
exactly like every other structured gap. Questions are STRUCTURED
(2026-08-17) — id, header, question text, options with labels and
descriptions, a multi-select flag — and travel as question-asked /
question-resolved transcript events under a server-minted correlation
id, with policy auto-resolving what it can in non-interactive runs; a
future interactive answer flow is a policy change, never a schema
change. In an interactive run a session may wait on input; an
abandoned wait parks the session through §3.3's persistence and
resumes when the answer arrives, never a silent hang. A waiting or
parked state that persists is always reconcilable at boot (§3.9's
sweep) — blocked state must never depend on process memory to be
resolvable.

### 3.8 Versioned store state and the branch/PR model (decision 2026-08-13)

Field driver (the first enterprise evaluation, 2026-08-13): corpus and
flows are tied to a branch today, a PR run has nowhere to store its
state, and a corpus change that re-runs generate destroys the previous
flow set instead of versioning it. One convention answers all three,
common to every store this plan touches; §6 and §8 instantiate it.

- **Version records with parent pointers.** Every scan writes a corpus
  VERSION and every generate writes a GENERATION: a record carrying
  its parent version id, the git ref/sha it was produced on, and its
  input fingerprints. History is the chain of records.
- **Pointers, never copies.** A version stores content-addressed
  pointers (a doc's content hash and its curation outcome; a flow id
  and its scenario/outcome object), so an unchanged item is a shared
  pointer into the previous version, stored once. Nothing unchanged is
  re-generated (the content-keyed caches and per-flow input hashes
  already decide skip) and nothing unchanged is re-stored.
- **Diffs are derived, never stored.** The dashboard's
  version-by-version view (back/forward navigation, each version
  diffed against its parent: docs kept/dropped/re-tagged, flows
  added/changed/removed) computes from adjacent records' pointers.
- **Main owns committed baselines.** The existing convention is
  unchanged: materialized current-state files commit only after
  merging to main. Version records are local and gitignored,
  mirroring the analyze store's snapshot files.
- **A branch or PR run derives a DELTA version**: local, gitignored,
  parented on the committed baseline. The PR's spec and code changes
  re-process only what they invalidate; results report as a diff
  against the baseline. Nothing is committed from branches; after
  merge, the run on main reproduces the same result through cache
  hits and becomes the next committed baseline.
- **PR run scope is the user's choice**: impacted-only is the default
  (the flows whose claims, journeys, or recipe fingerprints the
  change touched), `--all` runs the full board; runs on main default
  to the full board. An impacted-only verdict is reported as what it
  is, "nothing the change touched broke", never dressed up as a green
  board.
- **Commercial is the same model.** Versions become rows keyed
  (repo, ref, parent) instead of files; the parent-pointer chain is
  what makes the model portable between the file store and a
  database, and connected-tool sources (Confluence, Jira) version
  identically: the source snapshot's content hashes are the pointers.

### 3.9 The sessions store and the session API (decision 2026-08-13)

Conversation history is a data class of its own, never mixed into
domain stores. There is ONE record per session, its transcript: user
messages, model turns, tool results, and outcomes are all events in
one ordered file, because an agent session is one flow whose
observations happen to come from tools or from the user.

**The sessions store** (OSS):
`.truecourse/sessions/<command>/<runId>/`, gitignored entirely. The
command segment (`spec-scan`, `guard-setup`, `guard-generate`) says
what every run is without opening a file.

- `run.json` — the run record: command, git ref, started/finished,
  status, the live session-API endpoint while the process runs, and
  the session index (per session: kind, the work item it served,
  status, provider session id, budget spent). The dashboard lists
  sessions from here, never by parsing transcripts; resume finds
  parked sessions here.
- `<sessionId>.jsonl` — the transcript, appended by the run process
  as events happen (§3.6). Events carry full message content, never
  summaries: api-mode resume rebuilds the exact message history from
  the transcript, so completeness is correctness, not verbosity.
- Domain stores never embed conversation data; they REFERENCE session
  ids (a generation record names the worker sessions that authored
  it, a corpus version names its orchestrator session), resolved
  through the index. This supersedes §8.12's transcript location
  (`guard/authoring/<runId>/…`); the event shape and the writing
  mechanics are unchanged.

**The session API.** The process running the sessions serves a small
HTTP interface while it runs (127.0.0.1, random port, a token,
advertised in `run.json`): send a user message, and later control
verbs (cancel, resume, answer a pending question). Inbound only:
transcripts stream outbound as files, which is what keeps replay and
post-mortem reading independent of any live process. A message to a
dead endpoint fails loudly in the chat UI ("session not running");
resume starts a fresh process that advertises a fresh endpoint. There
is deliberately NO persistent daemon: the run process is the agent
server for its own run, and nothing outlives it.

**Built as a library.** The session API (route shape, schemas, and
handlers over the loop's sessions) is a host-agnostic module in
`packages/core`, its types in `packages/shared`. The OSS run process
is one host; EE's hosted runner is the other, serving the SAME shape,
so the dashboard client speaks one protocol in both worlds. In EE the
store side maps onto the database behind the storage adapter: a
runs/sessions table and an append-only transcript-events table keyed
(workspace, repo, run, session), domain rows carrying session-id
references only, with retention policy possible there.

**The EE port (locked 2026-08-13).** Four contained steps on top of
the OSS vertical, with no client work among them:

- **Client ports as-is.** The Activity surface, transcript
  renderers, cards, and chat input are shared dashboard-client
  components; EE enables them by adding `activity` to its curated
  guard tab order and role-gating the chat route (chatting is a
  write). The client reads through one protocol (list runs, get a
  run with its session index, page a transcript, subscribe to live
  events, post a message) served by dashboard-server routes in BOTH
  editions; only the server's backend differs.
- **Store maps table for table.** `run.json` becomes a runs row;
  each transcript jsonl becomes rows in the transcript-events table.
  The loop's SINK is the seam: the OSS sink appends lines, the EE
  sink inserts rows (the EE trace store is the home or the
  template). Retention policy is an EE store concern.
- **The runner hosts the same API.** The hosted job-queue worker
  executing the command hosts the session-API library and advertises
  its service endpoint in the runs row: the identical discovery
  pattern, file to row, localhost port to service URL. The web tier
  proxies chat to it exactly as the OSS dashboard server does. EE
  adds workspace authorization and attribution on top, never a
  different protocol.
- **Sequencing.** OSS lands the whole vertical first (loop, sessions
  store, session API library, Activity on real data); then EE: the
  two-table migration, the DB sink adapter, the runner hosting the
  API library, and tab order plus authorization.

Three schema decisions bake in from day one so EE never migrates for
them: `user-message` events carry an optional ACTOR identity (empty
in OSS, the workspace user in EE, so "who answered" is auditable);
every event carries a per-session MONOTONIC SEQUENCE number, so DB
paging and file tailing agree on ordering and resume; and the run
record's endpoint field is a URL plus auth token, never a bare port,
so the EE runner's service endpoint fits the same field.

Further store decisions of 2026-08-17, baked in for the same reason:

- Every event may carry a RAW escape hatch — the driver's native wire
  payload and its source — so the normalized record never loses the
  native one and a driver bug is diagnosable from the transcript
  alone. Streaming deltas never enter the durable transcript; the
  transcript is turn-granular, and live views stream at that
  granularity.
- Error events carry a CLASS (provider, transport, permission,
  validation, unknown), and failure records carry §3.3's
  transient/blocked axis, so a reader — human or shell — can tell
  retry from park without parsing messages.
- Usage records carry a COST-SOURCE provenance (provider-reported,
  model-priced, unpriced) and treat reasoning tokens as a SUBSET of
  output tokens, never an addend.
- The session index row carries the driver's opaque `resumeCursor`
  and a status vocabulary that includes `waiting` (blocked on input)
  and `parked` (§3.7) alongside running/completed/failed.
- Child-session events repeat their full linkage (child id, kind,
  work item, usage rollup) on EVERY event, so a reader folding the
  stream is order-robust — a completion arriving before its start
  still renders, and retention that drops the start loses nothing.
- Sending a message is IDEMPOTENT: the POST carries a client-supplied
  command id checked against a receipts record — a replay returns the
  original receipt and does no work, so a retried request can never
  double-deliver into a session.
- The store BOOTS WITH A RECONCILIATION SWEEP: a run left `running`
  by a crashed process is marked failed-interrupted, its orphaned
  session processes are killed, and any persisted waiting state is
  resolved or re-armed — nothing stays "running" or "waiting" on the
  strength of a dead process's memory.
- Transcript reads PAGE BY SEQUENCE CURSOR: a reader passes the last
  sequence it holds; replay beyond a bounded gap falls back to a
  fresh snapshot (an unbounded stale-cursor replay is a memory
  hazard), a SYNCHRONIZED marker separates catch-up from live tail,
  and the live subscription attaches BEFORE the snapshot read so no
  event falls between them. This is the read discipline of the
  dashboard-server routes in both editions; the session API itself
  stays inbound-only.

## 4. The reference corpus (the benchmark)

The first work of the plan. The corpus is hand-authored and depends on
nothing (no engine, no Phase 0), so it starts immediately and proceeds
while Phase 0 lands. Its scope grows driver by driver, in the §5 order:
the CLI surface first, then the API surface, then web (§10) — each new
driver enters the corpus the same way (hand-authored journeys, flows, and
scenarios, reviewed in the dashboard, run by the real runner) before any
generation is designed for it.

STATUS (2026-08-10, supersedes the 2026-08-09 block) — the corpus is
ANALYZE-ONLY by decision: the spec-consolidation and guard coverage
authored on 2026-08-08/09 is deleted, because it tested the current
scan/setup/generate engines, which this plan reimplements — a red
against a doomed engine measures the wrong thing. (The work paid for
itself before deletion: it forced the §9 runner builds, battle-tested
the format, and produced the engine-defect findings recorded in PR #872;
the fixtures it minted are kept on disk for future use, unregistered.)

The current work is covering ANALYZE on its remaining surfaces — the
dashboard (web, §10) and the dashboard server's HTTP API — under the
realization ontology of §2: flows come from the specs (the published
Dashboard doc, AS IT STANDS — a stale doc is wanted test material, and
its flows failing IS the deliverable; the docs are never pre-fixed to
help a flow pass), journeys for both surfaces say how flows are
realized (web scenarios; api or mixed steps through the recorded
UI-to-API relation), and API-specific flows exist only if the docs ever
promise an API feature. Split: api journeys derive from the dashboard
server's routes; the web driver machinery and the web journey contract
shape are §10's first stage, buildable in parallel (no shared files).
The finish line is unchanged: a board where every red is a marked
product finding or an accepted limitation, nothing else. Generation
design still comes last, per workstream.

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
overlap, curation) re-shaped as agent sessions, over a doc universe
this workstream also acquires.

STATUS: design settled 2026-08-11, revised 2026-08-12 (owner: Doil).
§§6.1–6.5 are the binding design; implementation may start per the
phasing in §6.5. The one open question is CLOSED (2026-08-11, Mushegh):
claims stay with Guard Generate per the 2026-08-06 decisions;
`transform-gaps.md` G1, G2, G10 and G12 carried a stale Spec Scan
ownership and have been corrected to match.

The 2026-08-12 revision answers Sarkis's review, each answer stated where
it binds: resume becomes AUTOMATIC and N-per-run (§3.3), because at
documentation scale an exhausted budget is the normal path and a
user-triggered resume would make one scan several invocations;
engine-side splitting is REMOVED rather than assigned an owner (§6.1),
because its blind spot is a set of doc pairs no corpus can record, and
breadth is instead settled by the area-settling session that owns the
label (§6.3); the cache records each session's tool read-set so a changed
read invalidates the entry (§6.5, Option B); and the overlap outcome
reports the sections it opened, a skim detector the review's own budget
arguments cannot supply (§6.2). Budgets are settled against a real corpus
for the first time (§6.4).

AMENDED 2026-08-13 (Mushegh, from the first enterprise field
evaluation): the scan gains an interactive scoping orchestrator and
user instructions (§6.3), a new known problem recording why (§6.2),
and corpus versioning per §3.8; §§6.3–6.5 carry the amendments
inline.

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
area tags, the within-area overlaps still awaiting a verdict, and the
relevance-dropped docs with their reasons — consumed by §8's planning
layer as its doc universe. `specs/decisions.json`, the user's curated
resolutions over that corpus, is this workstream's user-decision surface
and stays here; its verdicts are section-scoped (`conflictResolutions`,
alongside the manual include/exclude/area overrides, and, per the
2026-08-13 amendment, the scope verdicts and instructions of §6.3).
Doc-to-doc
relations are NOT part of the contract: they existed in an earlier
version, nothing consumes them now, and a legacy `relations` array is
dropped on parse — so the scope sentence above names no chains.

**Architecture principle: budget-bounded, never silently thinned**
(decision 2026-08-08). The scan's cost grows with the corpus, and the
stage that grows fastest — overlap — is bounded by giving each session
an explicit turn budget and letting it narrow its own reading (outlines
first, drilling in only where topics collide), never by the engine
pre-filtering what it will consider. The limit itself — hard cap,
failure on exhaustion, resume — is §3.3's shared mechanism, not this
workstream's to design. What is scan-specific is PERSISTENCE: a bound
that bound must be readable from the corpus itself, so a reader can tell
"no overlap found" from "the budget ran out"; `CuratedCorpusSchema` v3
has no field for this, and the gap is recorded in §6.2. Silently
reducing what the engine considers is the one failure this workstream
refuses.

**A bound scales by RESUMING, never by dividing** (decision 2026-08-12,
from Sarkis's §6 review). A budget that binds is answered by granting the
same session another budget — automatically, up to a fixed count, then a
loud failure (§3.3) — and never by cutting the area into parts. The reason
is the principle above: both mechanisms leave a gap, but only one of them
can be written down. A session that exhausts its last budget leaves a gap
that is a LIST OF DOCS (`notReached`) — the corpus records it and a reader
knows exactly what it means. A split leaves a gap that is the set of doc
PAIRS spanning the parts: combinatorial, absent from every output, and
unrecordable without enumerating precisely the pairs §6.3 stopped
enumerating. Engine-side splitting is therefore REMOVED from this
workstream. An area too big to examine is not a scheduling problem to be
solved over a dead session's corpse — it is a VOCABULARY defect, and it is
fixed one stage earlier by the area-settling session, which is alive, holds
the whole corpus, and already owns the label set (§6.3).

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

  FIELD EVIDENCE 2026-08-12 (the first run of these sessions at
  documentation scale — 766 Confluence docs from the Plat.ai LOS corpus,
  hand-driven per §6.3 because the shared loop does not exist yet; 450 docs
  kept, 875 tag mentions over 199 concerns, settled to 103 areas). What
  binds is TIME, not context: the largest area's inputs are 54.7 KB (~14k
  tokens), so no area is close to a context limit, and the cost is entirely
  the section reads a session spends to rule on a suspicion. Observed
  drill-in pace is 1.5–3.5 docs/turn. At budget 12, three of the six areas
  run ended `budget-exhausted` with 11, 15 and 24 docs unreached — meaning
  a budget that binds is the ordinary case at this scale, not the rare one,
  which is what §3.3's automatic resume answers. The distribution is what
  makes that affordable: the median area holds 3 docs and only 13 of 103
  areas exceed 20, so a raised ceiling is paid for by a handful of areas
  and the rest never approach it.
- **A session that skims cannot be told from one that reads.** Of the six
  areas above, the one that reported full coverage is the least
  trustworthy: `core/endpoints` (123 docs) closed in 10 turns having
  "reached" every doc at 12.3 docs/turn — four to eight times the pace of
  every area that actually opened sections — and returned 0.10 findings per
  doc, against 0.31 for `core/funding` and 0.22 for `core/auth`, which are
  the same kind of material (its 120 curated members are `kind: spec`
  without exception). Turn count cannot separate the two, because a session
  that never drills in spends few turns BY NOT WORKING. `notReached: []` is therefore not
  evidence of coverage, and today nothing else is recorded: the outcome
  carries no measure of what the session actually opened. This is the same
  defect as the bullet above one level down — a gap that the corpus cannot
  express — and it is the one an automatic resume will never fix, because a
  skimming session never exhausts its budget to begin with.
- **The cache can freeze a result its tool-reads have already made stale**
  (Sarkis, 2026-08-12). Every session's cache key is its declared INPUTS,
  and §6.3 deliberately keeps those minimal — doc content for curation, the
  label sets for settling — so that adding one doc does not re-curate the
  corpus. But a session also reads through its TOOLS: other docs, the
  vocabulary, the doc list. That data changes between runs while the key
  does not, so the first result is kept forever and the run that would
  disagree with it never happens. The failure is silent by construction:
  nothing in the corpus says a cached verdict rests on a document that has
  since been rewritten. §6.5 settles which way this is resolved; what is
  refused is leaving it unstated.
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
  answer all along. Settled per §3.3's no-substitution rule
  (2026-08-11): the axis is validated by SESSIONS — the doc-curation
  session proposes it and the area-settling session (§6.3) adjudicates
  it — and no deterministic backstop corrects agent output afterwards; a
  session that cannot settle the axis fails and persists that status.
  (The current engine's `thirdPartyRestored` backstop is the old
  pattern, not a precedent to extend.)
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
- **An enterprise corpus cannot be scoped upfront, and unscoped
  ingestion is unaffordable** (field evidence 2026-08-13, the first
  enterprise evaluation: a decade of Confluence, abandoned and
  contradictory docs throughout). Pointing the scan at everything
  spends flagship tokens on material nobody wants curated, and the
  user cannot author an exclude list in advance: on a connected tool
  they do not know what is there. Pattern/glob excludes were
  considered and REJECTED (2026-08-13, Mushegh): the engine proposes,
  the user decides. The answer is the scoping conversation of §6.3:
  survey cheaply, propose the scope, let the user keep or exclude in
  chat, and spend curation only on the kept scope.

### 6.3 Sessions

Per §3.2, every LLM task is an agent session. The common rules are §3's
entirely — one model (§3.4), the malformed-turn policy, the hard turn
limit that fails on exhaustion and resumes (§3.3). This section sets only
the NUMBERS and each session's prompt, inputs, tools, and done-condition.
Three numbers per session type, not two: the turn budget, the token
ceiling, and `maxResumes` (§3.3), which makes the effective hard limit
`(maxResumes + 1) × budget`. The numbers below are settled by the
2026-08-12 field run except where marked provisional (§6.4).

Two rules follow from §6.1's principle. Exhaustion semantics are the
loop's (§3.3); the scan adds only WHERE that failure persists — the
corpus field of §6.2 — so "no overlap found" and "the budget ran out"
stay distinguishable in the committed file, never an "I found nothing"
that reads like completeness. And a step whose deterministic path
settles everything runs NO session: discovery (the repo walk plus the
registered web sources), area grouping, the heading-widened membership
net, and persistence are free string work and stay that way.

**What the agent shape buys the scan.** Generate's sessions earn their
tools by acting on the world — author, run, repair. The scan reads, so
the question is fair: what does a tool call get it that one prompt
cannot? The answer is the overlap session, and it is the same answer as
§6.2's first problem. Judging whether two docs disagree needs their
disputed passages in full, but a prompt must choose its inputs BEFORE it
runs, so a one-shot pass has exactly two options: send every doc's full
text (accurate, and the cost curve that problem describes) or send
outlines only (cheap, and it misses what the outline does not say). A
session chooses AFTER it starts — it reads outlines, notices two docs
circling the same subject, and spends a tool call opening just those
sections. Cost tracks suspicion instead of corpus size, which is what
makes an explicit budget a real bound rather than a truncation. The
other two sessions use tools for the same reason at smaller stakes: a
doc that defers to another doc is judged by opening it, and two labels
are merged by looking at how their docs actually use them.

**The scan orchestrator session** (interactive, per §3.7; decision
2026-08-13) fronts the three worker sessions below. `spec scan`
starts it; the CLI prints the dashboard deep link (§3.6) and the user
chats from the live session view. Its phases:

- **Survey** (cheap): reads the deterministic universe walk plus
  titles, paths, outlines, and source structure (a repo's doc tree, a
  connected source's space/page tree), never full doc contents.
- **Propose**: groups the universe into candidate product areas /
  scope groups and presents them with counts and reasons.
- **Converse**: the user keeps or excludes groups, corrects the
  grouping, and steers ("everything under /archive is historical");
  the orchestrator asks when unsure. Verdicts and the distilled
  steering persist to `specs/decisions.json` as SCOPE VERDICTS and
  INSTRUCTIONS (both committable), so a re-run never re-asks what is
  already answered; the conversation reopens only for universe growth
  the persisted verdicts do not cover (a new space, a new top-level
  tree).
- **Dispatch**: runs the worker sessions below (as §3.7 sub-sessions)
  over the KEPT scope only.

Instructions ride every scan session's prompt and enter its cache
key: editing them re-scans, which is correct and which the estimate
states (§6.4). In a non-interactive run the orchestrator never blocks
(§3.7): it applies persisted verdicts and ends with unanswerable
questions as pending-questions output.

Three worker sessions, in order; each consumes the one before it, and
all run over the orchestrator's kept scope.

- **Doc curation session** (one per doc, turn budget 5). Prompt: a spec
  curator deciding whether this doc describes user-facing behavior worth
  verifying, and which areas it belongs to. Inputs: the doc's content,
  and nothing else. Today's tagger is cached on doc content alone and is
  handed neither the vocabulary nor the doc list; putting either in the
  inputs would put it in the cache key, so adding one doc would
  re-curate the whole corpus — at flagship prices, on the term §6.4 calls
  dominant. Tools: read another doc (to resolve a reference), and look up
  the corpus's current vocabulary and doc list — tool calls do not enter
  the cache key. Done: keep or
  drop with a reason, plus area tags, each a `product/concern` pair. It
  PROPOSES the axis and does not adjudicate it: labelling each doc
  independently, it cannot see what the other docs chose, so consistency
  and the `core` verdict belong to the next session. This session
  absorbs today's separate relevance and area-tag calls, and that merge
  is where the scan's cost concentrates: two cheap one-shot calls, each
  cached per doc content, become one flagship-model session of up to
  five turns, multiplied by every doc. §6.4 must model it as the
  dominant term.
- **Area settling session** (one per corpus, turn budget 8). The only
  stage that sees the whole area vocabulary at once, so it runs after
  every doc-curation session and closes both consistency problems. It
  runs when either axis carries two distinct values (a collision is
  possible) OR any product is not `core` (a verdict is owed); zero
  sessions otherwise. The second half of that gate is load-bearing:
  today's vocabulary normalizer skips whenever BOTH axes have fewer than
  two values, which is exactly the single-area, single-product shape the
  reference has — the corpus whose invented `truecourse` product is the
  defect §6.2 records. Prompt: reconcile the emergent area vocabulary of
  this corpus. Inputs: the product and concern label sets, and nothing
  else — today's normalizer is cached on the vocabulary set alone, so a
  doc edit that does not move a label is free, and that property is kept
  by keeping doc-level detail OUT of the inputs. Tools: look up which
  docs carry a label, and read a doc (to decide whether two labels
  really name one concept) — tool calls do not enter the cache key.
  Done: the concern merges, the product merges, a verdict on every
  non-`core` product — justified, naming the second separately-deployed
  application, or collapsed to `core` — and the SUBDIVISIONS (below). That
  collapse is the one mapping today's normalizer forbids ("never to
  `core`/`process`"); the prohibition exists because no stage had the
  authority to make the call, and this session does. This is where §6.2's
  product-axis rule stops being a prompt sentence.

  **Subdivision lives here, and nowhere else** (decision 2026-08-12).
  Merging and subdividing are the same judgment run in two directions —
  does this label name one subject? — and this is the only session that can
  make either call, because it is the only one holding the whole label set.
  So it also splits a concern too broad to BE a subject: an area carrying
  more than 40 docs is a subdivision candidate, and the session either
  divides its label into subjects (`endpoints` → the subjects those docs
  actually describe) or states why the breadth is real. The threshold is a
  prompt for judgment, never an automatic cut. The field run is the case
  this answers: `endpoints` and `api` drew 123 and 116 docs, and neither is
  a subject — they name a SHAPE, which is what a doc-curation session
  reaches for when it labels a doc alone (§6.3's first session cannot see
  that 116 siblings chose the same word). Sub-areas are ordinary areas:
  nothing downstream can tell one from an area that was always separate,
  and no split is recorded anywhere, because at this point in the pipeline
  no comparison has been made to lose. This is the whole of §6.1's
  "resume, never divide" — a division decided by a live session over a
  label is a curation act; a division imposed on a dead session's area is
  the unrecordable gap that principle refuses.
- **Overlap session** (one per area, turn budget 15, `maxResumes` 2 — a
  hard limit of 45 turns). Prompt: find the real overlaps and conflicting
  statements among this area's docs.
  Inputs: the area's kept docs PLUS the heading-widened outside docs, as
  titles and outlines, not full contents. The widening stays: the doc
  sessions label independently, so the same subject lands under
  different concerns and the pair would never share an area to be
  compared. It is free string work, and dropping it would be exactly the
  silent thinning §6.1 refuses. Tools: read a doc section. Done: the
  overlap/conflict set with section anchors, an explicit "none found",
  or `budget-exhausted` naming the docs it did not reach — and, in every
  case, the COUNT OF SECTIONS IT OPENED. That count is §6.2's skim
  detector, and it is the one signal no budget can supply: a session that
  declines to read never exhausts anything, so `notReached: []` proves
  nothing on its own. It belongs in the corpus beside the completeness
  fields, not in a log line. It absorbs
  today's separate verify pass, which exists only because detection runs
  on a cheap model and over-flags, so a stronger model re-reads each
  flag with full context; §3.4 retires that split, and one flagship
  session holding a section-reading tool does both jobs in one place.
  Two properties of the pass survive into this session's outcome: a
  confirmed overlap carries its RESOLUTION BRIEF (what exactly
  disagrees, and the recommended action), and ruling is FAIL-OPEN — only
  an explicit refutation drops a flag, so an overlap the session could
  not rule on stays flagged rather than vanishing. The brief also
  carries a CONFIDENCE grade (decision 2026-08-14, LANDED in the
  current engine — preserve it): low / medium / high, graded knowing
  the stakes; a high-confidence pick-a-side or dismissal is
  AUTO-APPLIED by the scan as a `resolvedBy: 'auto'` conflict
  resolution (reported loudly, badged on every surface, undoable like
  any verdict, suppressing the loser exactly like a user verdict),
  lower grades stay advisory and surfaces show the grade, and a
  fix-doc recommendation never auto-applies regardless of grade. This session
  is also the answer to §6.2's scaling problem: the engine stops
  enumerating and judging candidate PAIRS — it still computes area
  membership, widening included, deterministically — and the session
  narrows its own reading (outlines first, drilling in only where topics
  collide) under the per-area budget, so the bound is an explicit
  budget, never a silent thinning of what is considered. An area whose
  work outgrows one budget is RESUMED, not divided (§3.3, §6.1): the same
  session re-enters with a fresh budget, keeping the whole area in view,
  twice. Only when the third budget is gone does it end
  `budget-exhausted` — and that outcome is a real result, not a failure to
  retry: the docs it reached were compared against the entire area, and
  the ones it did not are named. The engine never splits an area here
  (the 2026-08-11 wording, which split after resumes, is superseded by
  §6.1's 2026-08-12 decision). Breadth is settled one stage earlier, by
  the session that owns the label (above); by the time an overlap session
  runs, its area is the subject it is going to be.

There is no relation session. Doc-to-doc relations were removed from the
design (§6.1) and resolution is section-scoped: the overlap session
already returns section anchors, and the user resolves each flagged
disagreement with a `conflictResolutions` verdict carrying both docs and
both anchors. Reinstating doc-level relations would need its own schema,
store, and surface, and a reason to reverse the removal; neither exists
today.

### 6.4 Estimation algorithm

Per §3.5. Work items are the scan's session units — docs, the corpus,
and areas — and only the ones whose cached input changed; per changed
item, its session count × the session type's [min, max] turn range, at
the one model's prices:

- **orchestrator** — the survey is deterministic and estimates as
  free. The scoping conversation is user-paced, so the estimate names
  it as one interactive session without a turn range: pretending a
  number would be the dressed-up average §3.5 forbids. Scope shrinks
  the subject line honestly ("N of M docs in scope, K changed"), and
  an instructions edit invalidates every scan cache: the estimate
  shows that full re-scan, never hides it.
- **doc curation** — 1 × [1, 5] per in-scope PROSE doc whose content is not
  already in the curation cache. Structural docs (OpenAPI) are admitted
  deterministically and skip every prose stage, so they cost nothing
  here, exactly as the estimate excludes them today. Exact, and simpler
  than today: relevance and area-tags are two content-keyed caches
  gating two calls and the estimate reads both; one session means one
  cache to read and one count of misses.
- **area settling** — 0 when no doc-curation session will run: the
  vocabulary cannot move, so neither gate of §6.3 can open. Otherwise
  1 × [2, 8], labeled "may be a cache hit at $0". The estimate runs
  BEFORE the doc sessions, so it cannot know whether re-tagging will
  actually move a label or leave a non-`core` product standing — the
  same honesty §7.7 applies to a recipe that may verify clean.
- **overlap** — 1 × [2, 45] per area whose doc set (its kept docs plus
  its heading-widened members) holds at least one changed doc: budget 15,
  and the ceiling is the hard limit `(maxResumes + 1) × budget` because a
  resume is invisible to the caller and its turns are real spend (§3.3).
  Re-tagging can move a doc between areas, so this counts the areas
  visible before the run; a doc that changes areas re-runs both. The
  ceiling is wide on purpose and the range must be PRESENTED as a range
  (§3.5): the field run's areas are mostly tiny — median 3 docs, 13 of 103
  above 20 — so the typical area closes in one budget with no resume, and
  quoting an average here would sell a bill the large areas then break.

Deterministic steps — discovery, grouping, the heading-widened
membership net, persistence — estimate as free.

What this fixes in today's estimator. Today the overlap pass is
estimated in doc PAIRS: with a corpus on disk it uses the real area
structure, but the heading-widened cross-area pairs need doc content and
stay UNMODELED, and the verify pass is scaled by an assumed flag rate.
Both approximations disappear once the unit is the area and the verify
pass is absorbed (§6.3): the estimate counts areas, which it knows
exactly, and nothing is left out of the count. The price is COARSER
invalidation — today's per-pair cache re-runs only the pairs containing
an edited doc, while a per-area session re-runs its whole area. That
trade is accepted, because the pair count is exactly what §6.2's first
problem says must not be allowed to drive cost.

Unchanged items are excluded and labeled ("N of M docs changed"); when
nothing changed the estimate has no stages and the confirm prompt is
skipped — identical presentation to setup and generate.

**Turn ranges, settled 2026-08-12** by the field run §6.2 records (766
Confluence docs of the Plat.ai LOS corpus, sessions driven by hand because
the shared loop does not exist yet). The reference corpus could never have
settled them — its spec-consolidation coverage was deleted for testing an
engine this plan reimplements, and its six analyze docs are too small for
any area to exhaust anything — so these come from the only corpus at
documentation scale this design has met:

- **doc curation, budget 5, no resumes** — settled and generous. 760 of
  766 docs finished in ONE turn, 4 in two, and the worst doc in the corpus
  took 4. The `[1, 5]` range holds, but the estimate's max is the number
  that misleads: this session's realistic cost is ~1 turn per doc, and
  since it is the dominant term (one session per doc), an estimate quoting
  5 overstates the whole scan several-fold. Presentation, not budget, is
  what needs the care here.
- **area settling, budget 8, no resumes** — 5 turns used of 8 on a 199-label
  corpus, `notReached` empty. Kept at 8 rather than trimmed, because
  subdivision (§6.3) is new work this run did not perform.
- **overlap, budget 15, `maxResumes` 2** — the one number this run moved,
  and the reasoning is in §6.2's field evidence. Budget 12 was adequate
  below ~25 docs and bound hard above it (3 of 6 areas exhausted, 11–24
  docs unreached at 1.5–3.5 docs/turn). 15 is chosen over a size-scaled
  formula deliberately: a formula's constant would be fitted to this one
  corpus, while the resume loop needs no constant — it adapts to a
  session's actual difficulty, which the field run shows a doc count does
  not predict (two 41-doc areas ran at 1.5 and 3.5 docs/turn). Flat budget,
  scaled by resumes, also keeps §6.3's shape: one number per session type.

**Both open items observed, 2026-08-12** by a second pass over the same
corpus at budget 15 with subdivision and resumes in place (still driven by
hand — the shared loop does not exist — so the resume was implemented in the
dispatch script, not the loop). Full evidence:
`platai/platai-scan/CALIBRATION.md` (gitignored — customer corpus).

- **The subdivision threshold (40 docs) holds, and its effect is now
  measured.** It fired on 6 areas, divided 2 and defended 4 with stated
  reasons. The largest area fell from 123 docs to 42; areas above 40 went
  from 6 to 4. The result that most supports the §6.3 argument: the 38
  sub-labels produced by dividing `endpoints` (123) and `auth` (51) ALL
  routed into areas that already existed — the multi-doc area count went
  73 → 72, and no area was created. The subjects were already in the
  vocabulary; the docs had been parked under a word naming their template.
- **`maxResumes` 2 is confirmed sufficient, and not yet proven tight.** 4
  of 72 areas (5.6%) exhausted their first budget; all 4 closed on attempt
  2; none needed a third. The 45-turn hard limit was never approached (the
  deepest area finished at 29). Two of the four needed only 8 further
  turns, which is the population a resume rescues and a division would
  have mangled. The second resume remains headroom this corpus never
  spent.
- **The exhaustion rate went to zero.** v1 (budget 12, no resume, no
  subdivision) ended 3 of 6 areas `budget-exhausted` with 50 docs
  unreached; v2 ended 0 of 72 exhausted with 0 unreached.
- **`sectionsOpened` earned its place.** v1 recorded no section count, and
  its one comparable "completed" area (`notifications`, 42 docs, same
  prompt) was missing 3 disagreements v2 found. A completed area without a
  section count is not a judged area — which is exactly what §6.2 claims.

One correction to the range above: the overlap floor of 3 turns is a turn
too high. Small areas closed in **2**, and 55 of 72 areas finished in 8 or
fewer, so `[2, 45]` is the honest range — with the same presentation
caveat as doc curation, since quoting anything near the ceiling
overstates a corpus whose median area costs 6.5 turns.

**`maxResumes` 2 is now proven NOT sufficient — narrowly, 2026-08-14.** The
same corpus was re-scanned with its Jira export folded in: 3,694 docs
(766 Confluence + 2,928 tickets), 235 areas, largest area 299 docs — 4.8×
the corpus and 7× the largest area of the run above. Evidence:
`platai/platai-scan/CALIBRATION.md`.

- **1 of 159 areas exhausted the 45-turn hard limit**: `core/funding`
  (218 docs) spent 43 turns across three budgets, opened 108 sections,
  returned 22 overlaps and still named **110 docs it never reached**. That
  is the first area in either run to exhaust `maxResumes`.
- **7 areas (4.4%) needed a resume; 6 of the 7 closed.** Including
  `core/manual-review` at **299 docs**, which finished inside the limit at
  42 turns. Size does not predict exhaustion: a 299-doc area completed
  where a 218-doc area failed, because cost tracks how many suspicions
  need drilling into, not how many docs exist.
- Do NOT raise `maxResumes` globally on this: six of seven areas would gain
  nothing, and the hard limit is what stops runaway spend. The targeted fix
  is a third budget granted CONDITIONALLY — to an area still returning new
  overlaps when its last budget expires. `funding` was: 22 overlaps, second-
  densest in the corpus, still producing when it stopped.
- **Doc curation's degenerate distribution is now certain.** All 2,928 Jira
  sessions used exactly one turn — not one needed a second. Against budget
  5 that is a fivefold overstatement if the estimate quotes its ceiling, and
  on a 3,694-doc corpus that is the difference between ~3,700 and ~18,500
  turns. The bound stays 5; the PRESENTATION must say ~1.
- **Subdivision reproduced its signature result at scale**: 17 candidates,
  5 divided, 38 sub-labels, and every sub-label was a concern that already
  existed — creating zero new areas, exactly as in the run above. It did not
  cap the largest area this time, because the 299-doc area was judged genuine
  and then GREW as two divided labels routed mass into it. That is intended:
  subdivision moves docs toward real subjects, it does not bound area size.

### 6.5 Implementation plan

Prerequisites, external to this workstream: the shared agent loop (§3),
built once beforehand and shared by §§6–8 — this workstream builds no
loop machinery (§3.3 Delivery). Phase 0 (§5) lands first as it does for
every workstream, but none of its remaining deletions touch the scan, so
Phase A does not wait on it.

**Phase A — deterministic + schema work.** Starts now; needs no loop.

- The corpus carries its own completeness (§6.2). `CuratedCorpusSchema`
  gains, per area: the outcome that separates a scan which finished from
  one a budget stopped, the docs it did not reach, the turns it spent
  (resumes included), and the SECTIONS IT OPENED — the last of these being
  the only field that catches a session which skimmed instead of stopping.
  `CurateStats` stays the run-local record it already is.
- **Cache honesty: record the read-set** (decision 2026-08-12, Sarkis's
  Option B). A session's cache entry stores, beside its keyed inputs, the
  path and content hash of every file it opened THROUGH A TOOL; a later
  run treats the entry as a miss when any recorded hash has moved. This
  keeps §6.3's minimal keys — the property that stops one new doc from
  re-curating the corpus — while closing §6.2's freeze: a verdict that
  rested on a document since rewritten is recomputed rather than served
  forever. Option A (accept the staleness, write an ADR) is REJECTED: the
  reasoning was sound but its failure mode is a corpus that looks complete
  and is not, which is the single failure §6.1 exists to refuse, and a
  read-set is a cheap price for not reintroducing it. The extra cost is
  bounded by what sessions actually read — curation's tools fire rarely
  (760 of 766 docs closed in one turn, opening nothing), so most entries
  carry an empty read-set and behave exactly as today.
- Heading-widening becomes area MEMBERSHIP rather than pair enumeration
  (§6.3). The deterministic net still runs and still costs nothing, but
  its output joins an area's doc set instead of producing candidate pairs
  to judge.
- The overlap cache is keyed by area, not by pair (§6.4) — the
  invalidation change the unit change forces, and what lets the estimate
  count areas.
- Retire `CurateModels`' five per-stage model slots (relevance, areaTag,
  vocab, overlap, verifyOverlap) per §3.4; `fallback` stays.
- Corpus versioning per §3.8: per-scan version records with parent
  pointers and content-addressed doc outcomes (records gitignored,
  `corpus.json` stays the committable materialized state, the analyze
  store's convention), and the dashboard's version-by-version view
  with derived diffs.
- `specs/decisions.json` grows scope verdicts and instructions
  (§6.3); the corpus records the scope it was curated under.
- Rewrite the scan estimate per §6.4.

**Phase B — the sessions.** Blocked on the shared loop landing, and now on
one loop capability specifically: automatic resume (§3.3), without which
the overlap session's bound cannot scale and a full scan becomes a
hand-driven sequence of re-runs.

- The scan orchestrator session (§6.3), additionally blocked on the
  loop's interjection and sub-session dispatch (§3.7) and the
  dashboard's chat input on the live session view.
- The three worker sessions of §6.3, in order, each consuming the previous: doc
  curation, then area settling, then overlap. Area settling closes
  §6.2's product-axis gap — the `core` verdict becomes a session outcome
  instead of a prompt sentence — and owns subdivision, the only place an
  area is ever divided. Overlap retires the separate verify pass, whose
  reason to exist is the cheap/strong model split §3.4 removed.
- Re-check on the first loop-driven run what the hand-driven one could not
  (§6.4): whether `maxResumes` 2 is enough in practice, and what the
  subdivision threshold does to the area-size distribution. Write both
  back into §6.4.

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
  Decided 2026-08-09, LANDED 2026-08-09: for an INTERACTIVE command, the contract also
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

Per §3.2, every LLM task is an agent session. The common rules are §3's
entirely — one model (§3.4), the malformed-turn policy, the hard turn
limit that fails on exhaustion and resumes (§3.3). This section sets
only the NUMBERS (defaults below, provisional until the reference
benchmark run calibrates them) and each session's prompt, inputs,
tools, and done-condition. Per the deterministic-first principle
(§7.1), a step whose deterministic path settles everything runs NO
session at all — §3.2 mandates the call shape of LLM tasks, not that
every step involve one.

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

- **The scenario id still carries a surface and a counter.** DONE
  (2026-08-13, ahead of the rewrite): the id is the flow id alone. The
  suffixes were dead — `<n>` could never legitimately reach `2` (§2
  binds ONE scenario per flow, and partial coverage stays
  milestone-scoped inside it), and `<surface>` predated the step-level
  driver decision (a flow spanning web and api is ONE mixed test, so the
  segment recorded only the surface it happened to be authored as — the
  same lie the deleted scenario-level `driver` field told one level up).
  The write path (`assignScenarioId`) and every committed corpus were
  renamed together; nothing reads the shape (it is a name, not a key).
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
dashboard gets everything. This is now the COMMON rule of §3.6 for every
agentic command; what follows is generate's own display specifics.

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
  artifact IS the live feed: workers APPEND each turn to their
  transcript in the sessions store
  (`sessions/guard-generate/<runId>/<sessionId>.jsonl`, §3.9;
  gitignored, like evidence) as it happens; the dashboard server's existing store watcher
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
- **Budgets**: the numbers only — per-flow turn cap (default ~8) and token
  ceiling; the hard-limit and resume mechanics are §3.3's. Exhaustion is a
  failed session per §3.3; the ledger caps attempts across runs, so a
  budget-exhausted worker is ledgered like any failed attempt, and past
  the cap the flow retires with its transcript — loud, in-run.
- **Generation history per §3.8** (decision 2026-08-13): every
  generate run appends a GENERATION record: the corpus version it
  consumed plus per-flow pointers to content-addressed
  scenario/outcome objects. An unchanged flow shares the previous
  generation's pointer, never a copy and never a re-author (the
  inputs hash above already decides skip). Back/forward navigation
  and per-version diffs (flows added/changed/removed, each changed
  flow against its predecessor) derive from adjacent records; the
  dashboard renders them. PR runs follow §3.8: a delta generation
  parented on main's committed baseline, impacted-only by default,
  `--all` for the full board.

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
  a high-confidence flag RESUMES the still-open session with the flag as
  the new observation (the loop's shared resume capability, §3.3) for one
  heal attempt; a second flag rejects + ledgers exactly as today.
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

**Transcript artifact.** Location superseded 2026-08-13 by the
unified sessions store (§3.9): worker transcripts live at
`sessions/guard-generate/<runId>/<sessionId>.jsonl` (runId minted per
generate run and recorded on the report), with `run.json` indexing
each session's flow; `guard/authoring/` is never created, and
`sessions/` joins GITIGNORE_CONTENTS. The event shape and the
store-helper mechanics are unchanged. The dashboard tail comes with
the display cutover; the files land with the workers.

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

- **A scoped run replaces the whole board** (field evidence 2026-08-08). STATUS: LANDED 2026-08-09 (mergeGuardBoard).
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
  2026-08-09: build it, both drivers). STATUS: LANDED 2026-08-09 (capture + comparisons). Real workflows chain — a CLI
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
  2026-08-09). STATUS: LANDED 2026-08-12 (the field is GONE, not derived).
  A real promise often spans surfaces — "create it through the API, the CLI
  lists it" — and a scenario that is wholly one driver cannot state it. A
  scenario is now driver-agnostic: each step declares how it acts (a CLI
  invocation, an API request), the sandbox is ONE world that can both start
  the service and run the CLI, and the step detail renders each step's driver
  as its own chip. What landed:
  - ONE `GuardScenarioSchema` (no per-driver variants, no discriminator). A
    legacy `driver:` key is accepted and DROPPED at parse, so corpora
    committed before the cut still load; nothing writes it again.
  - Which executor a scenario takes is DERIVED — `isApiServerScenario`: every
    executed step an api verb ⇒ the recipe's booted server; anything else ⇒
    the sandbox. The runner's pools, its preparation gate and its ordering all
    read that one predicate.
  - What a scenario EXERCISES is derived the same way —
    `guardScenarioDrivers`, registry order — and `scenarios/manifest.json`
    records it per scenario as `drivers: GuardDriverId[]` (replacing
    `surface`, which is folded to a one-driver list on read). Per-driver
    coverage counting is a UNION: a mixed scenario counts under EACH driver
    its steps use. That fixed a live defect — every mixed scenario in the
    reference corpus (17 of 51) was recorded as CLI-only, so the coverage
    classification lied about it.
  "One scenario per (flow, surface)" is unchanged as an AUTHORING unit: the
  surface a flow is authored for is still the generator's own, and it names
  the file's id.
- **A step can edit only whole files — grow a patch step** (decided
  2026-08-09: build). STATUS: LANDED 2026-08-09 (JSON patch step, runner-only vocabulary). A flow that must change ONE field of a supplied
  instance's structured file (break the build command in the registered
  subject's recipe to prove the error path) cannot: the write step
  replaces whole files, and the test may not invent the rest of a file it
  does not own. The format grows a PATCH step: set (or remove) a named
  key path in a structured file, leaving everything else as found. A
  patch against a missing file, an unparseable file, or an absent key
  path is that step failing — never a silent create or a partial apply.
- **Scripted terminal answers must be keyed to their prompts** (field
  evidence 2026-08-09: build). STATUS: LANDED 2026-08-09 (marker-gated delivery). Today an interactive step's answers are
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

STATUS: design drafted 2026-08-10 (§§10.3–10.9); owner TBD. Three
sequencing questions await the user's decision — flagged in §10.9.
Stage-1 reference authoring OPENED 2026-08-10 on the dashboard's analyze
page and RE-SCOPED 2026-08-11 to task journeys (§10.4): three web
journeys with starting/end states (`web/open-repo-report`,
`web/silence-rule-from-violation-card`,
`web/reenable-rule-from-rules-panel`), walked in order by the mixed flow
`review-analysis-and-silence-a-rule-in-the-dashboard` over four claims
promoted out of the analyze area's `untestable[]`; its manifest entry
settles as the `awaiting-driver` gap. The Journeys pane renders the
state contract. Store-schema gaps G74–G78 recorded in
`reference/transform-gaps.md` (route entry, page contract, dynamic
accessible names, web-surface recipe boot, mapper diagnostics) with the
re-scope note; first doc-drift candidate logged there (the docs'
"Shield icon" Rules-panel entry point vs the client's "Browse Rules"
control).

STATUS UPDATE 2026-08-11 — the Code Analysis-only reference wave now carries
55 web interfaces inside a 114-interface catalog and 51 settled flows/scenarios.
Seven new flows cover committed-state stashing, clean-tree handling, the
deterministic-only LLM path, path registration and first-analysis state,
non-git repositories, repository rule settings, and the Rules panel. Existing
dashboard flows now also cover flow search/playback, shared tabs, expanded
schemas, history/diff details, Top Offenders sorting, hotspot severity, folder
toggles, and graph connection state. All 301 dashboard claims are accounted for
exactly once: 222 in executable flows and 79 as evidence-based no-flow claims.
G90 is closed; remaining driver limitations are recorded under G83–G88/G91.

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

- **States are NAMED, per area; step prose is gone** (decided
  2026-08-11). A task interface's startingState/endState reference a
  small per-area STATE REGISTRY (id + one-line description, defined
  once) — chaining across interfaces matches ids, never sentences. The
  per-step input/output prose is removed: within a task, the chain is
  step order; restating it in free text made entries unreadable and
  unmatchable. States stay un-fingerprinted.
- **A future, explicitly-advisory LLM-oracle step** (recorded
  2026-08-11, PoC later): "ask a model whether the page shows X" for
  questions no structural assertion can state. It must not weaken the
  foundation — deterministic verification stays model-free; an oracle
  step would be a DISTINCT class with its own verdict channel, designed
  deliberately before any use.


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

### 10.3 Design decisions (2026-08-10)

- **Web verbs are STEP verbs, never a scenario class.** This workstream
  lands entirely after the step-level-driver foundation (§2, §9), so it
  never builds the scenario-level-driver assumption it would then have
  to unbuild. A step declares `navigate` / `click` / `fill` / `expect`
  the same way a step declares a CLI invocation or an API request; a
  scenario freely mixes them ("create it through the API, the browser
  shows it"). The sandbox is ONE world: it can boot the service, run the
  CLI, and drive the browser.
- **Dependency shape: `playwright-core` + on-demand browser.**
  `playwright-core` (small, no bundled binaries) is a normal dependency
  of the runner. The browser binary installs on demand, at `guard
  setup`, only when the subject has a web surface; the install outcome
  is recorded in the setup record like every step. A scenario with web
  steps and no installed browser settles **Blocked** naming the browser
  — the standard loud, actionable gap; the engine never auto-downloads
  mid-run.
- **Locator policy: roles and labels only.** The step schema's locator
  is a closed shape — role plus accessible name
  (`getByRole`/`getByLabel` semantics), never raw CSS or XPath.
  Extraction and authoring both work from accessible names; an element
  with no role and no label is not guessed at — the claim that needs it
  settles as a gap naming the unlocatable element. Deliberate side
  effect: coverage rewards accessible markup.
- **Boot model: identical to the API driver.** Each scenario's sandbox
  boots its own server(s) and launches its own browser with one clean
  context; nothing is shared between scenarios. Boot amortization
  remains ONE shared open item across the API and web paths, solved
  once for both or not at all.
- **Extraction scope v1: React Router and Next.js.** The runtime layer
  (Playwright over a real DOM) is framework-agnostic; the grounding
  layer (deriving web journeys from source) is framework-specific by
  nature. V1 extractors read React Router route configuration and
  Next.js file-system routes. A repo on another framework yields no web
  journeys and its flows settle **Blocked** ("awaiting a `<framework>`
  journey extractor") — honest and self-unlocking, the
  registered-surface pattern.
- **The frontend→API edge is in scope, wrapper resolution included.**
  Literal `fetch`/axios call extraction alone leaves real apps (wrapper
  clients, generated SDKs, react-query) as page shells with no API
  effects. The mapper follows the call ONE hop into the app's
  api-client module using the analyzer's existing cross-file call data.
  Where the hop still resolves nothing, the journey records the effect
  as `unknown` — never guessed — and the gap copy names the limitation.
- **No model in the verification loop** (restating §10.1 as binding):
  scenario execution is deterministic Playwright driving; sessions
  exist only at journey reconciliation and generation time, per §3.2.

### 10.4 Web journeys (one task from one state)

The §7 journey contract, translated — and RE-SCOPED 2026-08-11 after
the reference review: the first draft modeled a journey as a
page-rooted element inventory (64 steps for the repo page), and the
review rejected it — an inventory does not read as a journey and is
not one. A web journey is ONE TASK a user can perform from a specific
state ("navigate into a project", "silence a rule from a violation
card", "delete a project"), derived from code only (§7.3's 2026-08-09
decision applies unchanged — the mapper never reads docs):

- **Identity**: the entry route plus the task's interaction steps
  (activate / input, role + accessible-name targets). Several journeys
  share a route; the steps distinguish them.
- **State contract**: `startingState` / `endState` are NAMED STATE IDS
  referencing the per-area state registry (§10.2's 2026-08-11 decision,
  superseding the same-day prose form: sentences and per-step
  input/output fields are gone — within a task, the chain is step
  order). The starting state is what a scenario must arrange (or an
  earlier task must have produced); the end state is what it asserts;
  chaining across tasks is id equality, validated against the registry
  at parse. States stay optional and never fingerprinted.
- **Consumes/produces analog**: route parameters and form inputs
  consumed; navigations produced (which route a click leads to) and API
  effects produced (which operations an interaction triggers, via the
  one-hop wrapper resolution, joined to the API journeys behind them
  through the route-handler lookup). Facts extraction cannot establish
  are `unknown`.
- **Fingerprint**: over the entry route and the task's steps — same
  incrementality contract as CLI journeys. The page's FULL element
  inventory is extraction material (the union below) and a mapper
  artifact, never journey steps; how tasks are segmented out of the
  inventory is part of the generation design reserved for the owner.

Setup owns derivation (the journeys step of §7.6), through three
deterministic extractors: the frontend route table (`uiRoutes`), typed
interaction edges with accessible names (`uiInteractions` — the raw JSX
event data already exists in `extractJsxReferences`; this work types
it), and the frontend→API join.

**Completeness cross-check (the §7.3 union, web form).** The static
extraction is one source; the runtime probe analog is the browser
itself: load each extracted route in the sandboxed subject and take the
accessibility snapshot. Journey = the union; every discrepancy (an
element the snapshot sees that extraction missed, a route that renders
nothing) is a recorded mapper diagnostic. The probe requires the
subject to boot, which setup already verifies. Discrepancies feed the
same journey reconciliation session (§7.4) — no new session type.

### 10.5 Schema and runner

- **Step vocabulary** (closed): `navigate` (route, with readiness = URL
  reached and the page settled), `click` / `fill` (locator; fill
  carries the value, `${...}` interpolation and captured values
  included), `expect` (visible text under a locator, and/or the
  address). Waits are readiness-based and bounded by the step's
  declared time limit (§8.2's step-limit decision applies); no sleeps,
  no retries — a flaky pass is worse than a red (§10.2).
- **Capture on web steps**: a web step may capture visible text under a
  locator or a URL segment, joining §9's capture/comparison machinery
  unchanged — a mixed scenario can capture an id from an API response
  and expect it visible on the page.
- **Recipe**: the recipe describes how the web surface starts and how
  readiness is observed (URL probe), reusing the server-boot machinery
  the API path already has; the web surface is a served process like
  any other, plus the browser the sandbox provides.
- **Evidence** (per §10.2): on failure — screenshot, the
  accessible-tree excerpt around the failing locator, the browser
  console, and the network log; stored like CLI evidence, rendered by
  the same drift surfaces. Normalizer additions for dynamic content
  (timestamps, generated ids) extend the existing normalize vocabulary.

### 10.6 The reference-first ladder, concretized

Strictly after the API surface meets its finish line (§4). Same three
stages as §10.1, with the subject fixed:

1. **Reference authoring.** The subject is TrueCourse's own dashboard.
   Hand-author its web journeys, extend the flows of the areas its
   documentation already covers (many flows will be MIXED: API/CLI
   steps arranging state, web steps proving what the user sees), and
   author the scenarios; review in the dashboard. Store-schema
   transform gaps are recorded as work items, per §4's discovery rule.
2. **Represent and run.** Grow the step schema, recipe, runner, and
   evidence store (§10.5) until every reference scenario executes in a
   sandbox, produces a verdict, and leaves evidence. Every red on the
   board is a product bug or an accepted limitation — the §4 standard.
3. **Extraction, then generation.** The deterministic extractors and
   the journey union land in setup (§10.4). Only then is web generation
   designed, from this document: the expectation is the §8.4 flow
   worker unchanged — same loop, same outcomes, `run_scenario` already
   executing web steps by then — plus an authoring-prompt extension
   teaching the locator policy. That design is reserved for the owner.

### 10.7 Estimation

Per §3.5, defined by the owner with the generation design. Already
known: journey extraction and the accessibility-snapshot probe are
deterministic and estimate as free; web flow authoring reuses the
flow-worker session economics of §8.8.

### 10.8 Testing strategy

- **Fixture**: `guard-fixture-web` — a minimal React Router app served
  over the existing `guard-fixture-api` todos server, so web
  extraction, the frontend→API join, and mixed API+web scenarios are
  all exercised by one fixture pair.
- **Runner units**: scripted scenarios against the fixture, headless;
  locator misses, readiness timeouts, capture, and evidence shape all
  asserted deterministically.
- **Extractor units**: route-table and interaction extraction over
  fixture sources, including the wrapper-resolution hop and an
  `unknown`-effect case.
- **Self-verify gate** (the §7.5 analog): extract the dashboard
  client's own route table and diff it against the React Router
  registry — breaks when an extractor regresses or a new registration
  idiom appears.
- **CI**: the browser binary is cached by the setup action; everything
  runs headless in the sharded suite.

### 10.9 Risks and open questions

- **The dashboard as first subject is itself a boot problem**: a
  sandboxed dashboard needs a server, a client, and a populated
  `.truecourse/` store to render anything. The store is a
  supplied/seedable dependency from §7's catalog — the reference
  authoring stage must settle its shape first.
- **Authenticated web state**: the dashboard is auth-less, so v1 dodges
  it; the general mechanism (a supplied catalog entry materialized as
  browser storage state, the §7.6 copy-in pattern) is designed when the
  first auth-gated subject appears, not speculatively.
- **Animation and streaming views** (the dashboard has live-updating
  surfaces): readiness-based expects may still race a view that never
  settles; the reference wave will show whether an explicit "stable"
  readiness notion is needed.
- **Wrapper-resolution depth**: one hop is a bet; tRPC/generated-SDK
  repos may need more. The `unknown` recording keeps the failure honest
  until field data says whether to deepen it.
- **Sequencing vs §§6–8 (decision needed, flagged 2026-08-10)**: the
  ladder says "after the API finish line", but the generation
  workstreams are also in flight — does web reference authoring start
  as soon as the API surface is stable, or only after generate is
  rebuilt?
- **Mixed-scenario coverage accounting (decision needed, flagged
  2026-08-10)**: §9 leaves "per surface" counting under mixed scenarios
  to the owning workstreams — is the web wave the moment it gets
  redefined, or does the API wave settle it first?
- **Fixture vs dashboard ordering (decision needed, flagged
  2026-08-10)**: author the reference against the dashboard first
  (real, messy) or prove the runner on `guard-fixture-web` first
  (small, controlled)? The CLI wave went reference-first; the
  dashboard's boot problem may argue for the fixture.
