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
    scenarios/claims.json          the claim corpus (+ untestable list)
    scenarios/flows.json           flows with kind/variant/starting-state
    scenarios/manifest.json        flow -> scenario map
    scenarios/recipe.json          the real build/invoke recipe
    scenarios/<area>/*.yaml        one scenario per flow (format v3)
    guard/journeys.json            journeys with full contracts
    guard/setup.json               the setup record (ideal-scoped detection)
    guard/result.json              the generate result record
  transform-gaps.md                ledger of schema gaps found while authoring
  AUTHORING.md                     this file
```

To review in the dashboard, copy the store over the live one:
`cp -R reference/store/.truecourse/. .truecourse/` then open the dashboard
as usual. The live copy is derived and never committed.

## The process, per area

Work one area at a time. Delegate each layer to one agent (Opus) with the
relevant plan sections and this file as its contract; verify between
layers. Layers 1 and 2 can run in parallel; 3 needs both; 4 to 6 follow.

### 0. Snapshot the spec source

The spec source is the published docs site (Mintlify), not repo files.
Pick the area's pages, fetch them, and save the MDX verbatim under
`reference/spec-docs/`, mirroring the site paths. Claims anchor to these
snapshots, so they must be byte-faithful and committed.

### 1. Claims

Extract every testable claim from the area's snapshots. A claim is ONE
testable sentence; identity is doc + anchor + title.

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

### 2. Journeys

Derive the area's command journeys from the CLI SOURCE CODE (the source
of truth), cross-checked against the docs' CLI reference page.

- COMPLETE grammar: every flag (long, short, takes-value, requiredness,
  value hint, choices, default, scope, hidden), every positional, every
  subcommand. Nothing invented, nothing skipped.
- The io contract: consumes (args, stdin prompts by name and trigger,
  files and state read) and produces (stdout shape, files written, exit
  codes and meanings, side effects). `unknown` is a legitimate value;
  guessing is not.
- Every code-vs-docs discrepancy goes to `diagnostics[]`; code wins for
  grammar. These diagnostics are the doc-bug feed; do not resolve them
  silently.
- Model the POST-Phase-0 target (for example no agent transport) and
  record each such divergence in `authored-decisions`.

Target: the contract fields on `guard/journeys.json`
(`packages/shared/src/journeys.ts`). Journey fingerprints must not move
when contracts are added.

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
- Steps only through public journeys, plus `git`/`write`/`delete` steps
  for state the docs themselves describe in those terms. Prompt-path
  claims use `tty: true` with scripted stdin answers.
- Seeds are small, inline, deterministic files you design (a file with a
  known deterministic violation beats a realistic blob). A realistic
  codebase is a supplied dependency, bound not built, asserted
  structurally.
- Assert MEANING (the violation key, the counter, the file path, the
  exit code), never exact prose.
- Milestone-tag each proving step with the claim ids it proves (a step
  may prove several).
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
  journeys, and claims agree with each other.
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
