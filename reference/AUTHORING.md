# Authoring the reference corpus

How to author a reference-corpus area, layer by layer, so it lands in the
engine's real store schemas, renders in the dashboard, and runs through the
real runner. The definition, boundary, and binding rules live in
`docs/AGENTIC_PIPELINE_PLAN.md` §4; this file is the working procedure.
The code-analysis area under this directory was built exactly this way and
is the example to imitate.

## Ground rules (read before starting)

- **One representation.** The reference exists only in the engine's store
  schemas, under `reference/store/`. Never keep a parallel "readable"
  version of a layer; if you draft in a scratch format, the draft is
  deleted after a verified zero-loss transform.
- **The reference replaces generation only.** It stands in for what
  `spec scan`, `guard setup`, and `guard generate` would produce,
  including the result records those commands write. Everything
  downstream (running, evidence, rendering) uses the real machinery.
- **The ideal, not the current engine's output.** Author what the engine
  SHOULD produce. Where the current engine is wrong (for example
  detection that scans the whole repo), write the ideal value and record
  the engine defect as a plan item.
- **Never fabricate.** Real-world inputs (a project to analyze,
  credentials) are supplied dependencies, bound at run time, never
  generated. Facts you cannot establish are recorded as unknown, never
  guessed. Values a real command run would have produced (usage totals
  for hand-authored work) are their honest zeros.
- **Findings are the product.** When a scenario fails against reality,
  do not patch the scenario to pass. Classify it: product bug (report
  it), doc drift (report it; some are deliberately kept red as living
  examples), or authoring defect (fix the reference). The
  reference-versus-reality ledger is the point of the corpus.

## Layout

```
reference/
  spec-docs/<group>/<page>.mdx     verbatim snapshots of the docs site pages
  store/.truecourse/               the reference, in engine store schemas
    specs/corpus.json              curated docs + areas
    specs/sources.json             registered llms.txt sites (+ specs/sources/)
    scenarios/claims.json          the claim corpus (+ untestable list)
    scenarios/flows.json           flows with kind/variant/starting-state
    scenarios/manifest.json        flow -> scenario map (+ interface plans, gaps)
    scenarios/recipe.json          the real build/invoke recipe
    scenarios/decisions.json       user-authored dismissals
    scenarios/dependencies.json    the supplied-dependency catalog
    scenarios/<area>/*.yaml        one scenario per flow (format v3)
    guard/interfaces.json          the interface catalog (cli/api/web) with
                                   contracts and per-surface state registries
    guard/setup.json               the setup record (ideal-scoped detection)
    guard/result.json              the generate result record
  transform-gaps.md                ledger of schema gaps found while authoring
  AUTHORING.md                     this file
```

To review in the dashboard, copy the store over the live one — DELETING the
live store first:

```bash
rm -rf .truecourse && cp -R reference/store/.truecourse/. .truecourse/
```

The delete is not optional. `cp -R` merges, so files an earlier engine
`guard generate` wrote — scenarios for flows the reference does not have,
an older `manifest.json`, stale run records — survive the copy and are
read back as part of the corpus, surfacing as unloadable scenarios in
every run (observed 2026-08-07). The live copy is derived and never
committed, so there is nothing in it to lose.

## The process, per area

Work one area at a time. Delegate each layer to one agent (Opus) with the
relevant plan sections and this file as its contract; verify between
layers. Layers 1 and 2 can run in parallel; 3 needs both; 4 to 6 follow.

A batch MAY stop after flows and interfaces (a user-review checkpoint
before scenarios are spent on them). That intermediate state is recorded
honestly, never silently: each such flow gets a manifest row carrying its
interface plan, `scenarios: []`, and a per-surface `blocked-on` gap naming
the deferred scenario batch. Until the scenarios land, every run and the
coverage view will — correctly — report these flows as BLOCKED: a flow
with no scenario has nothing to execute, and the gap is the stated reason.
The next batch replaces each gap with the flow's scenario.

### 0. Snapshot the spec source

The spec source is the published docs site (Mintlify), not repo files.
Pick the area's pages, fetch them, and save the MDX verbatim under
`reference/spec-docs/`, mirroring the site paths. Claims anchor to these
snapshots, so they must be byte-faithful and committed.

### 1. Claims

Extract every testable claim from the area's snapshots. A claim is ONE
testable sentence; identity is doc + anchor + title.

