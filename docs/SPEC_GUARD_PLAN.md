# Spec Guard — Section-Bound Scenario Tests Replace Contract Verify

STATUS: OSS v1 BUILT (Phases 0–5, 2026-07-07) — design agreed 2026-07-03; open work: the
follow-ups and decided-not-built items in the body (fidelity review v1.5, stub/http
capabilities, OSS AI-SDK transport, scan-staleness signal) and Phases 6–8 (api/tui/web
drivers, EE). This plan adds **generated, spec-section-bound
scenario tests** ("guards") as the new verification artifact, built alongside the existing
contract system. The spec side (scan → curated corpus → areas → decisions) is untouched.

RETIREMENT DECIDED (2026-07-07): the contract surface (`contracts *`, `verify`, `infer`,
dashboard contract/BL-Drift views) is **discontinued** in favor of guard. Step 1 (done): the
BL Drift dashboard section is hidden from the section switcher in both OSS and EE (still
URL-reachable — the EE Pulls feed deep-links into it) and the README documents the
discontinuation. Step 2 (future): delete the contract-related code once guard covers the
remaining gaps (the EE gate signal still runs on verify drifts until guard's EE phase lands).

**Scope: OSS first.** Everything in this plan lands in the OSS surface — core packages, CLI,
local dashboard, file-based store. EE adaptation (hosted store adapters, PR-scoped guard runs,
a gate check, hosted execution) is the explicit last phase, started only after the OSS loop is
proven end-to-end. No guard code goes under `ee/` until then.

## Why

Contracts verify what code **says** (static tree-sitter/IL matching against `.tc` artifacts);
they cannot verify what code **does**. Coverage is capped by the kind taxonomy — every new kind
needs matcher work in every language — and real spec content largely doesn't fit the taxonomy.
The replacement inverts the model:

- A spec **section** is bound to one or more **scenarios** — declarative, executable tests.
- An LLM **authors** each scenario once, from the section's claim plus the code.
- Verification is **running** the committed scenarios deterministically — no model, no matcher
  engine, no kind taxonomy in the verification loop. A failing scenario means "this section and
  the code disagree" (drift or bug — the developer's call, never auto-resolved).
- The binding is **bidirectional**: code changed → scenario fails (code-side drift); spec section
  edited → its scenarios are stale (spec-side drift). The spec document itself becomes the
  coverage UI: every section visibly carries its proof and its status.

## Naming

The new subsystem is **guard** (from "guard-test"): scenarios *guard* spec sections.

- Artifact: **scenario** (a YAML file; one or more per spec section).
- CLI namespace: `truecourse guard …` — `guard generate`, `guard run`, `guard status`,
  `guard drifts`, `guard recipe` (inspect / `--refresh` the preparation layer).
- `truecourse verify` keeps its current meaning (contract-based check) and is not touched;
  guard never reuses the name — "verify" means contracts everywhere it appears today.

Considered and rejected: `probe` (sounds exploratory, these are assertions), `prove` (overclaims),
reusing `verify` (would collide with the live contract command).

## What stays, what goes

| Layer | Fate |
| --- | --- |
| `spec scan`, corpus, areas, decisions, PR-scoped overlays (EE) | **Unchanged.** The corpus is the anchor for everything below. |
| Contract system — `packages/contract-extractor`, `packages/contract-verifier`, CLI (`contracts *`, `verify`, `infer`, `drifts`), dashboard contract/BL-Drift views, EE gate signal | **Untouched.** Runs exactly as today, side by side with guard. No new investment in kinds/matchers; retirement is a future decision, not part of this plan. |
| Dashboard: Spec pages | **Extended** — per-section coverage/status highlights (see Dashboard section). |
| Guard (new) | **Added alongside**: `guard` CLI namespace, `.truecourse/scenarios/` + `.truecourse/guard/` stores, spec-section coverage UI, guard drifts page. |

## Architecture overview

```
specs (unchanged)                guard generate                     guard run
─────────────────                ────────────────────────────       ─────────────────────────
docs → spec scan → corpus.json → section index → testability →      build via recipe →
       decisions.json            recipe discovery → scenario        run scenarios in sandboxes →
                                 generation → birth validation →    failures → drift (by section) →
                                 .truecourse/scenarios/ (committed) guard store → dashboard/gate
```

Two new packages, mirroring the extractor/verifier split:

- **`packages/guard-generator/`** — the LLM-side pipeline: section indexing, testability
  classification, recipe discovery, scenario generation, birth validation.
- **`packages/guard-runner/`** — the deterministic side: scenario schema validation, sandbox
  lifecycle, drivers, normalizers, evidence capture, result mapping. Zero LLM dependencies;
  fully testable with hand-written scenarios.

Shared scenario/result types go in `packages/shared` (the dashboard renders them).

## The scenario format (v1)

One YAML file per scenario, committed under `.truecourse/scenarios/<area>/`. Declarative, with a
**closed verb set per driver** — no escape hatch to arbitrary shell. If a claim can't be expressed
in the verbs, that's a testability-classification outcome (different driver, or untestable-here),
never a reason to open the DSL up.

```yaml
guard: 1                                  # format version
id: auth-rate-limit.1
title: Login rate-limits after 5 failed attempts   # restates the section's claim
binds:
  doc: docs/specs/auth.md
  section: authentication/login/rate-limiting      # heading path (slugified)
  fingerprint: sha256:9f2c…                        # normalized section text hash
driver: cli
setup:
  files:                                  # declarative sandbox seeding — no shell
    config.json: |
      { "maxAttempts": 5 }
  env:
    APP_MODE: test
steps:
  - run: [login, --user, alice]           # argv for the recipe-defined entrypoint
    stdin: "wrong-password\n"
    repeat: 5
    expect:
      exit: 1
  - run: [login, --user, alice]
    stdin: "correct-password\n"
    expect:
      exit: 1
      stderr:
        contains: "rate limit"
      files:
        .app/lockout.json: { exists: true }
normalize: [timestamps, abs-paths, versions]
```

Driver verb sets (each closed; later drivers add vocabulary, never change the envelope):

- **cli (v1)**: `run` (argv + stdin + env), `expect` on exit code / stdout / stderr
  (`equals|contains|matches`, post-normalization) / files (`exists|absent|equals|contains`).
- **tui (later)**: PTY session — `send` keys, `expect screen` snapshots.
- **api (later)**: environment boot + `request` / `expect` status, body, resulting datastore state.
- **web (later)**: api environment + browser verbs (`navigate`, `click`, `fill`,
  `expect visible`) — Playwright underneath, scenario stays declarative.

**The driver contract (how api/web/tui land additively).** The scenario **envelope is frozen** —
`guard`, `id`, `title`, `binds`, `driver`, `setup`, `steps`, `normalize`, and the run-outcome set
never change per driver. A new driver contributes exactly three things: (1) a closed verb
sub-schema keyed by its `driver` value, (2) a runner module (sandbox/environment provisioner +
verb executor + evidence capture + its normalizer additions), and (3) a recipe kind for its
preparation. Nothing else moves: stores, section anchoring, the manifest, the dashboard status
model, and the generate pipeline are driver-agnostic. Testability classification already records
the target driver per section today, so when the api driver ships, its sections are
pre-classified and generation targets them with no re-scan — CLI-first is a sequencing choice,
not an architectural one.

## Setup capabilities (world-state vocabulary)

STATUS: BUILT 2026-07-07 (git provider + env allowlist + blocked-on plumbing; first designed
2026-07-06 after the first full dogfood generate: ~145 sections failed to settle largely
because their claims need sandbox state `setup` cannot express — a git repo with staged files,
for `hooks`/diff/baseline behaviors. The model correctly understood what world each test
needed; the format had no words for it.)

`setup` today has two words: `files` and `env`. A **capability** adds a word for one kind of
world-state, under one contract (the same shape as the driver contract — closed, declarative,
additive):

1. **Schema** — a Zod block under `setup.<capability>` in `packages/shared` (optional; existing
   scenarios stay valid, no format-version bump). The model declares WHAT the world looks like,
   never HOW to build it — no setup code, no shell, ever.
2. **Provider** — a runner module that materializes the declared state in the sandbox after
   `setup.files` seeding, deterministically (pinned clocks/authors/seeds; byte-reproducible).
   A scenario declaring a capability the runner cannot provide → `error` outcome with the
   reason, never a silent skip.
3. **Prompt** — nothing hand-written: the authoring prompt's scenario schema is Zod-derived, so
   the new block appears in the model's vocabulary automatically, plus one line of semantics
   ("declare the world your test needs; if it needs one not offered, author nothing and say
   which").
4. **Coverage** — a punt caused by missing world-state is recorded as a structured
   `blocked-on: <capability>` gap (not a generic reason string), so gaps group by missing
   capability and re-author automatically when it ships (generation-inputs hash moves).

**First provider: `git`** — `setup.git: { commits: [{files, message}], staged: [...], branch }`,
materialized with pinned author/committer/dates and hooks disabled. Chosen because it is the
dogfood blocker; the architecture point is the registry, not git.

**Why the capability set is CLOSED (no per-tool sprawl).** A CLI process can touch the world
through exactly six channels — filesystem, env vars, stdin, spawned executables, network,
clock — there is no seventh. Each channel needs exactly one capability: `setup.files` ✅,
`setup.env` ✅, step `stdin` ✅, `setup.stub` (one generic feature fakes EVERY executable —
never per-tool code), `setup.http`, `setup.clock`. That covers every project from day one;
we never enumerate "supported tools" and never need to dogfood N repos to find channels.
`setup.git` is NOT tool-support — git state is filesystem state (a `.git` dir is files); it's
a convenience SHORTHAND for one extremely common filesystem pattern (a sqlite file may earn
the second; likely nothing else). `blocked-on` telemetry therefore discovers which SHORTHANDS
are worth adding and which repos need tier 2 — never new channels. Pre-launch reality check:
run generate on ~5 diverse OSS CLIs, not thousands.

**Mock vs materialize — the deciding rule.** MOCK a dependency (via `stub`/`http`) when the
test must script its RESPONSES — because it is nondeterministic, remote, or costly (an LLM, a
payment API), or to inject FAULTS (a `git` stub that exits 128 tests "bails when git errors").
MATERIALIZE a dependency (via `git`-style state capabilities) when it is local, free, and
deterministic — then it is world-state, not a counterparty, and mocking it would couple tests
to the program's exact invocations (a fake `git` must know which subcommands the code calls;
real repo state doesn't care). The two compose per test.

**The general tiers** (how ANY project's world-state needs are met):
- **Tier 1 — engine primitives**: capabilities built into the runner (git; later candidates:
  **`stub` — scripted fake executables on the sandbox PATH** ("a binary named `claude`/`git`/
  `docker` that, on input matching X, prints Y and exits N") — the general answer to "the
  program shells out to something external"; **`http`** — scripted loopback server; seeded
  file DB; fake clock). Still "no Docker, no services". NOTE (2026-07-07, from the first full
  dogfood report): ~150 of 203 blocked-on gaps need scripted LLM responses — that is NOT an
  engine concept; it's what the authoring model does WITH `stub` when the program under test
  wraps an LLM (a generated scenario independently invented the fake-`claude`-stub technique).
  The engine stays LLM-agnostic; never special-case the dogfood repo's seams.
- **Tier 2 — repo-declared environments** (Phase 6's recipe v2): the repo commits its own
  environment definition (compose/ephemeral datastores); scenarios reference it by name
  (`needs: [db]`). The human owns the environment; the model only names it.
- **Tier 3 — honest gaps**: anything neither tier provides settles as `blocked-on`, visible and
  self-unlocking.

Cost note: adding a capability changes the authoring prompt → author cache invalidates → the
next generate re-authors cli claims (by design; that run is also what converts the blocked
sections).

## Section anchoring

Sections are the binding unit. Anchors must survive spec edits without lying.

- **Derivation is deterministic and LLM-free**: parse each corpus-kept markdown doc into its
  heading tree; a section = a heading plus its body up to the next same-or-higher heading.
  Anchor = slugified heading path. Identity = anchor + **fingerprint** (SHA-256 of
  whitespace/format-normalized section text). Non-markdown docs fall back to whole-doc anchors.
- The section index is computed **at generate/run time from doc content** — no new fields in
  `corpus.json`, no dependency on scan cadence. `corpus.json` only says *which* docs are in.
- `scenarios/manifest.json` records, per section: anchor, fingerprint, scenario ids, and the
  generation inputs hash — the same role `contracts/manifest.json` plays today.
- **Remap on change**: fingerprint moved but an identical/near-identical section exists under a
  new heading path → re-anchor silently. Fingerprint changed in place → scenarios are **stale**
  (spec-side drift: the claim changed; its guards may no longer test it). Section gone →
  scenarios are **orphaned**. Stale and orphaned are first-class run outcomes, surfaced next to
  failures — never silently dropped.

## Execution model (v1 = CLI driver)

**The environment is a temp directory.** No Docker, no services, no repo test-harness dependency.

- **Recipe** (`.truecourse/scenarios/recipe.json`, committed, human-reviewed at first generate):
  how to produce a runnable entrypoint from the working tree — e.g.
  `{ build: "pnpm build", entry: ["node", "dist/index.js"] }`. Discovered once (LLM-assisted),
  reviewed once, then mechanical. `run:` argv in scenarios is appended to `entry`. Full
  lifecycle — what preparation covers, storage, reuse, and when it refreshes — in
  "Preparation (the recipe layer)" below.
- **Sandbox per scenario**: fresh temp dir (`cwd`), isolated `HOME`/`XDG_*` (the user's real
  machine state never leaks in or gets touched), pinned env (`TZ=UTC`, `LANG=C`, `NO_COLOR=1`,
  fixed `COLUMNS`), setup files seeded declaratively.
- **Determinism rules**: no network egress (fail loudly, don't hang), zero retries, hard
  per-step timeout, output **normalizers** (timestamps, absolute paths, version strings,
  durations) applied before comparison. A scenario that needs a retry to pass is a defect.
  - KNOWN GAP (2026-07-07, caught by the first real red guard): the sandbox builds its child
    env as `{ ...process.env }` (sandbox.ts) — HOME/XDG are redirected, but host env VARS leak
    through, so credential-carrying vars (`ANTHROPIC_API_KEY`, proxy config) make scenario
    outcomes machine-dependent: `3-7-1-canonicalization-vocabulary.1` passed birth in an
    authenticated terminal and failed in a different shell because `contracts generate`'s
    claude preflight saw different auth. Fix: ALLOWLIST env instead of passthrough — `PATH` +
    the pinned determinism vars + `recipe.env` + `setup.env`, nothing else. Anything a program
    legitimately needs must be declared (recipe/setup/capability), never inherited.
- **Evidence transcript** on every failure: full invocation, raw + normalized output, expectation
  diff, sandbox file listing — attached to the drift object so drift-vs-bug is decided by reading
  evidence, not re-running. (Later drivers add API traces / screenshots to the same envelope.)
- **Parallel** across scenarios (sandboxes are independent); build runs once per `guard run`.

Out of scope for the CLI driver v1: interactive/TUI programs (PTY tier, later) and CLIs whose
core job is calling remote APIs (they need the api tier's network fakes; classified
`untestable-here` until then).

## Preparation (the recipe layer)

"Preparation" is everything guard must know to turn a working tree into something scenarios can
execute against — discovered once, stored, reused on every run, refreshed only when its inputs
change. It means different things per driver (cli: build + entrypoint + env prerequisites; api
later: environment compose + datastore boot + seed; web later: the api environment + a browser);
the lifecycle below is driver-generic.

- **What is stored.** `recipe.json` (above) plus a recorded **inputs fingerprint**: hashes of the
  files that informed discovery (`package.json` scripts/bin, the lockfile, build config). It is
  committable and human-reviewed on purpose — the manifest convention: a clone inherits the
  approved preparation, and generate/run never re-discover what a teammate already reviewed.
- **How it's reused.** Build runs once per `guard run`; every sandbox gets the same built
  entrypoint read-only. Scenarios never repeat preparation — they carry only per-scenario deltas
  (declarative `setup.files`/`env`). If per-scenario seeding grows repetitive within an area,
  that becomes a recipe-level shared `fixtures` extension (v1.1) — never scenario copy-paste.
- **How it's updated.** Exactly two triggers. (1) The inputs fingerprint no longer matches the
  working tree → the recipe is **stale**: generate/run say so and offer re-discovery (proposed
  again, engine-verified again, human-reviewed again). (2) A run-time build or entrypoint
  failure is an `error` outcome pointing at the recipe ("preparation failed — refresh?") —
  never drift, and never a silent automatic re-discovery. `guard recipe` shows the current
  recipe + staleness; `guard recipe --refresh` re-runs discovery explicitly.
- **What the LLM does and doesn't do here.** Discovery is proposal-only: the model returns
  candidate build/entry JSON through the transport; the ENGINE runs the verification build and
  the entrypoint probe deterministically, and the user reviews before anything is committed.

## Speed program (URGENT — from the 2026-07-07 dogfood runs)

A full generate took ~4h wall-clock; every cause below is OUR code (model/proxy-independent).
Items (1)+(2) change the generate prompt and MUST land as ONE fingerprint change (one paid
re-author covers both). STATUS: BUILT 2026-07-07 (all 8 items + the transport `--system-prompt`
root fix + the scoped no-tools guardrail; 503 tests green). Awaiting the paid validation run
(also the budgeted re-author + re-extract: GENERATE `6ab6c599555ba7dd`, EXTRACT
`d2fdc2266c5a8408`).

1. **Close the action space in the authoring prompt.** ~15% of authoring calls emitted
   tool-call JSON/`<tool_use>` markup (measured: 42 of 57 corrections were the model trying to
   grep/read the repo for real CLI behavior) — each healed by a corrective re-ask at ~1 wasted
   call. Add the explicit line: no tools, no repository access, the JSON array is the only
   possible output.
2. **Grounded authoring (the big one).** Round-1 authors BLIND against never-seen CLI output →
   258 of 436 scenarios failed first birth → a 258-call retry round (~$60, ~1.5h). Before each
   authoring batch, the ENGINE runs the commands the claims name (bare + `--help`) in a fresh
   hermetic sandbox — the exact machinery birth validation already has — and injects the real
   transcripts into the prompt (`REAL BEHAVIOR (captured in an empty sandbox): …`). Zero LLM,
   seconds per batch, deterministic; kills most of the retry round AND the motive behind (1)'s
   tool-call attempts. Transcripts are content-keyed-cacheable like everything else.
3. **Streaming transport with stall cut-off** (see the streaming note below): `stream-json` +
   first-token/stall telemetry so straggler calls are cut early instead of blocking blind for
   the full wall-clock ceiling.
4. **Kill the phase barriers (per-section pipeline).** Today: author-ALL → birth-ALL →
   retry-ALL → birth-ALL → persist; two straggler calls held 434 finished scenarios idle for
   ~30 min at the first barrier, twice more at the later ones. Pipeline per section (author →
   birth → retry → persist as each section's claims complete; recipe build kicked off parallel
   to authoring), so a straggler delays only its own section. Same design as the shelved
   incremental-settle (which also makes cancellation keep everything settled so far).
5. **Birth concurrency.** Scenario sandboxes run at min(cpus,4) while authoring runs at 20 —
   436 independent sandboxes through a 4-lane pipe, twice per run. Make it configurable
   (`TRUECOURSE_MAX_CONCURRENCY` semantics) with a saner default.
6. **Cache retry outputs.** Round-1 authoring is cached per claim; retry outputs are NOT — a
   cancel during the retry round loses all retry work (tonight: 231 calls ≈ $58 would have
   evaporated). Cache per claim keyed on (prompt fingerprint, claim, section, retry-evidence
   hash) so stopping is always cheap and resume is exact.
6b. **Retry capability-declaration errors — SPLIT 2026-07-08: retry-routing half IN BUILD (engine-only, cache-safe); prompt-loudness half stays queued for the next fingerprint batch (rolling the authoring prompt re-keys the authoring cache and would re-author everything, including the currently held-ready scenarios).**
   Original item: **Retry capability-declaration errors (from the 2026-07-07 Anthropic run: 19 sections
   lost).** A scenario declaring `setup.git` commit files it never seeded fails materialization
   with a precise message ("declared file does not exist in the sandbox: seed it via
   setup.files or an earlier commit") — but capability errors surface as infra `error`, which
   unsettles the section with NO retry. They are generation defects: route them through the
   one evidence-retry like birth fails (the quoted provider message is exactly the evidence the
   model needs). Companion PROMPT fix (rides the next fingerprint-changing edit, never alone):
   make the seeding constraint LOUD in the capabilities block — "every path in
   `git.commits[].files`/`staged` MUST also appear in `setup.files`" (the model made the
   identical mistake 19×; per the prompt rule, it never clearly saw the constraint).
   STATUS (retry-routing half): BUILT — a setup-phase birth error (capability/materialization,
   caught before any step) is now detected by `isSetupDefectResult` (runner) and routed through
   the SAME one evidence-retry as a birth `fail` in `settleCliSection`, with the provider message
   as evidence; retry counter/`guard.retry` stage + the retry cache participate identically. The
   prompt-loudness half stays queued (would re-key the authoring cache).
7. **Pin the resolved entrypoint interpreter** (correctness, found by a live false-red): a
   scenario legitimately overrode `PATH` via `setup.env` to inject a fake `claude` stub — and
   the override also swapped which `node` ran the CLI (an ancient host node resolved first and
   crashed at import: `styleText` missing). Resolve `entry[0]` to an ABSOLUTE path once at run
   start; scenario `PATH` edits then affect child-process lookups (stub injection stays
   possible) but never the interpreter under test.
8. **Generate output must end in a SUMMARY, not a dump.** Tonight's run printed 143 birth
   findings in full (expected/actual/evidence each) — unreadable, nobody scrolls that. Print
   counts per outcome kind + the top ~3 findings one line each + pointers (`guard drifts`,
   `guard status`, the report file). The detail already lives in the store surfaces; the
   terminal is for the story.
9. **Preamble conflict pointers (BUILT 2026-07-07, same fingerprint batch).** STATUS:
   `OverlapSectionSchema.heading` is now `z.string().nullable()` (null = preamble; old string
   headings still parse); the overlap prompt spells out the null-heading preamble case with a
   README↔PLAN example (edit rolls the overlap-stage PROMPT_FINGERPRINT, re-judging pairs once);
   `DocMarkdown`/`SpecDocViewer` band the pre-first-heading block via a `highlightPreamble` prop;
   `GuardCoveragePage`'s conflict-heading index skips null pointers. Overlap section pointers are
   heading-anchored, so a conflict whose passage lives
   in a doc's PREAMBLE (before the first heading — e.g. README badges/tagline claims) gets NO
   pointer for that side and the conflict viewer can't highlight it (found live:
   README.md ↔ docs/PLAN.md highlighted only the PLAN side). Fix: the overlap prompt may emit
   a null/preamble pointer meaning "the pre-first-heading block", schema + viewer band that
   block. Prompt change ⇒ overlap-stage cache invalidation — never ship alone.
10. **Path-aware relevance (BUILT 2026-07-07, same fingerprint batch).** STATUS: relevance-filter
   now passes the repo-relative PATH into the user prompt and the system prompt weighs path as
   evidence (fixture/sample/example test-data specs dropped, path evidence-not-verdict);
   system-prompt edit rolls PROMPT_FINGERPRINT so every doc re-judges once. The realistic scan
   KEPT fixture specs (tests/fixtures/sample-js-project-il/reference/specs/… — well-formed
   docs describing a FICTIONAL sample project) because the relevance prompt judges content
   without ever seeing the doc's PATH. Fix: pass the repo-relative path alongside the content
   and instruct that docs under test/fixture/sample trees describing another product are
   irrelevant to THIS repo's spec corpus. Discovery stays a signal-not-filter (by design);
   relevance is the drop point. Prompt change ⇒ relevance-cache invalidation (every doc
   re-judged once) — batch it. Available TODAY without engine changes: the doc row's "skip"
   force-exclude, or `tests/fixtures/**` in `.truecourseignore`.
11. **Estimate gate must agree with the runtime (live bug 2026-07-07: silent spend).** The
   dashboard Rescan proceeded with NO estimate modal, then the run made ~55 relevance calls
   ($0.05+) — `estimateScanTokens` returned zero stages (gate skipped as "all cached") while
   the runtime cache-missed everywhere. Estimate and runtime MUST derive from the same
   fingerprints/keys (single exported cache-probe used by both); regression test: for any
   state where the runtime would make at least one call, the estimate has at least one
   stage. Root-cause the divergence (dist-vs-src fingerprint skew is the known suspect —
   the spec-estimate test hit exactly this during item 10) — never patch by re-ordering.
   STATUS: BUILT — root cause was NOT fingerprint skew: `estimateScanTokens` never loaded
   `decisions.json`, so it planned over a different doc set than the run (manualIncludes
   missing from its prefilter/kept set, manualExcludes ignored); fixed by a single shared
   `planRelevanceWork` (spec-consolidator) consumed by both `filterByRelevance` and the
   estimate, with the estimate now loading decisions via `readCorpusDecisions`.
12. **Grounding needs progress (live report 2026-07-07: 5-minute silent gap).** Between
   "Extracting claims" and the first "Authoring scenarios" tick the engine grounds claims
   (real-CLI probe transcripts, 20s timeouts, per-section batches) with NO progress step —
   minutes of apparent hang. Surface probe progress through the tracker (grounding counter
   on the authoring step's detail, or a dedicated step — match the per-section pipeline's
   interleaving honestly; the progress rule: all long work visibly ticks). STATUS: BUILT
   2026-07-08 — `onGroundProgress(captured, planned)` from generate.ts/ground.ts rides the
   author step's detail as `grounding probes X/Y · authoring Z/W claims` (planned grows as
   sections enter grounding); flows unchanged to CLI + dashboard via the shared tracker.
13. **Retry authoring spend must be visible on the birth line (user report 2026-07-08).**
   Birth execution is deterministic (no LLM), but the one evidence-retry per birth-failed
   claim is a full Opus re-author — today it logs under `guard.generate`, so its cost
   silently accrues to the already-completed "Authoring scenarios" line while the birth line
   shows "retrying failed claims 19/20" with NO usage tag. Fix: retries log under their own
   `guard.retry` stage; the birth step's usage tag maps to it (live model/tok/$ on the birth
   line during retries); `GUARD_USAGE_STAGES` includes it so result.json totals stay
   complete. Pairs with Phase 3 gap 6 (sections-led birth denominator) — built together.
   STATUS: BUILT 2026-07-08 — the generate runner switches stage (and optional
   `guard.retry`-resolved model) on retry contexts; the validate line carries the tag.
14. **A broken entry must be ONE loud error, never N findings (live failure 2026-07-08).**
   A stale cross-branch `tools/cli/dist` (turbo cache + branch switch; tsc never cleans
   orphans) made the recipe entry crash with ERR_MODULE_NOT_FOUND on EVERY invocation —
   generate faithfully produced 25 "expected exit 0, got exit 1" birth findings and
   persisted nothing, burying the real cause. Fix: after the recipe build, PRE-FLIGHT the
   entry once in a scratch sandbox before any birth/run work — if the entry itself fails to
   start, fail the run with ONE entry-level error carrying the startup stderr (general
   design: judge "starts" by the probe transcript, no language/tool-specific string
   matching baked into the engine; the same probe result short-circuits birth AND `guard
   run`). Zero findings from a dead binary.
   STATUS: BUILT 2026-07-08 — judgment is ARGUMENT-INVARIANCE (no string matching):
   `preflightEntry` probes the built entry with two distinct argvs (`[]` and `--help`) and
   judges it DEAD only when BOTH probes fail AND their
   (exit/signal/spawnError/stdout/stderr) are byte-identical — a crash before argv parsing
   is invariant under its arguments, whereas a healthy CLI reacts (a clean exit, or
   differing failures, e.g. usage-on-no-args vs `--help`). `guard run` (run.ts,
   build-owned only) returns a new `entry-preflight-failed` status; `guard generate`
   (generate.ts) short-circuits every cli section's birth on a memoized verdict, recording
   ONE error + an `entryPreflight` report field (full untruncated stderr + the recipe
   build command as the rebuild hint), sections left unsettled. CLI + dashboard render it
   via the existing run/generate error surfaces.
   FALSE-ALIVE FIX 2026-07-08 (live: entry `dist/cli.js` vs built `dist/cli.mjs` sailed
   through): per-probe sandboxes let the harness's own temp path — embedded in node's
   "Cannot find module <cwd>/…" crash output — differ between probes, defeating the
   invariance check. Both probes now run sequentially in ONE shared sandbox (argv is the
   only varying input; the executor seam receives the shared world so it can't recreate
   the bug). Plus a deterministic entry-file existence check (`missingEntryScript`, pure
   fs, no output parsing): recipe DISCOVERY fails verification post-build when the
   proposed entry file doesn't exist (reason lists the parent dir's contents so a
   cli.js/cli.mjs mixup is one glance), and the preflight error appends the same
   diagnostic on a dead verdict when `repoRoot` is known.
15. **Recipes are user-editable, documented (user decision 2026-07-08).** `recipe.json` is
   discovered once (LLM, proposal-only) and an EXISTING file always wins — already true in
   the engine (recipe-discovery skips when present). Made official: README's guard Setup
   documents the schema (`build` / `entry` / optional `env`), that the file is committable
   and hand-editable, and the hardening example (`turbo build --force`) for build tools
   whose caches can serve stale output across branch switches. Recipe edits roll the recipe
   fingerprint → older runs flag as stale. STATUS: BUILT (README section added 2026-07-08).
16. **Ready-but-held scenarios are a first-class product concept (user decision
   2026-07-08).** Birth-passed scenarios withheld by an unsettled section (a sibling
   finding/error) are today INVISIBLE — result.json keeps only a global `birthPassed`
   count, so validated work vanishes into the authoring cache with no user-facing trace,
   and findings hide their real weight (resolving one releases its section's held guards).
   The settle rules do NOT change (all-or-nothing persist stays); this is reporting + UI:
   - result.json: each unsettled section's entry carries `readyScenarios: [{id,title}]`
     (its birth-passed-but-withheld claims) alongside its blockers.
   - CLI: generate summary + `guard status` print `N written · M ready but held
     (F findings · E errors)`.
   - Dashboard Scenarios list: a HELD block between Findings and Scenarios (bad-news-first
     order: decisions → limbo → healthy inventory), same doc › section grouping, distinct
     "held" chip, counted and filterable like findings. Held-row detail: title + binding +
     WHAT HOLDS IT (its section's findings/errors, click-through) + the authored YAML read
     from the authoring cache so the user can inspect what will land.
   - Findings show their blast radius: row/detail gains "holds back N ready scenarios";
     coverage section detail shows the same. The two surfaces cross-link — see a held
     guard → open its blocker → judge doc-vs-code → re-generate lands the section whole.
   STATUS: BUILT — report `heldSections[{doc,anchor,readyScenarios[{id,title,yaml}]}]` (inline YAML), engine capture in `settleCliSection`, CLI held line + `guard status`, dashboard HELD block + held detail + finding blast radius + overview chip (2026-07-08).

17. **Cross-section retries serialize (observed live 2026-07-08, queued).** Sections settle
   through a SERIAL chain and run their evidence-retries DURING their settle turn — so one
   section's minutes of Opus retries block every section queued behind it, and retries
   across sections never run concurrently even though nothing couples them. Restructure so
   retries parallelize across sections (the settle chain's serialization exists for id
   allocation + manifest writes — keep THOSE serial, free the retry LLM calls). Throughput
   only; no behavior change.

18. **Generate estimate must model retries or stop claiming "ceiling" (trust bug, observed
   twice 2026-07-08, queued).** The pre-flight promised "up to $7.14" → billed $12.56, then
   "up to $3.18" → billed $8.43 — the estimate covers extraction + round-1 authoring but
   retries (up to one full re-author per claim, Opus) are absent from the model, so the
   "cost is a ceiling" copy is false whenever retries fire. Fix: include the retry bound in
   the ceiling (worst case = every estimated claim retries once — honest and still
   deterministic) or, if that reads absurdly high, present two numbers ("$X, up to $Y if
   every claim needs its retry") — never a "ceiling" the bill can exceed. Same trust family
   as item 11 (estimate/runtime agreement).

24. **Discontinued CLI commands: deprecation notice + hidden from help (user decision
   2026-07-08).** STATUS: BUILT.
   The contracts/verify pipeline commands (`contracts`, `verify`, `infer`,
   `drifts`) stay REGISTERED and functional — EE's verification gate still rides the code —
   but each prints a one-line deprecation notice on invocation (discontinued in favor of
   `guard`, see README, removal planned for 0.8) and is hidden from `--help` so new users
   never discover them. Outright removal deliberately deferred until the EE gate migrates.
   The dashboard analog already shipped (BL Drift registry-hidden in both editions,
   URL-reachable for EE Pulls deep links).

21. **Stacked non-interactive gates defeat the single retry (findings analysis
   2026-07-08, queued).** `analyze` demands two sequential decisions non-interactively
   (`--llm/--no-llm`, then `--stash/--no-stash`); a scenario fails gate 1, the retry fixes
   it and dies on gate 2 — one retry cannot fix N stacked gates. Candidate fixes (pick at
   build time): grounding probes walk the gates (probe output IS the next gate's message —
   feed the chain into authoring), or the retry loop allows one retry PER DISTINCT gate
   message (bounded by distinct evidence, still never re-torturing the same failure).
22. **Ground catalog-dependent claims with a catalog probe (findings analysis 2026-07-08,
   queued).** Four findings were `rules disable <key>` → "Unknown rule" — the model
   invented eslint-flavored keys because TrueCourse's catalog is unknowable from the doc.
   Grounding should probe enumerating commands (`rules list`-shaped) when claims reference
   catalog entries, so authoring gets real keys. General: driven by the claim's backtick
   fragments, never a hardcoded command list.
23. **LLM-dependent commands must classify as blocked-on, not author (findings analysis
   2026-07-08, queued).** `infer --dry-run` was authored as a CLI scenario and failed in
   the sandbox (fresh HOME → no claude auth) — the run correctly classified 5 OTHER
   sections `blocked-on: llm-provider`; the classifier missed this one. Tighten the
   extraction/classification prompt (rides the next fingerprint batch with 6b's
   prompt-loudness half).

19. **Findings must be judgeable on one screen (user decision 2026-07-08).** A finding asks
   "generation defect or real drift — your call" while withholding the material for the
   call: (a) the candidate's scenario YAML is discarded (held rows carry theirs since item
   16 — findings don't); (b) the birth evidence IS fully captured on disk
   (transcript/stdout/stderr/invocation under the finding's `evidencePath`) but
   GuardFindingDetail renders the path as inert text instead of loading the transcript
   like the run-failure detail's evidence viewer. Fix: findings carry `yaml` inline (same
   serialize-at-creation as heldSections), and the finding detail embeds the existing
   evidence viewer on `evidencePath`. (The doc excerpt was considered and dropped —
   view-in-spec suffices; user call.)
   STATUS: BUILT — findings carry `yaml` + `claim` inline (serialized at finding creation); GuardFindingDetail renders the YAML code block and loads the full transcript via a path-keyed `/guard/finding-evidence` route (`readGuardEvidenceAt`, evidence-root confined).

20. **Dismissing findings (user decision 2026-07-08).** A finding the user judges as noise
   or won't-fix needs a persisted dismissal: a committable guard decisions file (spec
   `decisions.json` analog) holding `dismissedClaims` keyed by section + claim identity
   (anchor + claim/title). Generate consults it: a dismissed claim is not re-authored,
   not retried, never re-findinged — it settles as an explicit `dismissed` GAP (a visible
   coverage status, never a silent disappearance), which lets its section settle and
   RELEASES its held siblings on the next generate. Un-dismiss via the decisions file or
   the UI. If the doc section's content changes, extraction re-runs and a dismissal that
   no longer matches a live claim is surfaced as orphaned, not silently honored. UI:
   dismiss action on the finding detail (inline actions stopPropagation per house rule),
   dismissed entries visible somewhere honest (coverage status + a way to review/undo).
   STATUS: BUILT — committable `scenarios/decisions.json` (`dismissedClaims`, identity = doc+anchor+extracted-claim-text); generate skips a dismissed claim before authoring, records a `dismissed` coverage gap (settles the section, releases held siblings), and reports `orphanedDismissals`; dashboard Dismiss/Un-dismiss on the finding detail + a `dismissed` coverage status; `guard status` shows the dismissed count.






## guard generate (the LLM pipeline)

Call-timeout note (measured 2026-07-07): authoring calls on borderline claims have a heavy
reasoning-time tail — the SAME batch that died twice at the 30-min wall-clock kill (claude-CLI
route, blind wait) completed in 435s when replayed streaming (407s to first token, all hidden
reasoning; ~4x run-to-run variance observed on identical prompts). Deferred-retry (fail-soft,
re-attempt next run) is the right OSS strategy for the calls that still die.

**Streaming CLI transport (decided 2026-07-07, applies to ALL pipeline stages, not just
guard):** `cliTransport` switches `--output-format json` → `--output-format stream-json
--include-partial-messages` (same `claude -p` process; NDJSON events on stdout). What it buys:
(1) per-call TTFT + stall telemetry in the call log (`ttftMs` field exists, currently empty on
the cli route); (2) a real STALL timeout — once the stream has started, no event for N seconds
→ kill (a hung proxy no longer looks like thinking); (3) for Anthropic models, thinking deltas
stream too (full visibility); for hidden-reasoning proxy models, pre-first-token silence stays
ambiguous, so the overall wall-clock ceiling REMAINS as the backstop — streaming augments it,
never replaces it. Final text/usage/cost come from the terminal `result` event (same fields as
the buffered format). The EE AI-SDK transport gets the same two-tier timeout natively.

Prompt-hardening note (observed 2026-07-07, ~15% of authoring calls): with `--tools ''` the
model still ATTEMPTS tool calls (Read/grep JSON like `{"file_path": …}` / `{"cmd": "grep …"}`)
trying to inspect the repo before asserting on CLI behavior — the corrective re-ask recovers
100% of these, at ~one wasted call each. Fix on the NEXT fingerprint-changing prompt edit
(never alone — cache cost): one explicit line "you have no tools, no repository access;
tool-call JSON is invalid output — author only from the provided context; birth validation
supplies real behavior on retry."
- **Root fix at the transport (decided 2026-07-07): `--append-system-prompt` →
  `--system-prompt`.** The claude harness's built-in system prompt (the text that TEACHES
  tool/agent behavior) costs ~3.1K input tokens on EVERY call (measured: 10,140 vs 7,028 for
  an identical probe) and is pure contamination for output-only calls. Full replace removes
  the priming for ALL transport stages at once, saves ~1.6M input tokens per 512-call run,
  and moves NO fingerprints (transport flag, caches stay valid). Verified live: envelope,
  usage, cost reporting intact.
- **No-tools line scope**: guard prompts (generate/extract/recipe) AND spec-scan prompts
  (relevance/area-tag/vocab/overlap/relation) via ONE shared constant. Deliberately EXCLUDED:
  contracts prompts (feature may be discontinued — no further investment) and analyze prompts
  (separate `LLMProvider` path, out of scope). Each inclusion moves that stage's fingerprint —
  spec re-scan + guard re-extract are the accepted one-time costs.

**OSS AI-SDK transport (decided 2026-07-07).** OSS gains a third `LlmTransport` backend next
to `cli` and `agent`: a direct AI-SDK route configured from ENV ONLY — base URL + API key
(OpenAI-compatible endpoint; e.g. `TRUECOURSE_LLM_BASE_URL` + `TRUECOURSE_LLM_API_KEY`, exact
names decided at build time) — no config-file key storage, no Models UI (those stay EE:
multi-provider, managed/encrypted keys, per-org models). Env absent → transport unavailable,
`cli` remains the default. What it buys OSS: no `claude` binary dependency (CI-friendly),
native streaming with the two-tier timeout (first-token + stall), per-call reasoning-effort
control, and honest token/cost telemetry where a proxy's `claude -p` reporting is unreliable.
Lives outside `shared` (own small package or core service) so the `ai` dependency doesn't
spread; registered through the existing default-transport hook. STATUS: NOT STARTED.

Stages, each cached under `.cache/guard/` (content-keyed KV, same pattern as
`consolidator/*` — re-runs are cheap, cache is derived/deletable):

1. **Section index** — deterministic, free (above). Sections are the BINDING/staleness unit
   only — never the unit of LLM processing. (v1 classified and generated per heading; that
   authored blind, without the document's own definitions and conventions — redesigned
   2026-07-04 to the whole-document model below, mirroring how contracts enumerate reads a
   whole area.)
2. **Claim extraction** — ONE LLM call per document (split along top-level headings into
   outline-plus-view chunks only when the doc exceeds the call budget; claims unioned): the
   model reads the WHOLE document and returns its testable claims — each
   `{ claim, driver (cli now; api/web/tui recorded), sectionAnchor, reason }` — plus per-section
   untestable coverage notes. The engine validates every returned anchor against the index
   (snap/reject, never trust). Honesty rule unchanged: sections yielding no claims are visible
   coverage gaps with reasons, never silently skipped. Cached per doc fingerprint.
3. **Recipe discovery** — once per repo (skipped when `recipe.json` exists): propose build/entry,
   verify it actually builds and the entrypoint answers (e.g. `--help`), present for review.
4. **Scenario authoring** — claims in BATCHES (contracts-style), each call carrying the
   whole-document context (or its digest when chunked) + each claim's section text + the closed
   verb set, so authoring never loses the global picture. Cached per claim (claim + section
   fingerprint + recipe fingerprint + format version); only claims from changed sections
   re-author.
   - **Batch size is a speed-vs-cost dial the user should own** (planned; measured 2026-07-06 on
     the same 4 claims, Opus 4.8 via `claude -p`): 1 call × 4 claims = 388s / $0.87; 4 parallel
     calls × 1 claim = 147s / $1.25. Output (thinking) tokens are ~identical either way —
     batching serializes the thinking, solo parallelizes it — while solo re-pays the shared
     input context per call. Expose it as an explicit fast-vs-economical generate option
     (batch=1 ⇒ fastest wall-clock, ~1.4× cost; batch=4 ⇒ cheapest, slowest), defaulting to the
     current batched behavior; `TRUECOURSE_GENERATE_BATCH` stays as the raw override.
5. **Birth validation** — deterministic: every new/regenerated scenario is run immediately and
   must pass against current code. A scenario failing at birth is either a generation defect
   (regenerate/fix) or **real existing drift** (surfaced to the user as a finding); it is never
   written into the corpus as a failing guard. Green-at-birth is the baseline semantic.
6. **Fidelity review** (v1.5, separate STATUS) — adversarial LLM pass per scenario: "does this
   assert the section's actual claim, or something weaker?" Weaker-than-spec is the worst failure
   mode (green tests, false confidence) and gets its own gate.

**Authorship is output-only (the transport seam).** Scenario generation, testability
classification, and recipe discovery all ride the existing `LlmTransport` seam exactly like scan
and contract generate: the model **returns** content (scenario YAML, verdict JSON, recipe JSON)
and never writes files, never runs commands, never uses agentic tools. The engine parses,
Zod-validates, birth-validates, and writes. This is what keeps guard edition-portable — OSS runs
the `claude` CLI (text/JSON out), EE swaps in the AI-SDK transport with identical prompts — and
what makes the content-keyed caches and the pre-flight estimate coherent (pure text in → text
out; no side effects a cache hit would skip).

**Estimate**: same convention as scan/contracts today — token math deterministic and offline,
ceiling cost, cache-aware, "N of M sections changed", no stages ⇒ confirm prompt skipped. Wire
into `packages/core/src/services/llm/spec-estimate.ts` alongside the existing subjects.

## guard run (the new verify)

- Build via recipe → run all scenarios (or a section/area/scenario selection) → map results.
- **Run outcomes per scenario**: `pass` | `fail` (code-side drift candidate) | `stale`
  (spec-side drift) | `orphaned` | `error` (infra problem — reported as such, never as drift).
- **Store**: `.truecourse/guard/` — `runs/<iso>_<short-uuid>.json` (gitignored), `LATEST.json`
  (committable, commit only after merging to main), `history.json` (gitignored), plus
  `evidence/` (gitignored). Update `GITIGNORE_CONTENTS` in `packages/core/src/config/paths.ts`.
  **There is no diff mode and no `diff.json`** — guard shows current state only (decided
  2026-07-03: the diff's value is too low; in EE, base-vs-PR comparison happens server-side over
  per-commit snapshots, which is a stored comparison, not a diff mode).
- **`LATEST.json` contents** (the materialized current state — what the dashboard coverage UI,
  `guard status`, and `guard drifts` read, and what a clone inherits so spec pages show coverage
  without a local run): run envelope (`ranAt`, branch, commit, `recipeFingerprint`,
  `scenarioFormat`), the outcome summary, per-scenario results — each with its section binding,
  outcome, duration, and for failures a **compact inline** failure detail (failing step +
  expectation diff) plus a pointer into `evidence/` — and a per-section rollup
  (anchor → status + scenario ids). Inline-compact matters because `evidence/` is gitignored: a
  clone must render a red section with a reason; the full transcript exists only where the run
  happened. Untestable/grey lives in `scenarios/manifest.json` (generation-side); the coverage
  UI composes the two. In EE this same shape is the per-commit snapshot row (base and PR heads).
- **Drift-vs-bug**: the run never decides. A `fail` is presented with its evidence; the developer
  resolves it as *code wrong* (fix code; scenario stands) or *spec stale* (edit the spec — which
  makes the scenario `stale` and queues regeneration). The engine never rewrites a scenario to
  match failing code.
- `truecourse guard status` — terminal one-liner (sections guarded/failing/stale/untestable).
- `truecourse guard drifts` — inspect guard-run drifts (paginated), same UX as `drifts list`.
  The existing `truecourse drifts` stays on the contract verify store, untouched.

## Dashboard

**Placement (user directive, 2026-07-03, made explicit 2026-07-07): Guard is a TOP-LEVEL
SECTION** in the section switcher — a third module next to Code Analysis and BL Drift, never a
tab inside BL Drift. Its tabs: Coverage (default), Drifts, Report.

**First-run coverage fixes (user bug reports 2026-07-07, post-scan fresh store — eighth
review pass).** Four defects found running the published build on a scan-only store (corpus
present, generate never run):
1. **Onboarding empty states must never shadow a selection.** The Coverage main pane's
   stage CTAs (scan → generate → run) render ONLY when nothing is selected. A selected doc
   ALWAYS renders: raw markdown pre-generate (conflicts stay resolvable in context — the
   fallback already existed but an early-return `!hasGenerated` empty state made it
   unreachable), the coverage-banded view once generated. "No guards generated" is the
   no-selection onboarding card, nothing more.
2. **A selected conflict owns the WHOLE main pane.** The two-column SpecOverlapDetail
   renders full-width; the doc center pane hides while a conflict is open (closing the
   conflict returns to the selected doc). Never render a doc — least of all a previously
   selected, unrelated one — squeezed beside a conflict; the conflict columns carry their
   own doc context.
3. **Empty states are never duplicated across panes.** With an empty inventory the
   Scenarios LEFT panel shows one quiet muted line ("No scenarios yet."); the MAIN pane
   carries the single EmptyState with the CTA. Two identical cards side by side read as a
   rendering bug.
4. **No hand-written clause in onboarding copy.** "…or commit hand-written ones under
   .truecourse/scenarios/" is dropped everywhere — hand-written scenarios stay supported
   (chip, inventory), but the empty state says the one thing to do: run
   `truecourse guard generate`.

**Skips batch — decisions write instantly, ONE rescan applies them (user request
2026-07-07).** Force-exclude/include used to trigger a full re-curate PER CLICK (tens of
seconds each; set-level stages re-run every time) — skipping five docs meant five scans.
New model, both surfaces:
- **Dashboard (OSS)**: the skip/include row action persists the decision to
  `specs/decisions.json` and returns immediately — no re-curate. The row moves
  optimistically (pending tint until the next scan materializes it), and the Rescan header
  button gains the amber staleness dot whenever recorded decisions are newer than the
  corpus (`decisions.json` mtime vs corpus `generatedAt` — the decisions half of the logged
  scan-staleness follow-up; docs-content staleness remains open). One Rescan applies any
  number of queued decisions. EE keeps its existing recurate-over-seam flow (no live tree,
  auto-regen gating — untouched).
- **CLI**: `truecourse spec docs exclude|include <path...>` accepts MULTIPLE paths and
  re-curates ONCE at the end, not per path.
Conflict-relation resolutions keep their immediate re-curate (a resolution wants instant
confirmation that the conflict cleared).

**Evidence for passes too (user decision 2026-07-08 — long-discussed, now committed).**
`guard run` captures the per-scenario evidence transcript for EVERY outcome, not only
failures: a green guard's transcript is the proof of what actually executed — without it a
pass is just a checkmark. Per-scenario results carry `evidencePath` for all outcomes; the
run detail renders the transcript open for passes exactly like failures (chrome-diet rule:
no toggle). The earlier "a pass detail never renders evidence" rule is REVERSED by this
decision (it existed only because passes had no evidence to show; the state-leak fix it
came from — reset-on-selection — stays). Disk cost is trivial (small text files, gitignored,
keyed under evidence/<runId>/); note evidence dirs accumulate per run — if pruning is ever
needed it prunes with runs/, same lifecycle. Birth-time evidence for PASSING candidates
stays uncaptured (the run right after supersedes it; findings already carry theirs).
STATUS: BUILT — `runScenario` writes the same evidence bundle on the `pass` return path
(transcript stamped `pass`, invocation, focus = last step's streams, files listing, a diff
noting every step met its expectations); `GuardScenarioResult.evidencePath` is now populated
for every EXECUTED outcome (pass/fail/error) and stays absent on non-executed stale/orphaned
(no transcript) and on pre-decision runs — the field was already `.optional()`, so old
LATEST/run snapshots parse and render unchanged. `GuardDriftDetail` widened `hasEvidence` from
failed-only to any-result-with-`evidencePath`, so a pass with a transcript renders it open on
mount exactly like a failure and an older pass without one renders no evidence section. Store
lifecycle untouched (evidence dirs share the runs/ keying). Birth-time pass evidence stays out
of scope. Pass evidence renders EVERYWHERE evidence can render: GuardScenarioDetail widened the
same way (transcript open on mount for any result with `evidencePath`), and GuardSectionDetail's
scenario rows offer their "View evidence" affordance for any executed outcome with a transcript
(the coverage side panel keeps its row-toggle idiom — chrome-diet rule 3 scopes render-open to
the tab-content details, and rule 1 already carves the section panel out).

**Detail-pane chrome diet (user review 2026-07-08).** Four rules from reviewing the
finding/scenario details:
1. A detail rendered as TAB CONTENT never renders its own close X — the tab's X is the one
   close affordance. (Right-pane details that are NOT tabs — e.g. Coverage's section
   detail — keep theirs.)
2. Actions live in ONE row: "Dismiss finding" sits next to "View in spec", same outline
   button idiom, with an icon (Ban-style), never a stray stacked button.
3. NO View/Hide toggles for evidence or YAML — content renders open by default (evidence
   fetched on mount, scrollable code blocks bound the height). Applies everywhere:
   finding detail, held detail, scenario detail, run-failure detail. Toggles are reserved
   for genuinely heavy or rarely-relevant content, and neither of these qualifies.
   Principle: fewer buttons; the reader came to READ.
STATUS: BUILT — all four tab-content details (GuardScenarioDetail, GuardFindingDetail,
GuardHeldDetail, GuardDriftDetail) drop their own close X (the tab strip owns the close;
GuardSectionDetail + SpecOverlapDetail keep theirs); GuardFindingDetail's Dismiss/Un-dismiss
sits in the binding action row next to View in spec with a Ban icon; evidence + YAML render
open (fetched on mount, no View/Hide toggles) across finding/scenario/run-failure details.

**Coverage gets the shared tab model (user request 2026-07-08).** The Coverage main pane
adopts the SAME preview/pin tab mechanism as Scenarios and Runs (useGuardTabs idiom +
GuardTabStrip): sidebar doc rows single-click → PREVIEW tab (italic, replaced by the next
single-click), double-click → PIN; conflicts open as tabs the same way (label "a ↔ b",
full-pane SpecOverlapDetail as today, now inside a tab); the strip renders only while at
least one item tab is open, with the Overview chip first (Overview = today's no-selection
content: the stage CTAs / select-a-document state). Tab labels are repo-relative paths
(truncated, full on hover — path-label rule). Section selection (?gsec) stays a
within-doc right-pane detail, not a tab. URL params keep coverage's existing keys
(?guard/?gconf) extended for pinned sets consistently with ?gscn/?gdrift. Scope: the
guard Coverage tab only — the hidden BL Drift Spec tab is discontinued and untouched.
STATUS: BUILT 2026-07-08 — `useGuardTabs` generalized to accept a `GuardTabsParam`
codec (read/write/deepLinkTabs) beside the plain `param: string`, so Coverage binds
TWO params (`?guard` doc, `?gconf` conflict) to one heterogeneous tab set from the
ONE reducer; thin binding `useGuardCoverageTabs` (mirrors `useGuardScenarioTabs`)
adds the codec + the within-doc `?gsec` section. RepoPage lifts the reducer (like
Scenarios) so the sidebar (reused SpecCorpusView) and the main pane share it; the
whole coverage surface (totals strip, GuardDocCoverage/raw-markdown center, section
detail) now lives inside the active doc tab's pane, conflicts render the full-pane
SpecOverlapDetail inside a tab, the Overview chip returns to the stage CTAs. URL
mapping: the active tab mirrors `?gconf` else `?guard` (a conflict wins a link that
carries both — its resolution surface is the point), and an inbound `?guard=X&gconf=Y`
opens BOTH as pinned tabs with the conflict active. `useGuardSelection` retired.

**Doc labels are repo-relative paths, not basenames (user bug report 2026-07-07, ninth
review pass).** Real corpora hold many same-named docs (six README.md's in this repo's own
scan) — basename-only labels made doc rows indistinguishable and conflict rows read
"README.md ↔ README.md". Everywhere the spec sidebar names a doc (doc rows, conflict labels,
resolution summaries — the shared SpecCorpusView, so BL Drift's Spec tab inherits the fix)
the label is the full repo-relative path, truncated with the full path on hover. Root-level
files stay short; nested files show the path that distinguishes them. Never a bare basename
for anything user-distinguishing.

**DocMarkdown renders raw HTML (user bug report 2026-07-07, ninth review pass).** READMEs
open with HTML blocks (`<p align="center"><img …>`, badge links) that react-markdown was
rendering as literal text. DocMarkdown — the ONE markdown pipeline (Spec tab + guard
coverage + raw-doc fallback all use it) — gains rehype-raw + rehype-sanitize (GitHub-style
schema extended with img/align/id) so doc HTML renders instead of leaking source. Side
effect: the logged "Spec-tab anchor artifact" follow-up resolves — `<a id>` becomes a real
invisible anchor element instead of visible text (guard coverage's pre-render
`stripDocAnchors` stays, harmless, for chunk alignment). Relative image srcs may 404 in the
dashboard (no asset route) — the broken-image/alt fallback is acceptable and honest;
external badge images load normally.

**Scenarios tab layout (revised 2026-07-07 — house pattern, list-in-panel).** The Scenarios
tab is the corpus INVENTORY and follows the app-wide shape LIST IN LEFT PANEL → DETAIL IN MAIN
PANE (like Contracts/Spec/Inferred) — never a full-width in-page list. Left panel: the
scenario list grouped doc › section (every committed guard — generated AND hand-written,
orphaned flagged, last-run outcome badge per row) with the search/doc/status filters on top.
Group headers use the section's HUMAN heading text ("10.7 The Local Developer Loop"), NEVER
the raw anchor slug ("10-7-the-anchor-slug"), and must be visually bound to the rows
they head (sticky-header idiom) so a header is never ambiguous between the item
above and below; slugs are engine identifiers, not UI copy (user feedback 2026-07-07).
Rows sit FLUSH at the house `px-3` left edge — same anatomy and same edge as the Runs list
rows — with hierarchy carried by header tint/typography, never by indentation: a
doc→section→row indent stair (12→20→28px) makes every row read "shifted right" against the
Runs tab (user reported twice; sixth review pass 2026-07-07).
Main pane with NOTHING selected: the tab's overview — the recipe card (build/entry/env/short
fingerprint/provenance/staleness; the preparation layer gets a card here, not its own tab) +
the "last generate" strip (envelope · settled/unsettled · authored vs birthPassed · findings
with view-in-spec · grouped errors; expanded when findings/errors exist, else collapsed).
Selecting scenarios uses the app's TAB/PIN mechanism exactly as the Spec doc tabs do:
single-click opens a PREVIEW tab in the main pane (replaced by the next single-click),
double-click PINS it; a scenario tab shows the full detail — YAML source, last result +
failure detail, evidence transcript (wide monospace content belongs in the main pane, never
inline row-expands). View-in-spec jump preserved. Runs stay in the Drifts view's left panel
(no separate Runs tab; it would duplicate).

**Home-page repo cards show the LATEST event (decided 2026-07-07).** The repo list currently
shows only "Analyzed <date>"; instead each card shows the repo's most recent lifecycle event
across features, verb + date — e.g. "Guarded <date>" (guard run), "Verified <date>" (contract
verify), "Scanned <date>" (spec scan), "Analyzed <date>" — derived server-side from the
per-repo stores' own timestamps (guard/LATEST ranAt, verifier LATEST, corpus generatedAt,
analyze LATEST), tolerant of unreadable repos, newest wins.

**Follow-up (found 2026-07-07): BL-Drift Spec tab shows the same anchor-tag artifact.**
react-markdown renders raw HTML as visible text app-wide; Coverage strips empty `<a id>` tags
at render time, but the shared DocMarkdown (Spec tab) still shows them. Fix is the same strip
in DocMarkdown — touches the shared component, so it's a deliberate small change with the
spec-tab tests as the gate, not a guard-scoped patch.

**Follow-up (found 2026-07-07): no scan-staleness signal exists.** The Scan action button
carries no staleness dot anywhere (guard Coverage or BL-Drift Spec) because nothing computes
"docs changed since the corpus was scanned" — Generate/Run/Verify all have their signal, Scan
doesn't. Needs a server-side signal (corpus generatedAt vs the corpus-kept docs' mtimes,
tolerant), then the shared Scan button renders the same amber dot idiom. Applies to both
modules at once.

**Drifts tab → "Runs" (decided 2026-07-07).** The tab is a RUN INSPECTOR and is named for what
it shows, not its bad news: label "Runs" (matches BL Drift's Runs vocabulary; "Verify" stays
banned for guard per Naming). Left panel unchanged (run summary + history + trend; the Run
action + its staleness dot stay here). The selected run's main pane shows FULL results:
failures first, severity-ordered exactly as today (fail → error → stale → orphaned, detail
pane with evidence/YAML/view-in-spec), then a "passed (N)" group — collapsed by default when
large, expandable, every green guard previewable with its duration. An all-green run renders
the green list (never an empty state — "N passed" is the product working). The word "drift"
remains the severity concept inside the view and the CLI command name (`guard drifts`,
deliberately failure-focused). Tab id may stay `guarddrifts` (URL stability); only the label
and the main-pane contents change.

**Dot policy (revised 2026-07-07 — user final): dots on ACTION BUTTONS ONLY.** Amber staleness
dots live on the header action buttons (Scan/Generate/Run — hidden while the action runs),
exactly like Verify/Contracts. NO rail-tab dots of ANY kind — the findings marker is removed
too; the "findings never bury" rule is served by findings being first-class rows in the
Scenarios left-panel list plus a findings tally among the overview's last-generate stats.

**Engineering rule (user directive 2026-07-07): never fine-tune to the current case; no
hardcoded specializations.** Guard has ONE driver today (cli) and more coming (api, web, tui,
desktop…). Any code that encodes "cli is the driver" as a literal branch, a baked status
list, a group tag maintained by hand, or copy that assumes one driver — instead of deriving
from a driver/status REGISTRY that new drivers extend additively (the plan's driver contract)
— is a workaround and must not ship. The test for every such spot: "when driver #2 lands,
does this code adapt by data, or does someone have to find and edit it?" If the latter, it's
wrong today.

**Coverage totals strip grouped by DRIVER SCOPE (user decision 2026-07-07):** the chips split
into two labeled clusters — **CLI (today's driver)**: passing/failing/error/stale · blocked-on
· untestable · no-claim · unguarded (all verdicts of attempting to guard via the CLI driver) —
and **Other drivers (future)**: api · web · tui (sections waiting for drivers that don't exist
yet; postponements, not verdicts). Never mix the two in one flat row: "API driver" next to
"blocked" reads as comparable outcomes and they are not.

**Findings live in the scenario list (user feedback 2026-07-07, fifth review pass).** Birth
findings are first-class rows in the Scenarios tab's LEFT-PANEL list, not buried in the
overview: they appear in the same doc › section grouping as committed scenarios (they are
section-bound artifacts that failed to become guards), each with a distinct "finding" badge
(red-tinted, clearly not a run outcome), included in the list counts, and filterable — the
status filter gains a "finding" option so they can be isolated in one click. Selecting a
finding opens a tab via the same preview/pin model: the tab shows the finding detail
(failed step, expected vs actual, view-in-spec). The overview has NO findings section
(sixth review pass 2026-07-07) — the left list is the ONLY findings surface; the overview
carries only their COUNT among the last-generate stats.
Findings order FIRST (user decision 2026-07-07, seventh review pass): the Runs view's
bad-news-first idiom applied to the inventory — findings form their own labeled block at the
TOP of the list (grouped doc › section inside it), with the committed scenarios following
below in spec order. Grouping headers follow the Coverage tab's Documents header idiom
(SpecCorpusView `Section`): COLLAPSIBLE — chevron, aria-expanded, default open — and
sticky-SOLID: a bg-card wrapper with any tint layered inside it, never a bare alpha tint
that lets scrolling rows show through (user caught both inconsistencies same day). The rule
is general: BLOCK headers (Findings/Scenarios) and DOC headers both collapse — any header
that can hide dozens of rows earns a toggle. SECTION headers stay static BY DESIGN: sections
hold ~1–3 rows, and a chevron per near-empty group is noise, not control.
Findings' section headings join SERVER-SIDE from the live doc's section index (the same
read-time `headingTextIndex` join scenarios get in `listGuardScenarios`): a finding's
section is unsettled by definition, so it NEVER has a committed scenario to donate
`headingText` client-side — without the server join every findings group header degrades to
a slug, violating "slugs are never UI copy". The report read for the dashboard enriches
each birth finding with optional `headingText`; the client prefers it over any resolver
fallback. A finding is the one row asking for a
user decision; it must never sit below a page of green rows. No resolve/dismiss action
exists BY DESIGN: a finding's section is unsettled in the engine (files + manifest entry
dropped), so the resolution loop is fix the doc or the code in the repo, then Generate —
which re-attempts exactly the unsettled sections. The dashboard's per-finding affordances
are the detail (expected vs actual) and view-in-spec; Generate is the closing action.

**Authoring errors are housekeeping, not a work list (user feedback 2026-07-07, fifth review
pass).** Unlike findings (user decisions), authoring errors are self-healing: their sections
stay unsettled and re-attempt on the next generate. The Overview therefore presents them as
ONE deferred-work line — "N sections deferred — will re-attempt on the next generate" — with
an expandable detail that is actually READABLE: per pattern, the FULL error message (wrapped,
never truncated) and the affected sections by HUMAN heading name (never slug chips), each
linking view-in-spec. No pretend to-do list; the pattern grouping exists for diagnosis, and a
recurring pattern is an engine bug to fix (see speed-program item 6b), not user work.

**Pinned Overview tab + flat strip (user feedback 2026-07-07, fourth review pass):**
1. Both Scenarios and Runs get an "Overview" tab as the first tab in the strip — never
   closable, showing exactly the no-selection content (Scenarios: recipe + last-generate;
   Runs: the selected run's overview). It renders ONLY while at least one item tab is open
   (revised 2026-07-07, user): with no item tabs the strip shows no Overview chip — the
   overview content is already the whole main pane, so a lone chip is noise. Opening item
   tabs never hides the way back; the Overview tab is active when no item tab is selected,
   and closing the last item tab lands back on the overview (chip gone again).
2. The "Last generate" content is NOT a boxed panel — the bordered panel container was the
   collapsible affordance's chrome and lost its purpose when the strip went flat. Render it
   as plain content: a small heading with the content flowing beneath — no border box, no
   panel header.

**Overview is numbers and stats (user feedback 2026-07-07, sixth review pass).** The
Scenarios overview = recipe card + the last-generate story told in NUMBERS. The "Last
generate" block renders the envelope (when · status) and then PROMINENT stat tallies —
settled / unsettled sections, authored, birth-passed, findings, calls, cost — using the Runs
overview's tally-chip idiom (semibold number + small label), never one muted truncated text
line. Birth-finding rows are GONE from the overview (they live only in the left-panel list);
the deferred-errors housekeeping line stays beneath the stats. Density: the overview's
top-level blocks (recipe · stats · deferred) breathe at a space-y-6 rhythm — the user read
the earlier space-y-3 clump as "noisy, everything too close to each other".

**Runs view bugs (user feedback 2026-07-07, third review pass):**
1. **Evidence state leaks across selections.** Toggling evidence open on a FAILED scenario,
   then selecting a PASSING one, leaves the evidence pane visible — showing a transcript that
   cannot belong to the pass (passes have no evidence). The detail pane's evidence/YAML
   open-state and fetched content MUST reset when the selected scenario changes (key the
   detail component by scenario id or reset on id change); a pass detail never renders an
   evidence section, regardless of prior state.
3. **Selected run shows an OVERVIEW until a scenario is opened** (same idiom as the Scenarios
   tab's overview): with no scenario tab open, the Runs main-pane detail area renders the
   selected run's summary — envelope (ranAt · branch @ commit · recipe fingerprint), outcome
   tallies, total/slowest durations, load errors if any — never a bare "select a scenario"
   placeholder.
2. **Ran scenarios must follow the preview/pin tab principle.** Selecting scenarios in the
   Runs view uses a plain transient detail pane — inconsistent with the app-wide model.
   Opening a ran scenario follows the SAME mechanism as the Scenarios tab: single-click =
   preview tab (replaced by next single-click), double-click = pin, main-pane tab strip
   (italic preview / pinned), URL-addressable, guard-scoped state (extend/mirror the
   `useGuardScenarioTabs` reducer — one tab model, not a second implementation).

**Guard UI polish (user feedback 2026-07-07, second review pass):**
1. Runs tab icon: not TriangleAlert (a Drifts leftover) — use the runs idiom (BL Drift's Runs
   tab uses ClipboardList; match it or a clearly run-ish icon).
2. The run-summary panel header must name the SELECTED run, never "Last run" — e.g.
   "Run · <date>" with a "latest" chip when the selected run is the newest.
3. The Run Trend strip must be visually self-explanatory or go — investigate its live
   rendering (few-run histories can render broken/confusing bars); fix the visual with a
   hover/legend affordance, or remove it until EE analytics if it can't be made obvious.
4. Runs left-panel typography reads too small — raise the run-summary panel to the list-row
   scale (13px primary values, 11px meta) even though the verify aside uses smaller; guard
   follows readability here (noted divergence, BL untouched).
5. Header action buttons share ONE visual variant: Generate currently renders primary/black
   while Rescan and Run don't — align Generate to the same variant as the others.

**Coverage doc-surface behaviors (user feedback 2026-07-07):** in-document cross-reference
links (hash/anchor targets, incl. the doc's `<a id>` tags) navigate WITHIN the view — scroll +
select the target section, same mechanism as ?gsec deep-links; only external http(s) links
open a new tab. Standalone `<a id>` anchor lines must never render as visible text. A section
click re-renders only the affected sections (chunks memoized) — never the whole ~310-chunk
document. Status filtering (the totals-strip chips) offers a BLUR ↔ HIDE toggle: blur keeps
non-matching sections dimmed in place (context preserved), hide collapses them entirely
(focused reading); the choice is a small control next to the strip and persists per the app's
view-preference idiom if one exists (else component state).

**Guard is THREE tabs, one action each (final shape, decided 2026-07-07 — supersedes the
interim four-tab layout and the "Report → Generate" tab).** Coverage · Scenarios · Drifts.
The rule: an action lives where its OUTPUT lives — Scan on Coverage (produces the corpus),
Generate on Scenarios (produces scenarios), Run on Drifts (produces results). No tab exists
for its own sake. The former Generate/Report tab's content FOLDS INTO Scenarios as a "last
generate" strip above the inventory (envelope when/status/usage/cost, sections
settled/unsettled, authored vs birthPassed, birth findings with view-in-spec, grouped
authoring errors) — expanded when findings/errors exist, collapsed when clean, and a fresh
generate with findings marks the Scenarios tab with the standard dot so findings never bury.
Facts keep one home: gaps/tallies in Coverage, corpus+generation story in Scenarios, execution
in Drifts. UI-TRIGGERED actions (Generate on Scenarios, Run on Drifts) use the pre-flight
estimate modal (identical numbers to the CLI) and the ONE standard progress popup
(SpecProgressPopup pattern; live counters, no bars), reusing the existing scan-job lifecycle
wiring.

**Analytics (decided 2026-07-07 — mirror the house pattern).** OSS: a compact run-trend strip
in the Drifts left panel (pass/fail/stale across recent runs, from guard/history.json) — inline
aside, like VerifyStatsColumn; no dedicated OSS tab. EE (Phase 8): a full Guard analytics tab
(charts/trends/hotspots), capability-gated like `driftanalytics`. Data honesty: run trending
works today (history.json); GENERATE trending (coverage growth over time) needs an append-only
generate-history file — small store addition, spec it when EE analytics is built.

**Coverage ABSORBS the spec surface (decided 2026-07-07 — no separate Spec tab in Guard).**
Guard is SELF-SUFFICIENT: everything spec curation offers must work from the Coverage tab,
REUSING the BL-Drift spec components (props/context flags, never forks) while sharing NO view
state with BL Drift (no cross-module bleed; BL Drift's Spec tab stays exactly as it is).
The merged Coverage tab = the SpecCorpusView sidebar (docs grouped/filtered by area tags,
conflicts list — open AND resolved, resolved visible with change/revoke — skipped docs with
force-include/exclude) + the coverage-banded doc surface (status bands, totals strip, section →
scenario/evidence detail) + conflict resolution in the detail pane (the five-option
SpecOverlapDetail: replace/precedence either direction, keep-both) + the header Scan/Rescan
action with the standard progress popup and lifecycle refresh. Feature checklist for the merge
(nothing lost): doc list+tags, open/resolved conflicts w/ change/revoke, five-option resolve,
force-include/exclude, conflict-heading marks + scroll-to-conflict, Scan action + progress +
staleness refresh, empty/placeholder flows, guard deep links (?guard/?gsec) preserved.

- **Spec doc view becomes the coverage surface**: each section renders with a live status —
  green (guarded, passing), red (failing — drift *here*), amber (stale — section edited since
  generation), grey (untestable, with reason), unmarked (no coverage yet). Click a section →
  its scenarios with last results; rows are previewable (single-click preview, double-click pin),
  per the standard list-row convention.
- **Bidirectional navigation**: from any failing scenario (drifts page, PR view) → jump to the
  highlighted spec section; from a section → its scenarios and evidence transcripts.
- **Guard drifts page**: analyze-style layout, severity-led list of the current run's
  fails/stale/orphaned (no diff view — current state only), detail pane shows the evidence
  transcript.
- **Generate/run from the UI** with the standard step/detail progress panel (no progress bars;
  moving counters are the signal), estimate modal identical numbers to the CLI.
- **The last-generate report is a first-class dashboard surface** (reads `guard/result.json` +
  manifest): sections settled/unsettled, scenarios written, punts with reasons, `blocked-on`
  capability groups, birth findings, and the run's call/token/cost totals — the same summary
  `guard status` prints, so CLI and dashboard never tell different stories.
- **No removals**: the Contracts tab and contract BL-Drift views stay as they are; the guard
  drifts page is a sibling view, not a replacement.

## Rollout phases

- **Phase 0 — format freeze.** Scenario schema v1 + section-anchor spec as Zod in
  `packages/shared`; fixtures: hand-written scenarios against
  `tests/fixtures/sample-project`. STATUS: BUILT (absorbed into Phase 0.5 — the schema and
  fixture corpus landed there; kept as a separate entry only for the plan's history).
- **Phase 0.5 — walking skeleton (dogfood loop).** A vertical slice of Phases 0+1+4 proving the
  whole value loop on TrueCourse's own CLI with zero LLM anywhere: schema v1 + `guard-runner`
  (sandbox, cli driver, normalizers, evidence) + a minimal `guard run` (build once via recipe,
  run scenarios in parallel, print results, write `LATEST.json`) + a hand-written `recipe.json`
  and ~5 scenarios bound by hand (literal anchors/fingerprints) to real
  `docs/SPEC_CONTRACT_VERIFY.md` §9 sections. Explicitly out: section index (Phase 2), all LLM
  stages (Phase 3), `guard status`/`guard drifts`, runs/history files, dashboard. Breaking a
  documented CLI behavior must turn its section's scenario red with an evidence transcript —
  that's the acceptance test. STATUS: BUILT
- **Phase 1 — guard-runner.** Sandbox lifecycle, CLI driver, normalizers, evidence capture,
  result mapping. `guard run` works end-to-end on hand-written scenarios (no LLM anywhere).
  STATUS: BUILT (absorbed into Phase 0.5 and hardened since: hermetic env allowlist,
  interpreter pinning, capabilities, concurrency knob).
- **Phase 2 — section index + manifest.** Deterministic section derivation, fingerprints,
  remap/stale/orphan detection, `scenarios/manifest.json`. STATUS: BUILT
- **Phase 3 — guard-generator.** Testability classification, recipe discovery, scenario
  generation, birth validation, estimate integration; `truecourse guard generate`.
  STATUS: BUILT. Progress-visibility gaps found on the first real runs — resolution:
  (1) per-step model/token/cost usage tags — FIXED (stageUsageTag wired for guard steps);
  (2) "Indexing sections" fake-live counter — FIXED (rendered as an instant done pass);
  (3) atomic birth counter + invisible retry round — FIXED (per-scenario ticks via forwarded
  onScenarioSettled; visible "retrying failed claims R/T" detail);
  (4) written-count mislabeled "passed" — FIXED (birthPassed reported separately);
  (5) per-DOC extraction counter stuck at "0 docs" — FIXED (onExtractViewProgress, counts views);
  (6) FIXED — the birth line leads with the FIXED denominator ("sections 154/208 · birth 95 ·
  retrying 20/21"): `onSectionSettled` ticks settled/total-work (monotonic, never
  fake-completes; unsettled sections honestly end below total), birth is a plain count.
  The governing rule stands: EVERY phase that does real work (LLM calls, sandbox runs, builds)
  renders a live moving counter while it runs — no phase may sit visually complete or idle
  while work continues.
- **Phase 4 — guard store.** `.truecourse/guard/` store (runs / LATEST / history / evidence —
  no diff), `guard status`, `guard drifts`, **and the persisted generate report**:
  `guard/result.json` (gitignored, `contracts/result.json` convention) written at the end of
  every generate — written/settled/punt/birth-finding/error counts, per-section gap reasons,
  call+token+cost totals. Without it the generate numbers exist only in terminal scrollback;
  with it `guard status` (CLI) and the dashboard coverage view render the SAME summary from the
  same store files. STATUS: BUILT — accepted 2026-07-07 on the real dogfood corpus: `guard run`
  wrote runs/ + history + LATEST + evidence (9 pass / 1 fail, non-zero exit), `guard status` and
  `guard drifts` composed the real store. The one fail exposed the sandbox-hermeticity gap below.
- **Phase 4.5 — setup capabilities, `git` first.** The world-state vocabulary (see "Setup
  capabilities" above): capability contract (schema/provider/prompt/coverage) + the `git`
  provider + `blocked-on` gap kind. Unblocks the ~145 git-blocked sections of the dogfood repo.
  Includes the sandbox env allowlist (hermeticity fix — only PATH crosses from the host).
  STATUS: BUILT 2026-07-07 — extract-prompt fingerprint pinned byte-identical (warm extraction
  cache preserved); generate fingerprint shifted by design (author cache re-runs next generate).
- **Phase 5 — dashboard.** Spec section coverage view, guard drifts page, generate/run with
  progress + estimate modal. STATUS: BUILT 2026-07-07, final shape — Guard is a top-level
  section with THREE tabs, one action each: Coverage (spec-as-surface with status bands,
  absorbed spec curation incl. five-option conflict resolution, blocked-on tally chip; Scan),
  Scenarios (recipe card, "last generate" strip with findings/errors + tab dot, inventory with
  filters/preview/evidence; Generate with estimate modal), Drifts (run summary + trend strip,
  severity-led drift list, evidence transcripts, view-in-spec; Run). Server: 9 read routes +
  estimate/generate/run action routes with a per-repo concurrency guard (409); standard
  progress popup + lifecycle refetch; typography normalized to the house scale. Follow-up
  (small): move the pure guard status/drift composition helpers from core into shared so
  client and CLI import one copy (client currently mirrors them).
- **Phase 6 — api driver.** Environment recipe v2 (compose), ephemeral datastores, network-
  boundary fakes, egress control. STATUS: NOT STARTED (post-v1)
- **Phase 7 — tui / web drivers.** PTY tier; Playwright tier. STATUS: NOT STARTED (post-v1)
- **Phase 8 — EE adaptation.** Only after the OSS loop (Phases 0–5) is proven on real repos:
  guard store behind the EE storage adapters (Postgres/blob, repo read-only), PR-scoped guard
  runs (baseline anchored to PR-head, per-PR overlay — same pattern as spec PR-scoping), an
  additive gate check powered by guard runs (the verify-drift signal stays), hosted execution
  tier (warm per-repo snapshots, credential rotation), spec-section coverage in the EE repo
  views. STATUS: NOT STARTED (after OSS v1)

Phases 0–5 are the OSS v1. Phases 6–7 (new drivers) and Phase 8 (EE) are independent tracks
after that — order between them is a call to make when OSS v1 ships.

Contract-surface retirement (CLI commands, dashboard views, EE gate signal migration) is
**deliberately not a phase of this plan** — the contract system keeps running unchanged until
guard has proven itself on real repos, and retirement gets its own plan then.

Dogfood target for Phases 1–5: TrueCourse's own CLI (real specs in `docs/`, real binary), plus
the existing sample-project fixtures for engine tests.

## Risks / open questions

- **Binding fidelity is the product risk** (a green scenario weaker than its section's claim).
  Mitigations: closed verb set (reviewable), title restating the claim, birth validation, the
  Phase-3.5 adversarial fidelity pass. Treat as the make-or-break engineering problem.
- **Section granularity**: heading-level sections may be too coarse (multi-claim sections) or
  too fine (fragile anchors in heading-dense docs). v1 = heading-level; revisit with real specs.
- **Scenario volume / runtime budget**: full `guard run` must stay in the analyze-class time
  envelope locally. Parallel sandboxes + build-once help; if suites grow past that, selection by
  changed sections/code becomes the default and full runs move to the gate.
- **CLIs with unavoidable nondeterminism** beyond the normalizer set (random ids in output,
  locale-dependent formatting) — extend normalizers case-by-case; never add retries.
- **Two verification systems coexist** (contract verify + guard run) until retirement is decided
  — the dashboard and docs must keep the two vocabularies clearly apart so users aren't confused
  about which drift is which.
- **EE workspace contracts** (Knowledge plan) still produce `.tc` — if guard eventually replaces
  contracts, EE needs its own answer (workspace-level scenarios?). Out of scope here.
- **`infer`** stays contract-native. Whether an infer-equivalent exists in the guard world
  (generating scenarios for *undocumented* behavior) is deliberately deferred.
