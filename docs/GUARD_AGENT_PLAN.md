# Guard Agent Plan — flow workers over an owned agent loop

The plan of record for rebuilding `guard generate`'s authoring core from staged
one-shot prompting into per-flow agentic workers. Companion to
`docs/SPEC_GUARD_PLAN.md` (which stays the record for the planning and
verification layers this plan keeps).

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
| **journey** | the code-derived public contract: command tree with full grammar (flags, requiredness, values, choices), API operations with schemas | code (deterministic extraction) | WITH WHAT to verify |
| **scenario** | setup + ordered steps in a sandbox; milestone-tagged steps prove claims | authored from flow × journeys | HOW to verify |
| **sandbox** | fresh, hermetic execution | runner | the judge of record |

Binding decisions:

- **One flow ↔ one scenario per surface.** No `.2` files. Partial coverage
  stays per-milestone inside the one scenario (a blocked claim is a
  milestone-scoped gap, and the scenario grows when blockers clear).
  Supersedes the N-files requirement briefly recorded on #868.
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

## 3. Architecture

Three layers; only the middle one changes shape.

### 3.1 Planning (deterministic, unchanged)

Sections → claims → flows (synthesis, subsumption, epics) → journey mapping →
surface gating (no HTTP signal ⇒ no api candidate) → per-flow inputs hash.
Near-duplicate flows are dropped at synthesis, so no two workers can ever be
assigned overlapping paths — sharing questions are settled before workers
exist.

### 3.1b Journey completeness (the load-bearing guarantee)

Everything below assumes journeys carry the COMPLETE public grammar. That is
enforced, not hoped for:

1. **Two derivation sources, cross-checked.** The mapper already has both a
   static extraction (the analyzer's command tree) and a runtime one (`--help`
   probes, parsed). At derivation the journey carries their UNION, and every
   discrepancy (a flag the probe sees that the tree missed, or vice versa) is
   recorded as a mapper diagnostic — the union keeps workers whole today, the
   diagnostic queues the extractor fix. (Field precedent: the chained
   `new Option().choices()` shape silently dropped `--transport` for weeks;
   the probe knew it all along. Cross-checking makes that class visible the
   day it appears.)
2. **Known structural gaps are Phase-1 work, not caveats**: the root-command
   journey (today `--version`/`--help` have no journey at all — one flow
   settled `unrealizable` for it), and program-level/inherited flags on
   subcommand journeys.
3. **Self-verification test**: derive journeys from TrueCourse's own CLI and
   diff the option schemas against the commander registry introspected at
   runtime — a completeness gate over a real, rich CLI that runs in CI and
   breaks when an extractor regresses or a new registration idiom appears.
4. **Field feedback loop**: worker `journey-defect` reports (the sandbox
   rejected a promised flag, or demanded one the grammar lacks) are first-
   class run outputs, rendered like coverage gaps — each one is a mapper bug
   with a reproduction attached.

### 3.2 Flow workers (the pivot)

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

### 3.3 Verification (deterministic, outside the agent)

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
  not by sequencing; discard-as-afterwork ceases to exist. Judge models may
  be cheap: a wrong label is re-checkable; a broken artifact is not.
- **Model policy**: the capable model authors; cheap models only judge.
- **Ledger**: per-flow attempt caps and retirement (with its three resets)
  unchanged from #861.
- **Claim accounting, settle line, gap vocabulary**: unchanged from #861/#868.

### 3.4 One agent loop, owned by us

The loop — turn budget, tool dispatch, transcript, malformed-turn re-ask,
streaming — is written **once**. The provider seam stays where it is today: a
single turn.

- `LlmTransport` grows a turn-level call: messages + tool results in, next
  reply (text or tool call) out.
- **claude-code mode**: `claude -p` per turn with `--resume <session>` — the
  session keeps server-side context; our loop keeps client-side control. Same
  binary, same login, same stream-json parsing.
- **api / EE mode**: the AI SDK's native tool-calling per turn. EE inherits via
  `ee-llm` re-exporting `llm-api`, as today.
- The Claude Agent SDK is **not** used: it is a second loop, and Claude-only.

## 4. Observability