The doc set is EVERY doc the area's corpus keeps — including reference
pages — never a subset. A page used as a cross-check for another layer
(the CLI reference feeding interfaces) is still a claims source; skipping
it leaves its sections permanently uncovered. Claims about commands
outside the area are still extracted and land as gaps with reasons, not
silently omitted.

- Exhaustive: every behavioral statement becomes a claim or an entry in
  `untestable[]` with a reason. Notes, warnings, tips, and tables count.
- Faithful: supported by the doc text, not by knowledge of the code. Do
  not read the implementation for this layer.
- Split compound statements; collapse same-doc restatements into one
  claim with a note; cross-doc repeats stay separate claims.
- Per claim record how a scenario observes it (stdout, exit code, files,
  prompt) and what it needs (llm-transport, supplied project, committed
  baseline, and so on; open vocabulary).
- Anchors must resolve against the real derived section index (lead
  regions are anchorable sections; verify each anchor).

Target: `scenarios/claims.json` (`GuardClaimsFileSchema`,
`packages/shared/src/guard/claims.ts`).

### 2. Interfaces

Derive the area's interface catalog — the code-side unit: WITH WHAT a
flow is realized — from the SOURCE CODE (the source of truth),
cross-checked against the docs' CLI reference page. One entry per
INVOCABLE THING (one command, one HTTP operation, one web task from one
named starting state); never a command tree folded into an entry, never
independent invocations rendered as sequential steps.

- COMPLETE grammar (cli): every flag (long, short, takes-value,
  requiredness, value hint, choices, default, scope, hidden), every
  positional, every subcommand. Nothing invented, nothing skipped.
- The io contract is STRUCTURED FACTS, never prose. Entries like
  stream+marker (a stable output substring, observed), exit+when,
  prompt kind+marker+when (what a TTY step must answer), file writes,
  env reads — each with an optional short `when` condition. If a fact
  cannot be stated as such an entry, it is not io contract material.
  `unknown` is a legitimate value; guessing is not.
- Web entries name their `startingState`/`endState` as ids from the
  file's per-surface state registry (each state one sentence, defined
  once), and record `apiEffects` — the api interface ids the task's
  steps invoke, resolved ONE HOP through the client's api-client call
  sites. Omitted means extraction established nothing; `[]` means it
  established the task reaches no server. Never guessed.
- Every code-vs-docs discrepancy is a diagnostic; code wins for
  grammar; never resolve one silently. The interface schema stores no
  diagnostics by design (they are run reporting, not interface data),
  so until they get a store home (plan §7.5; ledger G78/G82) they are
  preserved VERBATIM in `transform-gaps.md` — the doc-bug feed.
- Model the POST-Phase-0 target (for example no agent transport) and
  record each such divergence as an authored decision (same ledger).

Target: `guard/interfaces.json` (`packages/shared/src/interfaces.ts`).
The fingerprint folds ONLY type + entry + steps, so contracts, groups,
states and apiEffects are additive: adding them must not move any
existing entry's fingerprint — verify they recompute unchanged.

### 3. Flows and scenarios

Compose claims into flows, then author one scenario per flow (never a
second file per flow).

Flow coverage rules:
- Happy paths AND the edge/corner cases that matter (error paths,
  invalid input, boundary values, empty or conflicting state).
- Every configuration path: an enumerated mode choice (like the claude
  vs api transport) gets a variant flow per supported path, each binding
  its own supplied dependencies.
- Every claim appears exactly once across `flows[].claims` or `gaps[]`
  (with a reason: untestable, blocked-on capability, unrealizable).
  Verify the arithmetic; do not eyeball it.
- Tag each flow: kind (happy | edge | variant), variant-of, and the
  starting-state block (step-creatable / seedable / supplied).

Scenario rules (format v3):
- Steps only through public interfaces, plus `git`/`write`/`delete` steps
  for state the docs themselves describe in those terms. Prompt-path
  claims use `tty: true` with scripted stdin answers.
- State decision rule: durable state that must pre-exist (a codebase
  with findable content, a populated database) is NEVER written by the
  scenario — bind a supplied dependency and contribute this flow's need
  to its requirement; the flow blocks until the user provides an
  instance. Only transient, flow-specific state is arranged in-scenario
  (an ignore file, a config edit, a write that dirties the tree —
  mechanics the claim itself is about). When in doubt, it is a
  dependency. Assertions against a bound instance are structural and
  observation-based, never content-exact.