- **CLI** (supersedes the display spec drafted on #857): per-flow rows with a
  partition counter that always sums —
  `settled 41 · active 6 · queued 52 · blocked 7 — of 106` — plus one line per
  active worker: `<flow> · attempt 2 · running scenario…`. Flows settle
  continuously, so progress is real, not settles-last. Generate prints the
  dashboard deep link to the flows view at start ("watch live: <url>"); the
  dashboard is an independent process and can be opened before, during, or
  after the run.
- **Dashboard**: the transcript artifact IS the live feed. Workers APPEND
  each turn to `guard/authoring/<runId>/<flowId>.<surface>.jsonl` (gitignored,
  like evidence) as it happens; the dashboard server's existing store watcher
  tails the file and forwards appended lines over the existing sockets into
  the flow detail. The CLI knows nothing about the dashboard — if it's up you
  watch live, if not the same file replays later, and the cloud version tails
  the same artifacts from its store. One append-only file, two readers; no
  CLI↔server coupling. "Why does this scenario look like this" becomes a
  readable transcript, not forensics.

## 5. Incrementality, caching, cost

- The **settled scenario + outcome is the cache**; the per-flow inputs hash
  (flow fingerprint + journey fingerprints + recipe fingerprint + loop/prompt
  version) decides skip vs re-work, exactly as today.
- Worker transcripts are not KV-cached; per-turn prompt caching rides the
  provider session (claude `--resume`; api cache_control).
- **Estimate**: per-flow turn budgets make the pre-flight honest — flows ×
  [min, max] turns at the author model's prices, judges priced separately. No
  more per-stage call counts that assume the worst everywhere.
- **Budgets**: per-flow turn cap (default ~8) and token ceiling; the ledger
  caps attempts across runs. A budget-exhausted worker retires the flow with
  its transcript — loud, in-run.

## 6. Implementation plan (on the PR #870 branch, per decision)

Phased so every phase lands green:

- **Phase 1 — the loop, and journey completeness.** `agent-loop` module: turn
  seam on `LlmTransport` (both modes), tool dispatch, budgets, transcript
  artifact, malformed-turn re-ask; no engine wiring yet. In parallel, the
  §3.1b completeness work: tree∪probe union with discrepancy diagnostics, the
  root-command journey, inherited/program-level flags, and the self-
  verification gate over TrueCourse's own CLI.
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

## 7. Testing strategy

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
  baseline metrics (checked into the plan as a table, updated per run — real
  models, run manually/nightly, never in CI).
- **CI**: everything above except the benchmark is fake-provider and runs in
  the sharded suite.

## 8. Risks and open questions

- `claude -p --resume` session semantics (persistence window, caching
  behavior) need a spike in Phase 1; fallback is full-context resend per turn
  (correct, costlier). **Spike done 2026-08-05: resolved, see §9.**
- Cost variance per flow is real; budgets bound it, and the estimate's ranges
  must be honest about it.
- Parallel workers vs provider rate limits: start with the executor's
  concurrency cap; make it configurable.
- EE observability (trace store) wants the transcript stream — Phase 5, same
  event shape.

## 9. Phase 1 implementation decisions (2026-08-05)

Decisions made at implementation start; they bind the Phase 1 work.

**Spike result.** `claude -p --resume <session-id>` retains full server-side
context across print-mode invocations (verified live). Mechanics: the prompt
goes over **stdin** (the variadic `--tools` flag would swallow a trailing
positional); turn 1 passes `--session-id <uuid>`, later turns `--resume <id>`;
`--system-prompt` is re-passed on **every** turn (cheap, and removes any
dependency on resume re-applying it); `--no-session-persistence` is never
passed. The §8 full-context-resend fallback is not needed.

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
turn budget); two consecutive malformed turns end the worker with a
structured `malformed` failure — never an exception, never a stranded flow.

**Module placement.** The loop (`runAgentLoop`: turn budget, token ceiling,
tool dispatch, transcript events, re-ask) lives in
`packages/shared/src/llm/agent-loop.ts` — transport-agnostic, next to the
seam, exported through `transport.ts` like `guardrail.ts`. The claude-code
turn adapter lives beside `cliTransport` in `transport.ts`; the api turn
adapter in `packages/llm-api` (the only OSS package allowed to import `ai`).
The loop emits transcript events (system, turn, reply, tool result, re-ask,
outcome, budget-exhaustion) through a sink callback; Phase 2/3 wire the sink
to `guard/authoring/<runId>/<flowId>.<surface>.jsonl`.

**Journey completeness decisions (§3.1b).**
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

## 10. Phase 2 implementation decisions (2026-08-05)

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
(journeys carry the grammar after §3.1b); `ground.ts` stays for the api path
until Phase 3.

**The one tool.** `run_scenario` takes `{ scenario }` — the raw behavioral
scenario as a JSON object (same `RawGeneratedCliScenarioSchema` the one-shot
path parses; the "yaml" in §3.2 is the artifact, not the wire shape). The
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
tail is Phase 3; the files land in Phase 2.

**Stage accounting.** Worker turns account under `guard.generate` (calls =
turns). `guard.retry`/`guard.triage` leave the usage stages with their
stages; fidelity accounting unchanged.