- Assert MEANING (the violation key, the counter, the file path, the
  exit code), never exact prose.
- Web `text` is what CSS RENDERS, not what the DOM contains: the driver
  reads `innerText`, so a `text-transform` changes the case you must
  assert (an uppercased heading reads back as `API`, not `api`) and
  hidden text is invisible to it. Matchers are case-sensitive — author
  the case the page shows. A miss that would pass ignoring case names
  itself in the failure ("differs only in letter case").
- State a page keeps OUTSIDE its text has its own expect members (added
  2026-08-11, plan item 91) — use them instead of asserting a label that
  never changes: `state` (an ARIA state — `checked` | `pressed` |
  `selected` | `expanded` | `disabled` — on a role+name target, for tab
  strips, switches and disabled controls), `attribute` and `class` (on
  the document element by default, which is where a theme lives; `class`
  matches whole TOKENS, so `has: dark` never passes for `darkroom`).
  A control that exposes NO state fails saying so — that failure is the
  finding, and it is not to be papered over with a text assertion.
- `visible` takes a LIST as well as a single locator: several icon
  buttons that survive one action are ONE claim, and their accessible
  names (`aria-label`s) never appear in the page text.
- Browser Back and Forward are a verb: `- driver: web` + `history: back`
  (or `forward`). Re-navigating to the old address proves a link, not
  the history — do not author the one for the other.
- A command that never returns (a console-mode server, a log follower)
  is a `run` step with `until: { marker: … }`: the runner stops it the
  moment that line appears and evaluates the expect against the output so
  far. Such a step asserts output, never `exit` (the schema refuses it),
  and it no longer has to be the flow's last step.
- Milestone-tag each proving step with the claim ids it proves (a step
  may prove several).
- Every step either proves a claim or prepares for a later claim step.
  Nothing else exists: no just-in-case sanity checks, no defensive
  trailing steps. Insurance duplicating a claim another flow owns is
  redundant coverage, and a step proving nothing is not authored.
- HOST state a scenario legitimately mutates OUTSIDE the sandbox (a
  user-level service it installs, a supervisor registration) is restored
  by `teardown:` steps, never by trailing main steps: the runner stops at
  the first failing step, and only teardown runs on every exit —
  best-effort after a failure, verdict-affecting (and milestone-bearing:
  a `stop`/`uninstall` teardown step IS that claim's proving step) on a
  green run. Numbering is continuous after `steps`. Sandbox-only state
  never earns a teardown — the sandbox is deleted either way (plan
  item 94).
- Non-interactive `analyze` steps pass `--llm`/`--no-llm` explicitly
  (the LLM gate is per-run consent, by decision).
- Never point `TRUECOURSE_HOME` (or any tool home) inside the working
  tree; the runner already provides an isolated home outside it.

Targets: `scenarios/flows.json`, `scenarios/manifest.json`,
`scenarios/<area>/*.yaml` (load them through the real loader; the claim
cross-checks must come back clean).

### 4. The recipe and the records

- `scenarios/recipe.json`: the real build and invocation for the repo,
  proven by executing it. No api block, no invented fields.
- `guard/setup.json`: what an ideal setup would record. Detection is
  scoped to what the program under test actually reaches (SDK imports
  count); evidence paths repo-relative; no database unless the program
  uses one.
- `guard/result.json`: what a generate producing this corpus would
  write: written counts, the gaps with reasons, zero LLM usage. This is
  the file the coverage view colors from.

### 5. Validate, copy, review

- Every store file parses against the repo's real Zod schemas through
  the real readers; fingerprints recompute; manifest, flows, scenarios,
  interfaces, and claims agree with each other.
- Copy to the live store, open the dashboard, and walk every tab the
  area touches. The user reviews here; iterate on feedback until the
  area is confirmed (draft, review, update, repeat, freeze).

### 6. Run it

`truecourse guard run` over the area, for real. Read every failure and
classify it (product bug / doc drift / authoring defect) before touching
anything. Update `transform-gaps.md` when a schema could not carry
something you authored; each such gap becomes a plan work item for its
owning workstream.

## Zero-loss transforms

Whenever authored content moves between formats (a draft into store
schemas, a schema migration), prove completeness before deleting the
source: enumerate every leaf of the source, show each one either carried
into the target or preserved verbatim in `transform-gaps.md`, and only
then delete. Never trust "it looks complete".
