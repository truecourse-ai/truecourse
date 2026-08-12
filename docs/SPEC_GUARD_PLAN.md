# Spec Guard — Section-Bound Scenario Tests Replace Contract Verify

STATUS: OSS v1 BUILT (Phases 0–5, 2026-07-07) — design agreed 2026-07-03; open work: the
follow-ups and decided-not-built items in the body (stub/http/clock capabilities, the
generate batch-size dial, cross-area overlap dedup, section-level precedence in extraction,
the guard-helpers-to-shared move) and Phases 6–7 (api/tui/web drivers). Phase 8 (EE
adaptation) is IN PROGRESS on `sm/spec-guards-ee` — see its entry below. (Fidelity review
and the scan-staleness signal, once listed here as open, are BUILT — items 33 and 31a. The
OSS AI-SDK transport, also once listed here, is BUILT 2026-07-27 under
`docs/CLI_API_TRANSPORT_PLAN.md`.) This plan adds **generated, spec-section-bound
scenario tests** ("guards") as the new verification artifact, built alongside the existing
contract system. The spec side (scan → curated corpus → areas → decisions) is untouched.

RETIREMENT DECIDED (2026-07-07): the contract surface (`contracts *`, `verify`, `infer`,
dashboard contract/BL-Drift views) is **discontinued** in favor of guard. Step 1 (done): the
BL Drift dashboard section was hidden from the section switcher in both OSS and EE and the
README documented the discontinuation. Step 2 (done 2026-07-13): the verify-drift code, the
four CLI commands, the BL Drift dashboard, and EE's verify-drift gate usage were deleted; the
EE gate ran on verify drifts until this cleanup removed it, and guard's EE phase re-adds
gating on a separate branch. The reusable contract MATCHING ENGINE (extractor + verifier
matching half + in-process generate/infer/curate) is KEPT for that branch — see item 24.

Retirement is strictly gate-CONSUMERS; contract GENERATION code and stores are **dormant,
not dead** — they are the planned **spec→code** half of the linking story. Guard links
spec→test today (a section to the scenarios that guard it); contracts will later link
spec→code, connecting a failed guard scenario to the code that caused it. Nothing that
generates or stores contracts is deleted in any cleanup. The EE PR gate posts **two** Checks:
`TrueCourse / Code Quality` (the `analyzeCore` violations gate — a distinct signal, kept) and
`TrueCourse / Spec Guard` (the guard gate — renamed from `TrueCourse / Guard`, safe because no
clients depend on the old name yet). Guard is the only spec-gating engine; verify never returns.

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
- **library (later)**: the package's programmatic API consumed by importing it from
  user code (`import 'tsx'`, `require('pkg/sub')`, calling exports). Registered as a
  recorded-only driver (2026-07-14): extraction classifies import-by-name claims as
  `library` and their sections surface as "Needs library driver" gaps instead of
  being authored as cli scenarios. When this driver ships, its sandbox must make the
  package-under-test resolvable by name (npm-link semantics — issue #754; a tested
  implementation was built and closed unmerged in PR #755, revive it as the
  execution floor). Open design question: value-level assertions (in-process) vs
  the cli driver's process-level observables.

**The driver contract (how api/web/tui land additively).** The scenario **envelope is frozen** —
`guard`, `id`, `title`, `binds`, `driver`, `setup`, `steps`, `normalize`, and the run-outcome set
never change per driver. A new driver contributes exactly three things: (1) a closed verb
sub-schema keyed by its `driver` value, (2) a runner module (sandbox/environment provisioner +
verb executor + evidence capture + its normalizer additions), and (3) a recipe kind for its
preparation. Nothing else moves: stores, section anchoring, the manifest, the dashboard status
model, and the generate pipeline are driver-agnostic. Testability classification already records
the target driver per section today, so when a driver ships, its sections are
pre-classified and generation targets them with no re-scan — CLI-first was a sequencing choice,
not an architectural one. The api driver (Phase 6 PoC) landed exactly along this contract:
its verb sub-schema (`request`/`capture`/`expect`), its runner module (server boot +
health-wait + HTTP executor + api evidence), and its recipe kind (the `api` block), with the
registry row flipped to runnable and nothing else moving.

## Setup capabilities (world-state vocabulary)

STATUS: BUILT 2026-07-07 (git provider + env allowlist + blocked-on plumbing; the SECOND
provider, `http` — scripted loopback stubs — shipped 2026-07-28, see item 58; first designed
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
`setup.env` ✅ (scenario-global) + step `env` ✅ (per-step overlay — item 49), step `stdin` ✅,
`setup.stub` (one generic feature fakes EVERY executable —
never per-tool code), `setup.http` ✅ (item 58), `setup.clock`. That covers every project from day one;
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
- **Tier 1 — engine primitives**: capabilities built into the runner (git, http ✅; later candidates:
  **`stub` — scripted fake executables on the sandbox PATH** ("a binary named `claude`/`git`/
  `docker` that, on input matching X, prints Y and exits N") — the general answer to "the
  program shells out to something external"; **`http`** ✅ — scripted loopback stub servers,
  BUILT 2026-07-28 (item 58); seeded file DB; fake clock). Still "no Docker, no services". NOTE (2026-07-07, from the first full
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
  EXCEPTION (item 37): an OpenAPI / Swagger doc is sliced into one section per OPERATION —
  anchor `paths/<method>-<slug>`, fingerprint over the canonical (sorted-key, `$ref`-resolved)
  operation slice — via the same `deriveSections`, so generate and run bind identically.
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
  `{ install: "pnpm install --frozen-lockfile", build: "pnpm build", entry: ["node", "dist/index.js"] }`.
  `install` is optional: one shell command run once in the repo root BEFORE every build to fetch
  dependencies — required wherever the tree is a fresh checkout with no `node_modules` (the hosted
  gate/baseline shallow-clones), omitted when the tree needs none. Discovered once (LLM-assisted),
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
    authenticated terminal and failed in a different shell because the entry's
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
- **How it's reused.** The optional `install` and the build each run once per `guard run`
  (install first, then build, both in the repo root under the same hermetic
  `BUILD_PASSTHROUGH`-allowlisted env); every sandbox gets the same built
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
  candidate install/build/entry JSON through the transport; the ENGINE runs the verification
  install + build and the entrypoint probe deterministically, and the user reviews before
  anything is committed. A proposal whose install fails is `verify-failed`
  (``install `cmd` failed: …``) and never written. A rejected proposal buys exactly ONE
  retry: the engine's own verification report goes back verbatim and the replacement is
  verified in full (item 14) — never a second chance beyond that, and never a repair the
  engine invents.

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
5. **Birth concurrency (BUILT).** Both knobs honor `TRUECOURSE_MAX_CONCURRENCY` when set:
   scenario sandboxes default to min(cpus,8) (`defaultRunConcurrency`) and the shared LLM pool
   that extraction, authoring, evidence-retries, and fidelity reviews all draw from defaults to
   min(cpus,4) (`defaultConcurrency`) — an explicit `concurrency` option overrides either.
6. **Cache retry outputs.** Round-1 authoring is cached per claim; retry outputs are NOT — a
   cancel during the retry round loses all retry work (tonight: 231 calls ≈ $58 would have
   evaporated). Cache per claim keyed on (prompt fingerprint, claim, section, retry-evidence
   hash) so stopping is always cheap and resume is exact.
6b. **Retry capability-declaration errors — BUILT 2026-07-08/10: retry-routing half (engine, cache-safe) + the prompt-loudness half (shipped in the item-32 fingerprint batch).**
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
   prompt-loudness half is now BUILT — the "# World-state capabilities" block carries a LOUD
   SEEDING RULE (every `git.commits[].files`/`staged` path must be seeded via `setup.files` or an
   earlier commit) with a wrong/right example; shipped in the item-32 fingerprint batch.
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
10. **Path-aware relevance (BUILT 2026-07-07; prompt wording SUPERSEDED by item 48 —
   the fixture/sample vocabulary was removed as overfit; path remains generic
   evidence).** STATUS: relevance-filter
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
11b. **Relevance filter has no repo self-identity (F12, measured 2026-07-20; EXTENDED by
   item 48 — identity gains the product description, and the verdict attributes the
   subject against it before any content judgment).** STATUS: BUILT —
   `RELEVANCE_SYSTEM_PROMPT` told the model to SKIP docs about "a THIRD-PARTY / external
   system" but `buildRelevanceUserPrompt` sent only path, kind, size and a 60-line preview:
   it never said WHICH repository this is, so the model had to infer "who are we" from the
   document alone. Every decent API reference names its own product, so a repo's own API docs
   read as a vendor's. Measured: calcom/cal.com dropped all 8 `agents/skills/calcom-api/*` —
   its whole v2 API reference — as *"vendor API research (Cal.com's authentication API)"*, the
   sole reason the api driver got zero claims from 462 spec sections in a repo with 82
   documented endpoints; wekan/wekan dropped 117 of 221 docs with vendor reasoning, including
   `docs/API/Custom-Fields.md`, as *"…Wekan (external third-party kanban platform)"*. The
   selectivity is perverse — terse endpoint tables survive because they never name the
   product, so the better a doc reads the likelier it is discarded. `bca7b357` (.mdx
   discovery) raised the stakes: it admits exactly the prose API reference this discarded.
   Fix, four parts: (a) a new `repo-identity.ts` resolves the repo's name + aliases from
   `repoFullName` / git remote / package.json / pyproject / Cargo / composer / go.mod /
   README H1, and renders an IDENTITY block into the USER prompt — per-run DATA, so
   `RELEVANCE_SYSTEM_PROMPT` stays a `const` and the prompt fingerprint moves exactly once;
   (b) the SKIP bullet now DEFINES third-party against that block ("a doc about this
   repository's own product is NEVER third-party"); (c) a structured `category` field on the
   verdict (closed 7-value enum, `.catch(undefined)` so an off-list value can never fail
   `safeParse` into a permanent cache re-spend) instead of regexing the deliberately-varied
   `reason` prose; (d) a deterministic backstop in the final assembly loop — post-cache, so it
   also rescues docs whose wrong verdict is already cached — re-including a `third-party` drop
   whose STRIPPED body (no code fences, no link targets, no JSX tags) names one of our
   aliases. Alias discovery is seed-anchored, never threshold-based: cal.com's own brand is
   23% vs Trello's 9% on wekan, so no cutoff separates them; a corpus term is admitted only
   if its core stem matches a metadata seed. Aliases below 4 chars are never matchable (`cal`
   would match everything) though they may still anchor expansion. Two orthogonal fingerprints
   — `PROMPT_FINGERPRINT` (instructions) and `identityFingerprint` (subject) — so a miss says
   which changed. **Blast radius: a one-time FULL relevance-cache invalidation across every
   repo.** Every cached verdict was produced by the identity-blind prompt, so the 117 wrong
   wekan verdicts *should* miss; it lands on top of `bca7b357`, which already changed the
   discovered doc set. `identity` is required-and-nullable at every cache-key-adjacent
   signature (`planRelevanceWork`, `readRelevanceCache`, `classifyOne`, `RelevanceRunnerInput`)
   — an optional param is exactly how the estimate and the runtime end up keying differently,
   the silent-re-spend class of item 11; `estimateScanTokens` also became include-scope-aware
   so it discovers the same doc set `curate` does. Visibility: `CurateStats` gains
   `thirdPartyDropped` + `thirdPartyRestored` (the CLI docs line shows both) — `restored` is
   the regression detector, expected ~0 once the prompt half works; a nonzero value means the
   net is carrying the fix.
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
   DISCOVERY EVIDENCE-RETRY 2026-07-25 (live: discovery proposed `dist/cli.js`, the build
   wrote `dist/cli.mjs`, verification refused with the dir listing — and then STOPPED,
   leaving a human to hand-write recipe.json): discovery now gets the same ONE evidence
   retry every other guard LLM stage has. The rejected proposal + the verification report
   go back to the model VERBATIM (a `retry` block appended to the recipe USER prompt — the
   system prompt, and so the discovery cache key, is untouched), and the replacement is
   re-verified IN FULL (install → build → entry-file → probe). Generic by construction: the
   engine never inspects the failure, so a dead install, a broken build, a missing entry
   file, and an entry that won't start all travel one path. A retry that yields no valid
   proposal (no transport, thrown call, still-invalid output) surfaces exactly today's
   failure; a verified retry proposal replaces the rejected one under the round-1 cache key
   (the retry gets no key of its own).
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
   SUPERSEDED — flow-keyed generation persists each scenario independently (nothing is
   withheld by a sibling), and item 50 removed the last reason a birth failure could hold
   anything back. The schema + surfaces stay only to render the `result.json` files that
   already carry `heldSections`; generate never writes one.

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

24. **Verify surface retired — now FULLY REMOVED (done 2026-07-13).** STATUS: DONE.
   The verify surface is gone across CLI, OSS dashboard, and EE: the `verify`/`drifts`/
   `contracts`/`infer` CLI commands, the verify-drift core (`contract-verifier` verify.ts +
   comparators + adapter/occurrence, core verify-store + drift-enrichment + verify-snapshot),
   the BL Drift dashboard section, and EE's verify-drift gate usage were all deleted. What
   survives is the reusable MATCHING ENGINE — the `contract-extractor` package and the
   `contract-verifier` extractor/parser/resolver/conformance/infer half — plus the in-process
   `inferInProcess` / `curateInProcess` functions. The contracts ADAPTER layer that served the
   deleted surfaces is gone too (`generateFromCorpusInProcess` + its estimate/model plumbing,
   the `repo.contracts` background job): the engine stays dormant, callable by whatever re-adds
   spec→code linking. No CLI or dashboard exposes it; the guard-EE branch re-adds gating on top.
   The paragraphs below are the historical rationale that led here.

   The contracts/verify pipeline commands (`contracts`, `verify`, `infer`,
   `drifts`) originally stayed REGISTERED and functional — EE's verification gate then rode the
   code — with each printing a one-line deprecation notice on invocation (discontinued in favor
   of `guard`, see README) and hidden from `--help` so new users never discovered them. Outright
   removal was deferred until the EE gate migrated, which is what the 2026-07-13 cleanup did.
   The dashboard analog shipped earlier (BL Drift registry-hidden in both editions,
   URL-reachable for EE Pulls deep links), then the whole section was removed.
   **FINAL (2026-07-13 cleanup): all four command families REMOVED (CLI + dashboard,
   OSS + EE), the reusable ENGINE kept.** Guard fully replaces the verify/drift pipeline,
   so `verify`/`drifts`/`contracts`/`infer` are no longer user commands and the BL Drift
   dashboard section is gone. What remains is the framework-agnostic engine —
   `contract-extractor`, the `contract-verifier` MATCHING ENGINE (code-fact extraction +
   `.tc` parser/resolver + `infer`), and the core in-process functions — kept for
   programmatic / EE use only. The verify-drift half (comparators, verify-store,
   drift-enrichment) was deleted outright.


34. **CLI progress renderer duplicates lines when a status line wraps (live 2026-07-10).**
   The step renderer redraws by cursor-up-per-logical-line; a detail line longer than the
   terminal width wraps to 2+ visual rows, the clear count is short, and every update
   pushes a duplicated stale line upward (screenshot: ~25 copies of "Indexing sections").
   Fix in the renderer: clamp each live status line to the terminal width (ellipsis) so
   one logical line = one visual row (recompute on resize; final/closing lines may print
   full). Never applies to error output.
   STATUS: BUILT — `tools/cli/src/lib/stdout-step-renderer.ts` now clamps every redrawn
   checklist line to `terminalWidth()` (recomputed each paint for resize; ANSI-aware
   `clampToWidth`/`visibleLength` measure visible cols and keep styling). Gated on
   `process.stderr.isTTY`, so piped/non-TTY output is byte-identical to before. Shared by
   guard/spec/contracts/spec-conflicts renderers. Tests: `tests/cli/stdout-step-renderer.test.ts`.

32. **Assertions come from the doc, never the transcript (live failure 2026-07-10; the
   guard-prompt fingerprint batch with 6b + 23).** Grounding transcripts let the model see
   real outputs, and it authored AROUND doc-vs-code disagreements: taskline's two seeded
   drifts (done message, CSV header) were extracted verbatim, then authored as
   effect-only scenarios that never assert the disputed output — 61/61 green, zero
   findings, drift undetected. Root-cause prompt rule in the AUTHORING and RETRY prompts
   (crisp for the model tier): probes/transcripts are for commands and setup ONLY;
   assertions state what the DOC claims, verbatim where the doc quotes output; a scenario
   failing birth because doc and code disagree is a CORRECT outcome (it becomes a
   finding), never something to avoid. No string-matching enforcement (rejected as a
   workaround; placeholders like `t<N>` break it) — the systematic audit is the fidelity
   review (item 33). This batch also carries: 6b's prompt half (seeding constraint LOUD:
   every `git.commits[].files`/`staged` path must appear in `setup.files`) and item 23
   (LLM-dependent commands classify as `blocked-on: llm-provider`, never authored).
   One roll of the extract + generate fingerprints together; stores re-author once.
   STATUS: BUILT — authoring + retry prompts now rule assertions come from the claim (verbatim, placeholders adapted), a doc-vs-code disagreement failing birth is the correct outcome, + a compact worked example; GENERATE fingerprint rolled to 9f3aed7f855e0053.

33. **Fidelity review v1 (was "v1.5"; user go 2026-07-10).** After birth, every GREEN
   scenario gets one adversarial model pass: given the scenario YAML and its section's
   text, does this test actually verify what the section claims — or is it weak, vacuous,
   or testing something else? Flagged scenarios are REJECTED (kind: fidelity; the scenario
   is not persisted, its flow unsettles, evidence = the reviewer's stated mismatch), honest
   ones persist as today. Item 50 made this the ONLY verdict that still withholds a
   scenario — a birth failure now commits — and the exception is deliberate: a rejection
   says the TEST is wrong, which re-authoring can fix, unlike a code disagreement. The
   review still covers the birth PASSES only; a failing test's verdict is already recorded. Cached per
   scenario-content + section-content (cheap re-runs); cheap model tier; its own new
   prompt fingerprint (no existing cache affected). Runs inside generate after birth,
   progress on the birth/validate step's detail. Success criterion on taskline: flags
   nothing among the honest scenarios (no false alarms), while item 32 makes the two
   seeded drifts fail birth outright.
   STATUS: BUILT — new stage `guard.fidelity` (StageId + STAGE_DEFAULTS `sonnet`: a
   focused comprehension JUDGEMENT like `guard.extract`, cheaper than the opus
   authoring tier; haiku under-reasons nuanced faithfulness, the weakness that moved
   `spec.areaTag` off it). Own `FIDELITY_SYSTEM_PROMPT` + `FIDELITY_PROMPT_FINGERPRINT`
   (a14f96711c37aafb) folded into `generationInputsHash` so a prompt edit re-reviews
   every settled section. Review runs INSIDE `settleCliSection` after both birth
   rounds, over `persistedHere` (round-1 passes AND retry survivors), BEFORE persist:
   faithful → stays in the persist set; flagged → a FINDING (`kind: 'fidelity'`,
   evidence = the reviewer's mismatch in `actual`, yaml+claim inline like a birth
   finding) pushed to `localFindings` so the section unsettles and faithful siblings
   drop to `heldSections`; a review that can't complete (re-ask once, then error) is a
   `localError` that unsettles + re-attempts. Cache `guard/fidelity` keyed on scenario
   BEHAVIOR (title/steps/setup/normalize — not the churny engine id/binds) + section
   fingerprint + claim + prompt fingerprint, so re-runs hit. Usage ticks under
   `guard.fidelity` (GUARD_USAGE_STAGES + `validate` step stages + `config llm show`
   label); progress rides the validate line's detail as `· fidelity N`. Estimate adds
   a `guardFidelity` stage (one review per planned cli claim, honest not-cache-aware).
   The optional `kind` on `GuardBirthFindingSchema` is back-compat (absent = birth;
   dashboard/CLI tolerate it). The reviewer spawns UNCONDITIONALLY, on the run's
   materialized transport, exactly like extract/flows/match/generate — nothing may make
   its construction conditional (see the adjudication-stage rule under item 88). Tests
   inject a stub runner; a caller that cannot reach a model loses every call and aborts
   through the adjudication gate rather than skipping the stage. Tests: prompt content +
   pinned fingerprint; flow (faithful persists / flagged →
   finding with kind+evidence, section unsettled, held sibling / retry survivor
   reviewed / cache hit no second call / review error unsettles / NO injected reviewer
   still spawns and reviews / report round-trip); usage totalled under
   `guard.fidelity` + `· fidelity N` on the
   validate detail. Full gate green (1268 tests).

35. **Birth-retry blindness + help-surface probes (findings analysis 2026-07-13, PR 1 of
   2).** Diagnosed on a real expense CLI: the generator authored positional args
   (`add 0.00 test food`) for a tool that takes named flags, so birth failed twice with
   only "expected exit 3 / actual exit 2" as feedback — the retry never saw the program's
   usage error, and probe grounding could never reveal a subcommand's flag signature. Two
   root-cause fixes:
   - **Failure output excerpts.** On EVERY expect-mismatch, `runScenario` attaches the
     failing step's RAW (un-normalized) stdout/stderr, head-truncated to 1200 chars per
     stream (empty streams omitted), to the returned `failure`. New optional
     `stdout`/`stderr` on `GuardFailureDetailSchema` + `GuardBirthFindingSchema` (optional
     ⇒ old snapshots parse, NO format-version bump; a `fidelity` finding has no run so they
     stay absent). `toFinding` copies them; the RETRY authoring prompt renders them as
     indented `program stdout:`/`program stderr:` blocks after `expected:`/`actual:` (the
     evidence its doc-first language already refers to — that language is unchanged); the
     retry cache key folds them so a pre-change cached retry can't shadow the richer re-ask.
     The dashboards (OSS Scenario/Drift/Finding details + the EE Guard lens, which reuses
     them) render a "Program output" section beneath EXPECTED/ACTUAL when present. The local
     `GuardBirthFinding` interface was deleted in favour of the shared type.
   - **Help-surface probes.** `MAX_PROBES_PER_BATCH` 6 → 10; probe derivation split into
     pure `deriveStaticProbes` + `deriveExpansionProbes` (unit-testable, no subprocess),
     composed by a two-phase `groundProbes(exec)`. Always probe a bare `--help`; SALVAGE a
     subcommand prefix from a value-carrying fragment (`` `add 12.50 lunch` `` → `add --help`,
     `` `config set currency EUR` `` → `config set --help`); then EXPAND by scanning the
     bare/`--help` transcripts for subcommand tokens that also appear in the claim texts and
     probing `<token> --help` into leftover slots. Priority under the cap: bare → `--help` →
     subcommand `--help`s → exact fragments. Cache keys unchanged `(recipeFingerprint, argv)`;
     the retry path re-grounds through the same two phases. `GENERATE_SYSTEM_PROMPT`
     unchanged. STATUS: BUILT (PR 1). PR 2 (EE evidence persistence) is a separate change.

36. **EE birth-finding evidence persistence (findings analysis 2026-07-13, PR 2 of 2).**
   The full-transcript layer behind item 35's inline excerpts. In the hosted edition
   `guard generate` runs in an EPHEMERAL job checkout; a birth finding's `evidencePath`
   points into `guard/evidence/<runId>/<scenarioSeg>` inside that checkout, which nothing
   copied out before the checkout was removed — the gate's `persistFailureEvidence` only
   covered real (persisted) runs, and the store couldn't accept birth evidence: a birth run
   is `persist: false`, so it never creates a `guard_runs` row for `writeGuardEvidence` to
   attach to. The dashboard finding-evidence view therefore 404'd (`{"error":"Evidence not
   found."}`). Root-cause fix, three parts:
   - **Store.** New `evidence` jsonb column on `guard_results` (default `{}`, migration
     `0006_zippy_nomad`), the same manifest shape as `guard_runs.evidence`
     (`{ "<scenarioSeg>/<file>": contentSha }`) with bodies in the content pool under scope
     `guard-evidence`. New `writeGuardResultEvidence(ref, scenarioSeg, files)` on the
     `GuardStore` interface merges entries onto the `(repoKey, commitSha)` report row via the
     same atomic jsonb `||` UPDATE runs use (throws when no report row exists). The OSS file
     store no-ops — its birth evidence already sits in the working tree where the reader
     looks. `readGuardEvidenceAt` gains a fallback: ONLY when the runId embedded in the
     evidence path matches no `guard_runs` row (a matching run row is authoritative — a key
     missing there is a miss), it resolves `<scenarioSeg>/<file>` against the repo's
     `guard_results` evidence manifests (newest report holding the key, filtered in SQL via
     `jsonb_exists`).
   - **Write path.** Every ephemeral-checkout generate — onboarding, head-regen, and the
     gate's cold generate — persists via a shared `persistBirthEvidence(store, ref,
     checkoutDir, report)` helper — the `persistFailureEvidence` analogue (both share a
     `collectEvidenceFiles` dir-reader) — that reads each birth finding's evidence dir out of
     the checkout BEFORE cleanup and `putText`s + merges it onto the report row. Head-regen
     and cold generate get it from `persistGeneratedGuardCorpus`; onboarding calls it after
     its own `writeGuardResult`. The worker wiring is unchanged (both jobs use the default
     pipelines).
   - **Read path.** The dashboard `/guard/finding-evidence` route and the finding UI need NO
     change — the fallback slots in beneath the existing `readGuardEvidenceAt` surface.
   STATUS: BUILT (PR 2).

37. **OpenAPI specs as claim inputs (PoC) (2026-07-21).** An OpenAPI / Swagger document
   (yaml or json) is a first-class spec source: each OPERATION (an HTTP method on a path)
   becomes a bindable SECTION that flows through the existing extract → api-author → birth
   pipeline unchanged, and `guard run` stale/orphan detection works on it. Prose docs are
   untouched; this adds a second, STRUCTURAL kind of spec source beside them.
   Design:
   - **Operation-level sections.** `deriveOpenApiSections` (in `@truecourse/shared/openapi`)
     slices the doc's `paths` into one section per `{method, path}`. The section's text is a
     CANONICAL serialization of the RESOLVED operation slice — a stable, sorted-key JSON of
     `{ method, path, operation }` with in-file `$ref`s (`#/…`) dereferenced — so (a) generate
     and run derive byte-identical identity and (b) a cosmetic reformat / key-reorder of the
     source file never churns a fingerprint. The guard runner's `section-index.ts`
     `deriveSections` is the ONE place both the generator (via `extractSectionTexts`) and the
     runner (via `buildDocSectionIndex`) go through, so there is exactly one implementation.
   - **Anchor scheme.** One synthetic level: `paths/<method>-<slug>`, slug preferring
     `operationId` when present else the path — NEVER the raw path (a raw `/users/{id}` would
     mint fake hierarchy levels, and `slugifyHeading` folds `{id}`→`id` so `/users/{id}` and
     `/users/id` collide). Collisions fall to the SAME `-N` disambiguation the markdown path
     uses, so `/users/{id}` and `/users/id` become `paths/get-users-id` and
     `paths/get-users-id-2` — distinct, addressable, order-deterministic.
   - **Deterministic admit.** Discovery sniffs `.yaml/.yml/.json` (bounded head key-check →
     size cap → full parse confirm of a top-level `openapi`/`swagger` key; package.json /
     tsconfig / lockfiles are rejected — no such key) and admits a confirmed doc as
     `kind: 'openapi'`. It SKIPS the prose relevance filter and every prose-only stage (area
     tagging, vocab, overlap): it lands in `corpus.json`'s `docs` with empty `areaTags`
     (`readCorpusAreaTags` degrades to empty). Estimate/runtime symmetry (item 11 class) is
     enforced by the SHARED `planRelevanceWork`/`prefilterDocs` excluding structural docs, so
     `estimateScanTokens` and `filterByRelevance` plan ZERO relevance calls for an OpenAPI doc
     identically — regression-tested.
   - **Extraction chunking.** `planViews` chunks an OpenAPI doc by OPERATION (one view per
     section, outline = the full anchor set as the snapping set), not one giant whole-doc view;
     api claims snap to operation anchors and flow into the existing api authoring batches. NO
     grounding-prompt change — the operation slice IS the section text the api authoring prompt
     already receives, so NO prompt fingerprint rolled (no paid cache invalidated), and NO
     `GUARD_FORMAT_VERSION` bump (new sections are additive).
   Locked decisions: LLM-authored claims via the existing pipeline (no deterministic scenario
   synthesis); structural detection, not the relevance LLM; the operation slice as-is is the
   grounding.
   Deferred: ~~external `$ref` resolution (in-file only)~~ (DONE — item 44 / B6: opt-in
   external-ref inlining for split specs), auth/security schemes (B7), recipe api-block
   auto-suggest, dashboard affordances, and EE PR spec-detect of OpenAPI files (still
   markdown-only).
   STATUS: BUILT 2026-07-21 — module `packages/shared/src/openapi/index.ts`
   (`isOpenApiDoc`/`deriveOpenApiSections`/`canonicalStringify`); guard-runner `deriveSections`
   OpenAPI branch; guard-generator `extract.ts` per-operation views; spec-consolidator
   discovery admit + `isStructuralSpecDoc` + relevance/curate routing; fixture
   `tests/fixtures/guard-fixture-api/openapi.yaml` (honest todos description). Tests: shared
   detection/canonical/deref, section-index anchor scheme + `{id}`-vs-`id` non-collision +
   stale/orphan, discovery admit + relevance skip, estimate symmetry, per-operation view
   planning, and end-to-end generate + run against the fixture server. Full suite green
   (the one failing test is the pre-existing C# Roslyn-host e2e, unrelated).

38. **API-driver credentials — declared, injected, redacted (user-approved design 2026-07-21).**
   The api driver could not author or run any claim behind authentication: the api authoring
   prompt hard-coded "no credentials" and every auth-needing claim died as `blockedOn:
   ["credentials"]`. Phase 1 makes a repo declare named header credentials the runner injects.
   - **Recipe schema.** `RecipeApiSchema.credentials?: Record<name, { header, value? |
     valueFromEnv? }>` (`recipe.ts`). Names are opaque ids (e.g. `api-key`); each carries the
     request `header` it is injected as and EXACTLY ONE source — a literal `value` or a
     `valueFromEnv` env-var name. `resolveApiCredentials(credentials, env)` resolves at run
     start; an env var that is unset OR set-but-blank is a hard `CredentialResolutionError`
     → new run result status `missing-credential-env` (loud stop, never a silent skip — a
     blank secret would inject an empty header and run un-authenticated; the EE gate treats it
     as an `infra` breakage, the CLI aborts and the dashboard tracker marks the build phase
     errored). Secret values never enter the recipe env.
   - **Authoring.** The api authoring USER prompt (`buildAuthorUserPrompt`) advertises the
     declared credential NAMES + their header (never values) and the `{{cred:<name>}}`
     placeholder to write in a header value; undeclared-need claims still emit blockedOn. The
     static `GENERATE_API_SYSTEM_PROMPT` is UNTOUCHED (fingerprint pinned `4cd53145fcb0b7a1`),
     so a credential-less repo's prompt — and its authored output — is byte-identical to before
     and no api section re-plans.
   - **Runner.** `interpolateRequest` resolves `{{cred:<name>}}` in HEADER values in the SAME
     pass as `${var}` (see `resolveHeaderValue`): credential placeholders are located in the raw
     header TEMPLATE first and `${var}` interpolates only the surrounding literal text, so a
     captured value that itself contains `{{cred:…}}` lands as literal text and can never be
     expanded into a secret (bounded injection path closed). Undeclared name →
     `UnknownCredentialError`, surfaced as a scenario `error`, not a pass. `buildCredentialRedactor`
     masks every resolved value — BOTH its raw and its JSON-escaped form (the way a quote/unicode
     secret appears in `invocation.json` / a JSON body) — as `«cred:<name>»` across ALL evidence
     files (single write-boundary in `writeApiEvidence`) and the `GuardScenarioResult.failure`
     excerpts. Birth validation shares the exact run path, so it inherits substitution + redaction.
     Guarantee: the raw and JSON-escaped forms of a resolved secret are masked in evidence and
     failure output (a secret split across a boundary or mangled by a non-JSON escaping is out of
     scope for v1).
   - **Staleness.** Root-cause fix of the fingerprint bug: `computeRecipeFingerprint` now folds
     the recipe file itself (CANONICAL JSON — object keys recursively sorted, so key reordering
     never re-plans — credential `value`s stripped) alongside the package/lockfile/turbo inputs. Because the recipe fingerprint feeds every section's
     `generationInputsHash` AND the per-claim `authorCacheKey`, the DECLARED credential capability
     set (names + headers + env sources) drives re-planning while a rotated secret does not — no
     separate credential fold needed (unified through the fingerprint; see deviation note in the
     handoff). A changed credential NAME/header re-plans previously-blocked sections; a rotated
     value never re-plans and never enters a hash.
   - **Phase 2 — seed stage + fixtures.** `RecipeApiSchema.seed?: { command, provides }`
     (`recipe.ts`). `command` (sh -c, repo root) runs ONCE per run after `services.up` and
     BEFORE the server boots; the runner sets `GUARD_SEED_OUT` to a temp file the command
     writes a manifest JSON to: `{ credentials: { <name>: { value } }, fixtures: { <name>: {
     <field>: <any> } } }`. `provides` is the STATIC declaration — `credentials` (name →
     header + optional role `description`) and `fixtures` (name → the field names it exposes) —
     that authoring advertises and staleness keys on; runtime manifest VALUES are never declared
     here. `runSeed` (`api/seed.ts`) validates the manifest against `provides`: every declared
     credential (non-blank value, else hard stop — same rule as Phase 1) and every declared
     fixture field MUST be present (missing → `SeedError` naming exactly what's gone); extra
     emitted keys/fields are ignored with a logged `console.warn` (invisible to authoring
     anyway). Any failure — non-zero exit, unparseable/missing manifest, a validation gap — is a
     new run result status `seed-failed` (message = command + exit code + stderr tail), a hard
     run stop wired everywhere `missing-credential-env` goes (CLI abort, dashboard tracker build-
     phase error, EE gate `infra` breakage, `runFailureMessage`). A name collision between
     `api.credentials` and `seed.provides.credentials` is a RECIPE VALIDATION error (refused at
     load via a `superRefine`). Seeded credentials merge into the resolved credential map (header
     from `provides`, value from the manifest) and are redacted like any secret; seeded fixtures
     feed a new placeholder. `{{fixture:<name>.<field>}}` is usable in header values, the url path,
     query params, AND the request BODY (fixtures are ids/handles, not secrets — a broader surface
     than header-only `{{cred:}}`); substituted at request time from the manifest, NOT redacted.
     The seed keeps each fixture value in its NATIVE JSON type (a manifest number stays a number);
     substitution is native-when-whole-value (see item 41): a `{{fixture:…}}` that is a WHOLE
     JSON-body leaf lands as its native type, while a fixture spliced into a longer string (path,
     query, header, mixed body) is stringified on demand (numbers → decimal strings).
     Undeclared fixture name/field → scenario `error`
     (like an undeclared credential), never a silent pass. Injection safety reuses the Phase 1
     template-first discipline: `resolveHeaderValue`/`interpolateRequest` now delegate to one
     `resolvePlaceholders` that locates `{{cred:…}}`/`{{fixture:…}}` in the raw TEMPLATE first and
     `${var}`-interpolates only the literal segments, so a captured `${var}` that expands to
     `{{fixture:…}}` lands as literal text (cred stays header-only, fixture everywhere — a kind is
     active only where its map is passed). Authoring: when a seed stage exists,
     `buildAuthorUserPrompt` advertises the fixture CATALOG (names + fields, never values) with the
     `{{fixture:…}}` syntax and the seed-provided credentials alongside the declared ones; the
     prompt is byte-identical when no seed stage exists and `GENERATE_API_SYSTEM_PROMPT` is still
     UNTOUCHED (fingerprint pinned `4cd53145fcb0b7a1`). Staleness is free via Phase 1: `provides`
     (and the seed `command`) live in recipe.json, which the CANONICAL-JSON fingerprint folds — a
     changed fixture catalog or seed command re-plans; runtime manifest values never enter any
     hash. Birth validation shares the run path, so the seed runs before birth probes too
     (covered under `persist: false`). The seed spawns hermetically like the build, draining
     BOTH stdout and stderr (an undrained piped stdout fills the ~64KB OS buffer and hangs the
     seed at the timeout) and merging them into the failure tail. The `seed-failed` message is
     redacted through a redactor built from the recipe-resolved credential values AND any values
     harvested from the (possibly partial) manifest, so a secret the seed echoed before failing
     never rides the tail unmasked (no scenario redactor exists yet at seed time). Manifest
     lookups on parsed JSON use OWN-property checks (never the prototype chain — a declared
     fixture field named `toString` is genuinely required). The seed runs with the SERVER's env
     (`recipe.env` merged with `api.env`, NOT recipe.env-only like `services.up`): the seed
     populates the datastore the server reads, so a `DATABASE_URL` in `api.env` must reach it —
     chosen deliberately because the seed's whole job is preparing state for exactly the process
     that env describes.
   - **Phase 3 — credential roles/descriptions.** `RecipeApiCredentialSchema` (and the seed
     `provides.credentials` entries) gain an optional `description` (min 1) — a short human phrase
     naming the principal/role ("org owner", "regular member", "admin"). `buildAuthorUserPrompt`
     renders it next to the credential name so the author LLM picks the right principal for a
     role-sensitive claim (e.g. "admins list all bookings" vs "members see own"); no description
     renders byte-identically to the Phase 1 line. Multiple role-distinct credentials already work
     (the Phase 1 map). `description` participates in the fingerprint — `hashableRecipeText` strips
     only credential `value`s, so a description change re-plans authoring (the seed-provided
     credentials need no stripping: their values never appear in recipe.json).
   STATUS: Phases 1–3 implemented (this branch, tests-first; awaiting review). New seams:
   `api/seed.ts` (`runSeed`/`SeedError`/`SEED_OUT_ENV`), `resolvePlaceholders`/`UnknownFixtureError`
   in `api/vars.ts`, the `seed-failed` run status, and the `RecipeApiSeedSchema`/`description`
   schema additions. Follow-ups still open: per-scenario role SELECTION ergonomics (today a
   scenario picks a role by writing that credential's `{{cred:<name>}}`) and richer fixture types.

39. **Batched birth validation + shared-state hygiene (user-approved design 2026-07-21).**
   `generateGuards` birthed EVERY section in its OWN runner invocation (a full
   services.up + seed + server-boot + probes + services.down each) — on the cal.com api
   bench that was ~75 sequential boots ≈ 44 of the 50 generate minutes, the probing
   itself only ~2. `birthValidate` already batches a section's candidates into one
   executor call; the waste was purely the PER-SECTION call pattern. `guard run` already
   runs all scenarios against one shared boot, so shared-boot semantics were precedented.
   Four layers land together:
   - **(a) Batch birth across sections.** The per-section serial settle chain
     (`settleChain`/`settleCliSection`) is gone. Authoring stays concurrent; a claim now
     only marks its section errored (unsettled) or ready. After ALL authoring resolves,
     the orchestrator runs six phases over an array of `SectionSettle` records: (1) build
     round-1 candidates per section IN PLAN ORDER — each section frees its OWN prior ids
     first so it reuses its stable `<leaf>.<n>` without stealing a sibling's still-live id
     (the old cross-section id guarantee, now barrier-free); (2) ONE round-1
     `birthValidate` for the pooled candidates; (3) re-author the failing claims
     (concurrent through the shared `p-limit`, evidence-carrying, unchanged retry
     semantics) and ONE retry `birthValidate`; (4) isolated re-confirmation (layer d);
     (5) fidelity review per section; (6) settle — persist + manifest upsert, or
     findings/errors (unsettled) with birth-passers surfaced as `heldSections`. Findings,
     errors, held siblings, birth-passed counts, and the manifest classification all keep
     their per-section attribution (each `BirthCandidate` carries its `section`, so
     outcomes distribute back by section identity). The **deadEntry** guard MOVED from
     inside the per-section settle to ONE check before the round-1 birth: if the built
     entry can't start and the pool has any cli candidate, every section holding a cli
     candidate is marked `skipped` (unsettled, no output) and excluded from the pool while
     api-only sections still birth — the ONE loud entry-preflight error is still recorded
     once. Progress stays truthful: `birthTotal`/`onBirthProgress` accumulate across the
     two pooled rounds; `onRetryProgress` now announces the whole run's failed-claim total
     up front (batched) instead of growing per section; `onSectionSettled` ticks in phase
     6.
   - **(b) `${unique}` scenario variable.** The runner mints one nonce per `runGuard`
     invocation and derives a per-scenario token `scenarioUnique(nonce, id)` (sha256 → 10
     lowercase-hex chars: distinct per scenario in a run, distinct across runs, stable
     across a scenario's steps, filesystem/URL-safe) in `guard-runner/src/unique.ts`. The
     api driver seeds it into the step-vars map (`${unique}` interpolates anywhere `${var}`
     does — path, headers, body); the cli driver (which has no other `${var}` mechanism)
     surgically substitutes `${unique}` in the scenario-authored `run` argv + `stdin` +
     step `env` values (never the recipe-owned entry or `recipe.env`). BOTH drivers also
     resolve it across the scenario-authored SETUP before anything materializes it
     (`applyUniqueSetup` in `unique.ts`): `setup.files` keys AND content, `setup.env`
     values, and the `git` capability's committed/staged path lists — a seeded path must
     resolve to the SAME string the (interpolated) argv and expectations name, or the
     token lands on disk verbatim and every reference to it misses. The authoring USER
     prompt (`buildAuthorUserPrompt`)
     gains an unconditional UNIQUE IDENTIFIERS rule instructing that any resource a
     scenario CREATES with a client-chosen identifier (slug/name/url/email) embed
     `${unique}`. Kept in the USER prompt, so the pinned `GENERATE_API_PROMPT_FINGERPRINT`
     / `GENERATE_PROMPT_FINGERPRINT` (system prompts) are UNTOUCHED and nothing re-plans —
     the trade-off is that existing cached authored scenarios do not retroactively gain
     `${unique}`; only freshly-authored ones do.
   - **(c) Read-before-write ordering.** `orderReadBeforeWrite` (in `run.ts`, applied to
     the `runnable` set so it covers BOTH `guard run` and every batched birth invocation)
     stably partitions read-only api scenarios (every step GET/HEAD) ahead of everything
     else, preserving all other relative order (cli keeps its order, placed after the api
     reads). Fully deterministic (no randomness). It reorders DISPATCH only — scenarios
     still run in parallel up to the concurrency limit — so it is a best-effort mitigation,
     not a barrier (see residual risk).
   - **(d) Isolated re-confirmation of would-be findings — API DRIVER ONLY.** After the
     retry round, every API candidate about to become a birth FINDING (a `fail` outcome —
     never an infra `error`, which skips isolation) is re-run ALONE in a fresh runner
     invocation (fresh services.up + seed + boot; build reused via `skipBuild`). A PASS in
     isolation means the batch failure was shared-state pollution → the candidate is
     treated as birth-passed (kept/persisted via the normal pass path), recorded nothing
     user-facing. A FAIL confirms the finding, and the finding's evidence is the
     CLEAN-ROOM run's, not the polluted batch's. An isolation that itself errors keeps the
     batch finding. CLI would-be findings are NEVER isolated — a cli scenario already runs
     in its own fresh sandbox, so a re-run can never flip and would only burn a boot and
     starve api findings of cap budget; they settle directly with the batch evidence.
     Isolation order (and thus WHICH findings get clean-room evidence at the cap boundary)
     is DETERMINISTIC — sorted by section plan order then scenario id, never by
     LLM/authoring completion order. Surfaced to the CLI as a new `onBirthPhase('confirm',
     N)` phase where N is the ACTUAL number isolated (api-only, capped) — the validate line
     shows `confirming N`. **Cap:** `ISOLATION_CAP = 20` per generate (overridable via the
     `isolationCap` test seam); beyond it the remaining api would-be findings settle as
     findings with the batch evidence — cost scales with failures (the point) but can
     never explode into hundreds of boots. (Future tuning, not in this change: raising the
     default or parallelizing isolation.)
   - **Expectation interpolation (the assertion side).** Root-cause fix found in review:
     expectation matcher VALUES were NEVER interpolated — only `step.request` was — so
     `expect.json {"slug": {equals: "team-${unique}"}}`, a `${var}` captured earlier and
     compared in a LATER step's expect (a PRE-EXISTING bug, cal.com findings [27]/[28]),
     and `{{fixture:<name>.<field>}}` in an expect (cal.com finding [14]) all compared the
     LITERAL template → guaranteed mismatch → survived isolation (same literal) → FALSE
     birth findings. The runner now interpolates expectation matcher values with the SAME
     surface as the request MINUS credentials, per driver: api (`interpolateApiExpect` in
     `api/vars.ts`, applied in `run-api-scenario.ts` right beside `interpolateRequest`,
     same try/catch) resolves `${var}`/`${unique}` and `{{fixture:…}}` in header/body/json
     matcher values (`equals` walks string leaves like a request body); cli
     (`applyUniqueExpect` in `run-scenario.ts`) resolves `${unique}` in stdout/stderr/file
     matcher values AND in the `expect.files` KEYS — the asserted paths, which name a
     resource an interpolated argv created; a verbatim key looks for a literal
     `${unique}` filename and reports every such assertion as missing (found in the
     field: a passing `write` step whose `files: {exists: true}` check failed anyway) —
     (the cli driver has no captures/fixtures). `{{cred:…}}` is EXCLUDED
     from expectations — a secret has no place in an assertion, so it stays LITERAL and
     mismatches loudly (never silently compared). Interpolation runs BEFORE evaluation, so
     the failure/evidence shows the RESOLVED expected value (`team-a1b2c3d4e5`), not the
     template. (Item 41 later made a WHOLE-value `{{fixture:…}}`/`${var}` matcher value
     substitute the native JSON type, so a type-strict `equals` compares `3` to `3` — the
     interpolation seam is unchanged, only the substituted leaf's type.)
   - **Accepted residual risk.** Because ordering (c) only reorders dispatch and scenarios
     still overlap under concurrency, a mutating scenario CAN still pollute a concurrent
     read within one batched boot — a FALSE PASS (a scenario that should fail passing
     because a sibling's write made its assertion hold) is NOT caught by layer d (which
     only re-confirms would-be FAILURES). Layer d catches the opposite (false negatives).
     `${unique}` shrinks the collision surface but does not eliminate cross-scenario state
     coupling. This is consciously accepted for the batching speedup; the stronger fix is
     the deferred hook below.
   - **Explicitly deferred:** an `api.reset` recipe hook (a per-scenario state-reset
     command run between scenarios in a shared boot) that would give true per-scenario
     isolation without a per-scenario boot — OUT of scope for this change.
   STATUS: implemented (awaiting review) — this branch, tests-first. New seams:
   `guard-runner/src/unique.ts` (`newRunNonce`/`scenarioUnique`), `orderReadBeforeWrite`
   + `isReadOnlyScenario` in `run.ts`, the six-phase batched pipeline replacing
   `settleCliSection` in `guard-generator/src/generate.ts`, the `onBirthPhase('confirm')`
   phase, and the `${unique}` authoring rule; plus `interpolateApiExpect` (`api/vars.ts`)
   / `applyUniqueExpect` (`run-scenario.ts`) for the assertion-side interpolation. Tests:
   `tests/guard-runner/{unique,unique-interpolation,ordering,expect-interpolation}.test.ts`
   and `tests/guard-generator/generate-batched.test.ts` (executor-invocation counting
   proves 1 round-1 + 1 retry + K isolation calls; api-only isolation; deterministic cap
   selection; `${unique}`/`${var}`/`{{fixture:…}}` interpolate in expects while
   `{{cred:…}}` stays literal).

40. **API boot concurrency + boot resilience (diagnosed 2026-07-23, user-approved design).**
   Diagnosis `guard-bench/cal.com/DIAGNOSIS-health-timeout.md`: a birth retry round produced
   70 of 72 generate "errors", all the same `api server did not answer GET /health with 2xx
   within 120000ms`. Root cause: the api driver boots ONE full target server PER SCENARIO
   (`run-api-scenario.ts` → `startApiServer`), and `run.ts` fed both drivers through a SINGLE
   `mapWithConcurrency(orderReadBeforeWrite(runnable), concurrency, …)` pool at the CLI
   sandbox width (`TRUECOURSE_MAX_CONCURRENCY=12`). Twelve concurrent ~1.5–2.5GB cal.com v2
   NestJS boots (~24GB peak) starved the host into sub-kill memory/CPU pressure, so every
   server in that one `runGuard` invocation missed the 120s `/health` deadline together — one
   pressure window, a 67-error blast radius. Failed boots also left ZERO server-side evidence:
   `errorFrom` (`generate.ts`) narrowed the failure to `{actual}`, discarding the
   `stdout/stderr` the runner had already attached. Three fixes, tests-first:
   - **(1) Separate api-boot concurrency cap, drawn from ONE shared budget.** New
     `apiBootConcurrency(general)` in `run.ts` — default `min(general, 3)`, overridable via
     `TRUECOURSE_MAX_API_CONCURRENCY` (positive int, CLAMPED down to the general concurrency;
     same discovery pattern as `TRUECOURSE_MAX_CONCURRENCY`). The single mixed pool became
     **TWO pools run concurrently** (`Promise.all`): api scenarios through a pool at the api
     cap, cli through the rest. Chosen over a semaphore because a shared ordered pool with an
     api-boot semaphore would let workers blocked on the semaphore starve cli scenarios behind
     them (`orderReadBeforeWrite` dispatches api reads first) — two pools keep cli unthrottled
     by the api cap. Crucially the two pools SHARE the general budget so their combined
     in-flight count never exceeds `concurrency` (the host-load knob whose breach caused the
     incident): when both drivers run, `apiWidth = min(apiCap, concurrency−1)` and
     `cliWidth = max(1, concurrency−apiWidth)`; a single-driver run is unchanged (api-only ≤
     apiCap, cli-only = full width). Because each api scenario holds its server for its whole
     lifetime (stop is in `finally`), the api pool width bounds RESIDENT servers, not just
     boot-starts — which is what actually bounds memory. `orderReadBeforeWrite` now orders the
     api partition (its guarantee only ever mattered for the api set; cli sandboxes are
     isolated). Results are order-independent (`runGuard` sorts by id).
   - **(2) One retry for a HEALTH-TIMEOUT birth/run boot.** `bootWithRetry` in
     `run-api-scenario.ts` retries exactly once, but ONLY for the transient-pressure class the
     diagnosis identified — a server that came up but missed the `/health` deadline
     (`StartApiServerResult.timedOut`). A DETERMINISTIC failure (spawn error, early exit) or a
     run cancellation surfaces after ONE attempt: a retry would only re-crash and burn boot
     budget. `startApiServer` allocates a FRESH port each call, so the retry never re-collides.
     A recipe/env defect (missing credential env, undeclared fixture) fires BEFORE the boot, so
     it never reaches the retry. The retry is not silent: a double timeout's message reads
     `… (boot failed on both of 2 attempts)`, and a new optional `bootAttempts` field on
     `GuardScenarioResult` (=2 only on a retry) rides every downstream outcome, so a
     success-after-retry is recorded in the persisted result.
   - **(3) Persist a failed error's output excerpts.** `GuardGenerateErrorSchema` (shared) and
     the `GuardGenerateError` interface + `errorFrom` (generate.ts) now carry `stdout/stderr`
     coherent with the error: a boot failure's server output — so `result.json`'s `errors[]`
     shows WHY the server didn't come up — or a step-level infra error's response/server
     excerpts. Redaction is already applied at the runner seam — `run-api-scenario.ts` masks
     the output with `buildCredentialRedactor` and head-truncates to `FAILURE_OUTPUT_LIMIT`
     (1200 chars) BEFORE it reaches `errorFrom` — so no secret leaks and no extra bounding is
     needed; `errorFrom` carries the already-masked, already-bounded text.
   - **DEFERRED (reviewer follow-up, NOT implemented): consecutive-double-timeout circuit
     breaker.** The retry clears a *lone* transient, but a sustained pressure window (the
     actual incident) makes many api scenarios' boots time out on BOTH attempts, one after
     another — the fix bounds peak memory so it should not recur, but if it does the run still
     burns 2× the boot budget per scenario across the whole invocation. The api analog of
     `entry-preflight-failed`: after K api scenarios in one `runGuard` invocation suffer a
     double health-timeout, mark the invocation "boot-dead" and fail the remaining api
     scenarios FAST (one shared reason) instead of each waiting out its own 2× timeout. Why a
     breaker and not just preflight: preflight boots ONCE with recipe env at run start and
     passes when the host is fresh — it cannot catch a LOAD-induced class that only emerges
     mid-run, nor a per-scenario `setup.env`-induced class (preflight never carries scenario
     env). Design intent only; left out of this change to keep the fix focused.
   STATUS: implemented (awaiting review) — this branch, tests-first. New seams:
   `apiBootConcurrency` + shared-budget two-pool dispatch in `run.ts`; `bootWithRetry` +
   `bootAttempts` threading + `timedOut` retry-class discriminant (`api/server.ts`) in
   `api/run-api-scenario.ts`; `bootAttempts` on `GuardScenarioResultSchema` and `stdout/stderr`
   on `GuardGenerateErrorSchema` (shared); the excerpt-carrying `errorFrom`. Fixtures gained
   scenario-scoped boot-failure knobs by class (`TC_FAIL_BOOT` deterministic exit;
   `TC_HEALTH_FAIL`/`TC_HEALTH_FAIL_ONCE` health-timeout) and concurrency instrumentation
   (`/hold` + `hold`). Tests: `tests/guard-runner/run.test.ts` (`apiBootConcurrency`
   default/override/clamp), `tests/guard-runner/api-run.test.ts` (api cap ≤ 3 with cli
   unthrottled AND total ≤ budget; health-timeout retry-passes-noted; health-timeout
   fails-both-names-two-attempts; deterministic early-exit fails after ONE attempt),
   `tests/guard-generator/generate-api.test.ts` (birth error carries the masked boot output).

41. **Native-when-whole-value placeholder interpolation (diagnosed on cal.com bench, user-approved
   design).** `{{fixture:<name>.<field>}}` and `${var}` capture substitutions were ALWAYS strings.
   Two symptom classes: (a) the type-strict json `equals` matcher never matched a JSON number —
   `expected "3"` vs actual `3` → 3 standing FALSE findings; (b) a fixture spliced into a JSON body
   became a quoted string — `"eventTypeId": "3"` → server validation "must be an integer number" →
   body-guess 400s. Fix (tests-first): when a placeholder is the ENTIRE value — a whole
   expect-matcher value or a whole JSON-body LEAF — substitute the NATIVE JSON value: the seed
   manifest's native type for a `{{fixture:…}}`, the captured var's native JSON type for a `${var}`.
   Mixed/concatenated strings (a placeholder embedded in a longer string) stay strings, and every
   non-body surface (url path, query, header values, raw body) is inherently text and unaffected.
   `{{cred:…}}` remains excluded from expects (item 39) and header-only in requests — unchanged.
   Threading: the seed now keeps fixture values NATIVE end-to-end (`SeedResult.fixtures:
   Map<name, Record<field, unknown>>`; `resolveFixture` derives the decimal-string form on demand
   for the mixed-string path via `captureValueToString`), and `run-api-scenario.ts` records a
   parallel `nativeVars: Map<name, unknown>` alongside the string `vars` map at capture time
   (`${unique}` is string-only, so it has no native entry and takes the string path). "Whole value"
   is an EXACT regex match of a single placeholder (`^\{\{fixture:…\}\}$` / `^\$\{name\}$`, no
   surrounding text); a whole `{{fixture:…}}` whose fixture/field is absent falls through to the
   string path so the descriptive `UnknownFixtureError` still fires (never a silent swallow).
   STATUS: implemented (awaiting review) — this branch, tests-first. Seams: `interpolateJson`
   (+ `wholeValuePlaceholder`/`nativeFixture`), `interpolateApiExpect`, `interpolateRequest`
   (`api/vars.ts`, all gaining a `nativeVars` param; fixtures map now native); `SeedResult.fixtures`
   native (`api/seed.ts`); `nativeVars` capture threading (`api/run-api-scenario.ts`); `apiFixtures`
   type in `run.ts`. Tests: `tests/guard-runner/api-native-interpolation.test.ts` (numeric fixture
   in `equals`; numeric fixture as a whole body leaf; boolean/null native in expects and body;
   mixed string stays string; `${var}` numeric/boolean/null capture native in a later expect and
   body); `tests/guard-runner/api-seed.test.ts` updated to assert native fixture values.

42. **OpenAPI request-schema enrichment for markdown write-op claims (B4; diagnosed on the
   A3.1 bench, user-approved design).** A markdown claim carries a behavioral rule as prose
   ("a POST to /v2/bookings with no `start` returns 400") but no structured request body — the
   body's field shape lives only in the OpenAPI document. Symptom: ~13 write-op scenarios born
   from markdown claims sent WRONG request bodies (guessed/invented field names) → spurious 400s.
   A3.1 confirmed OpenAPI-sourced write-op scenarios already birth with correct bodies, so the gap
   is purely the markdown side. Design chose **option (a) cross-source enrichment** over
   **option (b) routing** (drop the markdown claim, hope OpenAPI extraction re-derives it): (a) has
   NO coverage loss — the markdown claim's behavioral rule (a 400 on a missing field) is not what
   OpenAPI extraction produces, so routing would silently drop it; (a) targets the actual failure
   (wrong bodies, not wrong assertions); (a) has a lower identity blast radius — enrichment is
   additive, so unmatched claims stay byte-identical and only sections overlapping a changed
   operation re-plan; and (a)'s only cost is cheap double-guarding of an endpoint vs (b)'s coverage
   hole. Mechanism (deterministic, LLM-free, tests-first): index every OpenAPI operation across the
   doc universe (`buildOperationIndex` over `plan.sections`), match a markdown section's prose
   endpoint references to operations by a CONSERVATIVE method+normalized-path rule (a method token
   is required so a bare path never matches; `{id}`/`:id`/`<id>`/digits/`*` segments fold to `*`;
   an ambiguous reference matching two ops is skipped), and inject the matched write-op
   (POST/PUT/PATCH) `application/json` request schemas into the AUTHOR **USER** prompt only — the
   pinned `GENERATE_API_PROMPT_FINGERPRINT` (system prompt) is untouched, so credential-less /
   schema-less repos see a byte-identical prompt and no section re-plans. Identity: a per-section
   `endpointSchemaFingerprint` (content key over the matched write-op section fingerprints, `''`
   when none) is folded ONLY-WHEN-NON-EMPTY into both the authoring cache key (`authorCacheKey` /
   `retryCacheKey`) and the WORK gate (`generationInputsHash`) — same suppressionFingerprint pattern
   as item 31 — so an unmatched section is byte-identical on every surface, a matched section
   re-authors when the referenced operation's schema changes (the load-bearing fold: without it a
   stale cached body survives a schema edit), and a schema edit re-plans EXACTLY the referencing
   markdown sections. No `GUARD_FORMAT_VERSION` bump (authoring inputs only; scenario schema
   untouched). STATUS: implemented (awaiting review) — this branch, tests-first. Seams:
   `packages/guard-generator/src/openapi-enrich.ts` (new: `parseOperationSection`,
   `buildOperationIndex`, `matchOperationsForSection`, `matchedRequestSchemas`,
   `matchedSchemaFingerprint`); `AuthorUserContext.endpointSchemas` + render in
   `buildAuthorUserPrompt` (`prompts.ts`); `SectionInput.endpointSchemaFingerprint` +
   `generationInputsHash`/`planGuardWork` fold (`section-plan.ts`); `authorCacheKey`/`retryCacheKey`
   fold + `opIndex` threaded through `buildAuthorCtx`/`buildAuthorCtxFor`/`authorRetry`
   (`generate.ts`); shared helper `requestBodyJsonSchema` + exported `HTTP_METHODS`
   (`packages/shared/src/openapi/index.ts`). Tests: `tests/guard-generator/openapi-enrich.test.ts`
   (parse/index/match/fingerprint units incl. param-fold, ambiguity-skip, GET/DELETE no schema),
   `tests/guard-generator/openapi-enrich-wiring.test.ts` (cache-key/inputs-hash byte-identity +
   movement, `planGuardWork` markdown→op enrichment + schema-edit re-plan, `generateGuards` hands
   the schema to the author batch), prompt render + byte-identity in `prompts.test.ts`,
   `requestBodyJsonSchema`/`HTTP_METHODS` in `tests/shared/openapi.test.ts`. Deferred (v1): prose
   paths missing a base path (`/bookings` vs `/v2/bookings`) don't match (exact segments only);
   B5 (response-schema `expect.schema` conformance) is a separate increment.
   FOLLOW-UP (base-path awareness, with B7): the generator-side matcher is now base-path-aware,
   closing the deferred gap above. `buildOperationIndex(sections, basePaths?)` stamps each
   `OperationEntry` with its doc's `servers` base path (`openApiServerBasePath`), and
   `matchOperationsForSection` matches a prose reference against BOTH the bare handler path AND
   the mounted `basePath + path` — markdown is inconsistent (some docs write the full mounted
   `POST /api/v1/x`, others the bare `POST /x`), and matching EITHER strictly increases recall
   while the conservative one-hit ambiguity-skip still guarantees precision (a ref that resolves
   to two ops is skipped, unchanged; a mounted-path collision across ops keeps that skip). A
   base-path-less spec (`basePath === ''`) matches bare-only, byte-identical to before — so
   unmatched sections' fingerprints never move; only sections that NEWLY match a base-pathed op
   re-plan (legitimate). `planGuardWork` builds the `doc → basePath` map once and exposes it on
   `GuardWorkPlan.basePaths` so `generateGuards` reuses the SAME map (plan/generate match
   identically). Follow-up B (authoring): `matchedRequestSchemas` renders the MOUNTED path
   (`basePath + path`) for the write-op list in the author USER prompt, so the model authors a
   request URL that hits the mounted server (`POST /api/v1/todos`, not `/todos`); base-path-less
   ops render their bare path unchanged. USER-prompt only — no fingerprint move. Tests:
   base-pathed/bare/ambiguity/byte-identity in `tests/guard-generator/openapi-enrich.test.ts`,
   end-to-end base-pathed operation path in `openapi-enrich-wiring.test.ts`.

43. **Response-schema conformance assertion (`expect.schema: true`) (B5; user-approved design).**
   B4 fixes what a write-op scenario SENDS; B5 checks what it GETS BACK. Symptom class: a
   handful of hand-picked `json` path matchers can miss RESPONSE drift — a renamed/dropped field
   the operation still declares (a pagination `nextCursor` the server stopped returning), a
   retyped field — because an author only asserts the two or three fields the claim names. A new
   optional `expect.schema: true` (bare boolean on `GuardApiExpectSchema`) asserts the WHOLE
   response body conforms to the JSON response schema the BOUND OpenAPI operation declares for
   that step's `expect.status`. **Decision (b) deterministic runner-side matcher, resolve-at-runtime**
   over **(a) LLM per-field assertions** and over **embedding the schema in the scenario**:
   (b) is variance-free (the runner owns the authoritative schema; an LLM re-deriving per-field
   checks is noisy and can under-assert); RESOLVE-AT-RUNTIME over EMBED because the stale gate
   already guarantees freshness — `binds.fingerprint` covers the operation's canonical text, which
   contains the response schema, so a schema change makes the scenario stale (it never executes
   against a drifted schema it was not authored for), whereas embedding adds file bloat and a
   second staleness surface. Validator: a focused hand-rolled JSON-Schema checker
   (`packages/shared/src/openapi/validate.ts`, no ajv — the operation slice is already
   `$ref`-resolved, we want exact field-path evidence, and the dep stays lean): `required` missing
   is THE drift signal; extra undocumented fields allowed unless `additionalProperties: false`;
   `type` enforced (`integer` requires `Number.isInteger`); 3.0 `nullable`/3.1 `type: [...,'null']`
   null; `enum` membership; `items` per element (`[i]` path); `allOf` all, `anyOf`/`oneOf` at least
   one (oneOf permissive-as-anyOf in v1); FIRST violation returned with its JSON path + expected +
   actual. Runner data flow: `run.ts` builds `doc → anchor → { method, path, operation }` once for
   the OpenAPI docs bound by `schema: true` scenarios (byte-identical flow when none), resolving the
   step's status via exact → `NXX` → `default` then `application/json`/`*+json`
   (`responseJsonSchema`); a new `'schema'` branch in `evaluateApiExpect` (ordered after
   status/headers/body, BEFORE json) validates and yields a `subject: 'schema'` mismatch; a
   `schema: true` step that is UNRESOLVABLE — not bound to an operation, no declared JSON schema for
   the status, or (open-question ii guard) a request whose method+normalized-path differs from the
   bound operation — is a hard scenario `error`, NEVER a silent pass. Validated at BIRTH through the
   same run path, so response drift becomes a birth finding. Authoring: api-only guidance in the
   `buildAuthorUserPrompt` **USER** prompt advises adding `schema: true` on a terminal documented-status
   step (cli byte-identical). No `GUARD_FORMAT_VERSION` bump (additive; precedent items 37/38). Note
   deviation from the design's "fingerprint must not change": the `schema` field flows through the
   shared `GuardApiExpectSchema` into `RawGeneratedApiScenarioSchema`, which the api SYSTEM prompt
   embeds as the authored-scenario JSON schema — so `GENERATE_API_PROMPT_FINGERPRINT` legitimately
   moves (the model must know `schema` is an authorable field), and api sections re-plan once, which
   is the intended path for existing scenarios to gain `schema: true`. STATUS: implemented (awaiting
   review) — this branch, tests-first. Seams: `schema` field on `GuardApiExpectSchema`
   (`packages/shared/src/guard/scenario.ts`); `validateAgainstSchema` + `SchemaViolation` +
   `responseJsonSchema` (`packages/shared/src/openapi/validate.ts`, re-exported from
   `openapi/index.ts`); `'schema'` branch + `responseSchema` param + extended `subject` union
   (`packages/guard-runner/src/api/expect.ts`); `RunApiScenarioContext.responseSchemas` +
   `resolveStepSchema`/`sameEndpoint` guard (`api/run-api-scenario.ts`); operation-schema index build
   + per-scenario resolution (`run.ts`); USER-prompt guidance (`guard-generator/src/prompts.ts`).
   Tests: `tests/shared/openapi-validate.test.ts` (validator + `responseJsonSchema` units),
   `expect.schema` parse in `tests/shared/guard-scenario-api.test.ts`, `'schema'` branch/ordering in
   `tests/guard-runner/api-expect.test.ts`, E2E (conform/drift/unresolvable/multi-op/no-schema-status/birth)
   in `tests/guard-runner/run-schema-conformance.test.ts`, prompt guidance + cli-absence in
   `prompts.test.ts`. Deferred (v1): `oneOf` treated as `anyOf`; no `format` enforcement.
   Endpoint matching (`sameEndpoint`) folds a request path and the bound op's path into comparable
   segments — but the bound op path derives from the bare OpenAPI `paths`-key, so a spec with a
   `servers` base path (`servers: [{url: /api/v1}]`) made every `schema: true` step a birth error
   (bound `GET /todos` vs request `GET /api/v1/todos`, 1 vs 3 segments) — n8n-bench regression, item 43.
   Fixed by reuniting the bound op with the doc's server base path when the schema index is built
   (`buildOperationSchemaIndex` in `run.ts`) via `openApiServerBasePath` (`packages/shared/src/openapi/index.ts`):
   PATH portion only (path-only, full-url, and `{scheme}://host/api/{version}` templated forms — braces
   kept so they fold like path params), trailing slash and `url: "/"`/absent-servers normalize to no-op
   (cal.com-style base-path-less specs unchanged), FIRST server wins on multiples. NOT baked into
   `canonicalText`, so fingerprints stay stable against `servers` edits. Tests: `openApiServerBasePath`
   url-form units in `tests/shared/openapi.test.ts`; base-pathed resolve/validate + still-errors-on-mismatch
   E2E in `tests/guard-runner/run-schema-conformance.test.ts` (fixture server strips `TC_BASE_PATH`).

44. **External `$ref` resolution in OpenAPI ingestion (B6; user-approved design 2026-07-23).**
   Item 37 shipped OpenAPI ingestion resolving ONLY in-file `#/…` pointers; a real split spec
   (n8n: entry `openapi.yml` → ~63 `./handlers/<area>/spec/paths/*.yml` → `../schemas/*.yml` and
   `../../../../shared/spec/{responses,parameters}/*.yml`, with a `shared/spec/schemas/_index.yml`
   aggregator forming an up-then-down ref web; 465 `../` + 130 `./` refs, 234KB bundled) left every
   external ref as a literal `{ $ref }`, so operation slices were near-empty and unauthorable.
   B6 makes external resolution OPT-IN via an injected context, keeping the module browser-safe and
   all-in-file specs byte-identical.
   Design:
   - **Injected `RefResolutionContext`** `{ specPath, repoRoot, readFile }` threaded through
     `deriveOpenApiSections(content, ctx?)` → `deriveSections`/`extractSectionTexts`/
     `buildDocSectionIndex`. `readFile` is INJECTED (node callers wrap `fs.readFileSync`) so
     `packages/shared/src/openapi/index.ts` still imports NO node builtins — all path math is a
     pure POSIX helper (`posixDirname`/`posixJoin`/`posixNormalize`). No ctx ⇒ today's behavior
     (external refs untouched). The single node-side ctx factory is `nodeRefContext(repoRoot, doc)`
     (guard-runner `doc-index.ts`), shared by every caller so generate and run resolve identically.
   - **Pre-pass `inlineExternalRefs` BEFORE the in-file resolver.** Walks the whole doc: an entry
     `#/…` ref is left for the downstream `resolveRefs` (the no-op that guarantees byte-identity); an
     external ref splits `filePart#fragment`, resolves `filePart` against the CURRENT file's dir
     (per-file base tracking), inlines the pointed subtree, and RECURSES with the base switched to the
     target's dir. KEY SUBTLETY: an in-file `#/…` ref appearing INSIDE an external file is resolved
     against THAT file's own root during the pre-pass (the entry resolver would have the wrong root).
   - **Safety + termination.** Network (`scheme://`, `//host`), absolute (`/…`), and escaping
     (normalized target outside `repoRoot`) refs are NEVER read (degrade to literal `{ $ref }`,
     verified by a readFile spy). Missing file / non-object / missing fragment likewise degrade, so a
     split spec with one dangling ref still yields sections. Cycles use a STACK-scoped visited set
     keyed `abs#fragment` (add on descend, remove on return) so a diamond inlines FULLY and only true
     back-edges degrade.
   - **5MB cap on RESOLVED size.** The pre-pass sums `content.length` per distinct file read (entry +
     externals); over `OPENAPI_MAX_BYTES` throws the new exported `OpenApiOversizeError`, which
     `deriveOpenApiSections` catches → `[]`. Discovery's `makeOpenApiCandidate` keeps the cheap
     `stat.size` entry gate and adds a resolved-size probe (`isResolvedOpenApiWithinCap`) at admit
     time — an over-cap split spec is NOT admitted, so the pre-flight estimate and runtime agree
     (item 11 symmetry; both go through `discoverDocs`).
   - **Byte-identity guarantee.** An all-in-file spec's pre-pass is a strict no-op on `#/…` refs, so
     the object handed to `resolveRefs` is structurally identical → `canonicalText` byte-identical →
     fingerprints unchanged → no author-cache invalidation. Pinned by a golden section-text hash.
   Wiring: `deriveSections` OpenAPI branch (`section-index.ts`); ctx built in `doc-index.ts`
   `indexRepoDocs` (the shared binding index both run and generate use), `section-plan.ts`
   `extractSectionTexts` (LLM text matches the index), `run.ts` `buildOperationSchemaIndex` (response
   schemas with external refs resolve for `expect.schema`); discovery admit probe (`discovery.ts`).
   (`collectWorkDocs` only reads RAW content and OpenAPI extraction uses already-resolved section
   `fullText`, so it needs no ctx — a design-listed caller the code showed to be a no-op.) The api
   SYSTEM prompt is UNTOUCHED — `GENERATE_API_PROMPT_FINGERPRINT` stays `3e85ba160e531d1c` (B6 changes
   no authored-scenario schema). Not wired: `@truecourse/core` `guard-read.ts` coverage views (async
   `readRepoDoc`/GitHub seam, display-only) — split-spec dashboard coverage may show whole-doc-relative
   fingerprints until a later increment gives it an async ctx.
   STATUS: implemented (awaiting review) — tests-first. Seams: `RefResolutionContext` +
   `OpenApiOversizeError` + `isResolvedOpenApiWithinCap` + `inlineExternalRefs` pre-pass
   (`packages/shared/src/openapi/index.ts`); ctx params on `deriveSections`/`extractSectionTexts`/
   `buildDocSectionIndex` + `nodeRefContext` (`guard-runner/src/{section-index,doc-index}.ts`);
   section-plan + run wiring; discovery resolved-size gate (`spec-consolidator/src/discovery.ts`).
   Tests: `tests/shared/openapi-external-refs.test.ts` (byte-identity + golden hash, whole-file /
   fragment / YAML / JSON / nested / in-file-inside-external / diamond-cycle / escape-spy / missing /
   order-invariance / bundled-vs-native equivalence / oversize→[] / within-cap / browser-safety
   source assertion), discovery split-spec admission symmetry in
   `tests/spec-consolidator/discovery-openapi.test.ts`, end-to-end ctx wiring in
   `tests/guard-runner/doc-index.test.ts`. Deferred to B7: OpenAPI security schemes → credentials.

45. **OpenAPI security schemes → credential mapping (B7; user-approved design 2026-07-23).**
   An OpenAPI operation declares which security schemes a request must satisfy (`security`,
   resolved against `components.securitySchemes`); the recipe declares which credentials the
   runner can inject (`api.credentials` + the seed's minted ones). Before B7 the two were
   never joined: an api scenario for a secured operation was authored WITHOUT the credential
   header and died un-authenticated at birth, and a scheme no credential could satisfy
   (oauth2) produced a birth failure rather than an honest `blockedOn`. B7 joins them
   DETERMINISTICALLY (zero LLM) and tells the author, per operation, exactly which
   `{{cred:<name>}}` fulfills the required scheme — or that none does, so the claim is
   `blockedOn` the named scheme. HARD CONSTRAINT (met): no change to
   `RawGeneratedApiScenarioSchema` or the api SYSTEM prompt — `GENERATE_API_PROMPT_FINGERPRINT`
   stays `3e85ba160e531d1c`; B7 is recipe schema + USER prompt + the existing envelope-level
   `blockedOn` only (the author already writes `{{cred:…}}` into headers — B7 adds guidance,
   not a new authored field).
   Design:
   - **Recipe**: an optional `satisfies: string` on `RecipeApiCredentialSchema` and
     `RecipeApiSeedCredentialSchema` names the scheme a credential fulfills. Strict-safe
     additive; it flows into `computeRecipeFingerprint` automatically (a `satisfies` change
     IS a capability change → re-plans; a value rotation still does not).
   - **Shared parsing** (`packages/shared/src/openapi/index.ts`, NOT folded into
     `canonicalText` — no churn): `parseSecuritySchemes(doc)` normalizes OA3
     `components.securitySchemes` / Swagger-2 `securityDefinitions` (`$ref`-resolved) to
     `{ type, in?, name?, scheme?, bearerFormat? }`; `effectiveOperationSecurity(doc, operation)`
     flattens the OR-of-AND requirement to scheme-name groups — a per-op `security` overrides
     doc-level, and an EXPLICIT `[]` is PUBLIC (≠ absent, which inherits doc-level).
   - **Generator matching** (new `packages/guard-generator/src/openapi-security.ts`):
     `resolveSectionAuth(section, doc, credentials)` → `{ requiredSchemes, satisfiedBy, unsatisfied }`.
     MATCHING ORDER: a declared `satisfies` is AUTHORITATIVE and overrides the heuristic (it
     also fulfills schemes the heuristic never matches — oauth2/openIdConnect, apiKey-in-query);
     the heuristic fallback is narrow — an `apiKey`-in-`header` scheme is matched by a credential
     whose header equals the scheme's parameter name (case-insensitive), an `http`+`bearer`
     scheme by an `Authorization` credential; oauth2/openIdConnect/`http basic` are NEVER matched
     heuristically. An ambiguous heuristic (several creds match one scheme) advertises them ALL
     and never blocks (a spurious block — a real credential the author cannot use — is worse than
     an extra option). AND-GROUP POLICY (open-question v1 default): a group is satisfied only when
     EVERY scheme in it is matched; the FIRST fully-satisfied OR-group is advertised; when none is
     satisfiable the operation blocks on the CLOSEST group's still-unsatisfied schemes.
   - **Prompt** (USER only): `AuthorUserContext.operationAuth?: { satisfiedBy[], unsatisfied[] }`,
     populated per api batch in `buildAuthorCtxFor` (aggregated across the batch's operation
     sections, deduped), gated non-empty so a public/markdown/cli batch is byte-identical to
     before B7. Renders a satisfied line per `(scheme, credential, header)` ("put `{{cred:X}}` in
     header H") and an unsatisfied line naming the exact scheme with a `blockedOn` instruction.
   - **Fingerprints**: a per-section `securityFingerprint` (content key over
     `effectiveOperationSecurity` groups ⨯ the resolved defs of the REFERENCED schemes) is folded
     append-only-when-non-empty into `generationInputsHash` + `authorCacheKey`/`retryCacheKey`
     (same pattern as items 31/42). Consequences: unsecured sections byte-identical (no global
     re-plan); a secured section re-plans once on rollout and again when a referenced scheme
     DEFINITION changes — a change invisible to `canonicalText` (scheme defs live in
     `components`), which is the load-bearing reason to fold it. Credential mapping is NOT folded
     into `securityFingerprint`: the recipe fingerprint already re-plans EVERY section on any
     credential/`satisfies` change, so folding it there would need the recipe threaded into
     `section-plan` for zero extra re-plan behavior (deliberate deviation from the design's
     "⨯ matching credentials" wording — the design's own consequences already state credential
     changes re-plan via the recipe fingerprint).
   STATUS: implemented (awaiting review) — this branch, tests-first. Seams:
   `satisfies` on both credential schemas (`guard-runner/src/recipe.ts`);
   `parseSecuritySchemes`/`effectiveOperationSecurity` (`shared/src/openapi/index.ts`);
   `resolveSectionAuth`/`securityFingerprintForSection` (new `guard-generator/src/openapi-security.ts`);
   `SectionInput.securityFingerprint` + `generationInputsHash`/`planGuardWork` fold
   (`section-plan.ts`); `AuthorUserContext.operationAuth` + render (`prompts.ts`); `operationAuth`
   population + `authorCacheKey`/`retryCacheKey` fold (`generate.ts`). Tests:
   `tests/shared/openapi-security.test.ts` (parse OA3/Swagger2/$ref + effective-security units),
   `tests/guard-runner/recipe.test.ts` (`satisfies` accept/reject + fingerprint move/rotation),
   `tests/guard-generator/openapi-security.test.ts` (matching: declared-overrides-heuristic,
   apiKey/bearer heuristics, oauth2-only-via-satisfies, ambiguity, AND-groups, OR first-satisfied,
   public, doc-level fallback; securityFingerprint scheme-def sensitivity),
   `tests/guard-generator/openapi-security-wiring.test.ts` (plan re-plan on scheme-def edit, cache
   fold byte-identity, operationAuth handed to the batch), prompt render + byte-identity + pinned
   `3e85ba160e531d1c` in `prompts.test.ts`. Deferred (v1): oauth2/openIdConnect tokens are minted
   only via an explicit `satisfies` (seed-minted oauth2 flows deferred beyond B7); security schemes
   defined in an EXTERNAL `$ref` file resolve only in-file (matching the runner's own in-file scheme
   resolution). Known v1 gap (adversarial review 2026-07-24): MARKDOWN-bound api claims whose
   endpoint maps cross-doc to an OpenAPI operation get item 42's request-schema injection but NOT
   `operationAuth` — `batchOperationAuth` reads only the batch's own doc/sections, so auth guidance
   is absent exactly where schema guidance is present (recall gap only; degrades to pre-B7
   behavior). Fixing it means threading the cross-doc op index (with owning doc) into
   `batchOperationAuth`. Also unvalidated: a `satisfies` naming a nonexistent scheme is silently
   inert (falls to heuristic/blockedOn with no diagnostic) — a load-time warning would help.
   RESOLVED by item 56 (2026-07-28): a `satisfies` matching no scheme in ANY OpenAPI doc of the
   corpus now fails `guard generate` (`recipe-failed`) before the first paid call; a corpus with
   no OpenAPI doc at all warns instead.

46. **Relevance-filter doc-class drops (B8; user-approved design 2026-07-23).** Whole
   DIRECTORY TREES of non-spec markdown were reaching the LLM relevance classifier and
   surviving it — agent-config trees (`agents/skills/**`, `agents/rules/**`), changelogs,
   and template dirs. Post-F12 the classifier correctly keeps anything that names the
   product, so an agent-config tree full of "cal.com does X" docs reads as spec and its
   sections orphan scenarios at generate (the 231+164 untestable-section noise measured on
   cal.com). The classifier CANNOT make this separation — deterministic vs LLM is the whole
   argument: "is this a config/changelog/template TREE" is a structural (path/content) fact,
   not a content-judgment, and the LLM keeping product-naming docs is exactly the behavior we
   want everywhere ELSE. So B8 adds three DETERMINISTIC (zero-LLM, pre-classify) class drops
   to `deterministicSkip`/`prefilterCategory` in `relevance-filter.ts`, reusing existing
   `SkipCategory` values (no schema/prompt change):
   - **(a) Agent-config tree → `agent-meta`**: a dir segment `agents`/`.claude`/`.agent`/
     `.agents` WITH a child in `{rules, skills, commands, prompts}`. **F12 carve-out**
     (load-bearing): exempt `agents/skills/<leaf>/**` when `<leaf>` matches the repo-identity
     alias core (`aliasMatcher`) OR `/(^|[-_])apis?([-_]|$)/i` (calcom-api, public-api,
     v2-api). `agents/rules/**` drops wholesale. The carve-out MUST live in the detector: a
     prefilter drop goes straight to `skipped[]` and NEVER reaches the `namesOurProduct` F12
     backstop (that only fires on LLM `third-party` verdicts). Rationale for the carve-out —
     the repo's own api-skill docs (the 8 `agents/skills/calcom-api/**` on cal.com) are REAL,
     testable references; dropping the tree without exempting them would re-lose exactly what
     F12 rescued. A carved-out skill path SHORT-CIRCUITS every class rule below it (review fix,
     2026-07-24), not just the agent rule — otherwise a kept `agents/skills/calcom-api/news.md`
     would clear the agent rule and then be re-dropped by the changelog stem, and a `templates/`
     subdir under a kept skill by the template rule. The carve-out also strips a markdown
     extension off a single-FILE leaf (`agents/skills/foo-api.md`) before matching.
     Provisional (open question): alias-core + `/api/` is a heuristic (a repo's
     API skill named `scheduling/` would drop wrongly); the `{rules,skills,commands,prompts}`
     child set and the skills-only carve-out are judgment calls.
   - **(b) Pure changelog → `status-tracking`**: STRICT stems `{changelog, release-notes,
     releases}` and the `changelog(s)`/`release-notes` DIRS drop unconditionally by path.
     AMBIGUOUS stems `{news, history, changes}` — which also name legitimate prose (an
     architecture `history.md`, a migration `changes.md`) — drop ONLY when the CONTENT
     fallback also confirms (review fix, 2026-07-24). That fallback (deterministic) fires for
     ANY doc whose non-blank body lines are a strong majority (≥0.6) version-bump entries
     (leading semver or date token), floored at MIN_DEDUP_LINES so a lone `## 1.2.0` heading
     never drops a doc.
   - **(c) Template dir → `process`**: dir segment in `{template, templates, _templates,
     .template, boilerplate, scaffold}`, path-only. (`process` is a semantic stretch; a new
     enum value would move `PROMPT_FINGERPRINT` and invalidate the relevance cache — rejected.)
   All three run before dedup; `manualIncludes` bypasses them automatically (the prefilter
   skips the manual set first). Estimate/runtime symmetry is free: both go through
   `planRelevanceWork` → `prefilterDocs`, which now threads `identity` (needed by the
   carve-out) — a dropped doc costs zero relevance calls in BOTH the run and the pre-flight
   estimate. `RELEVANCE_SYSTEM_PROMPT` is UNCHANGED → `PROMPT_FINGERPRINT` stays
   `c89d79aad411d38f` → no relevance-cache invalidation (dropped docs just stop hitting the
   cache = savings). No corpus schema bump.
   **Bench effect**: a re-scan is REQUIRED but CHEAP (fewer LLM classify calls); a full
   re-generate is REQUIRED and EXPENSIVE (dropped sections orphan their scenarios — the
   costly half). Doc-level only: embedded changelog entries and schema-example-only sections
   INSIDE otherwise-kept docs are OUT of scope (a generate-side testability rule; flagged as
   future). The committed `corpus.json` is stale until a re-scan (note in PR).
   STATUS: implemented (awaiting review) — this branch, tests-first. Seams:
   `deterministicSkip`/`prefilterCategory` + exported `isCarvedOutAgentSkill` predicate +
   `identity`-threaded `prefilterDocs` (`packages/spec-consolidator/src/relevance-filter.ts`);
   export in `index.ts`. Tests: `tests/spec-consolidator/relevance-prefilter.test.ts` — F12
   pin (8 calcom-api kept via both carve-out arms incl. null identity; agent/changelog/
   template droppables skipped with `agent-meta`/`status-tracking`/`process`; none reach the
   runner), manualIncludes bypass, both carve-out arms, `agents/rules` never carved,
   agents-less negative, changelog min-line floor, `isCarvedOutAgentSkill` units, and a
   `PROMPT_FINGERPRINT` pin (`c89d79aad411d38f`). BENCH FOLLOW-UP (design §7, external
   harness — NOT in this repo): assert on the real cal.com corpus that all 8 calcom-api refs
   ∈ `corpus.docs` ∧ ∉ `skippedDocs`, that `skippedDocs` carries `agents/rules/**` + non-API
   skills with the expected categories, and a `docsKept` sanity band.

47. **Flows & Journeys — the generation-unit redesign (user directive 2026-07-24).** Scenarios
   stop being authored directly from spec sections: **flows** (spec-derived only, never
   code-biased — user-goal paths up to epic scale, each binding N sections) become WHAT to
   test, and **journeys** (deterministic code-side interaction paths over the app's surfaces —
   cli/api/web/tui/library/desktop/mobile — generalizing analyze's `detectFlows`/`traceFlows`)
   become HOW. A scenario = one flow realized through one surface's journey path; a web app
   gets the same flow tested through BOTH api and web (deliberate duplication — two user
   contracts). The binding chain becomes `sections ⇄ flow → scenario ← journey`; clicking a
   spec section shows FLOWS, never scenarios. Envelope goes `guard: 2` (plural binds +
   flow/journey refs); drivers/runner/birth/api-work (items 37–45) unchanged underneath.
   Full design, stores (`scenarios/flows.json` committable, `guard/journeys.json` derived),
   stages (`guard.flows`, `guard.match`), the clean v2 cutover (no migration), and the
   surface rollout — cli first,
   then api, then web, then the rest (phases F0–F8):
   **`docs/GUARD_FLOWS_JOURNEYS_PLAN.md`**. STATUS: CLI SLICE BUILT + DOGFOODED (F0–F5,
   2026-07-25/27); API SURFACE (F6 mapper+join) BUILT 2026-07-27 — see the plan doc's
   status header for the as-built decisions (operation-identity journeys, `specOnly`
   cross-check gating, chain-as-enrichment deferred, boot amortization still open).

48. **Relevance judges the SUBJECT before the content (user decision 2026-07-25).** Measured
   two-tier failure on the flows dogfood: the relevance stage kept all 33 realistic
   fixture-product specs under `tests/fixtures/` at haiku AND at sonnet — proving the
   failure was never model tier but framing: asked "is this good spec content?", a model
   keeps any well-written product document and never decides WHOSE product it describes.
   Redesign, fully general (no layout vocabulary, no product names in the prompt):
   - **Product understanding**: `repo-identity.ts` now resolves a bounded `description`
     (package.json/manifest description, else the README tagline — fence-aware; the
     `# Install`-inside-a-code-block H1 bug fixed on the way) into the IDENTITY block and
     `identityFingerprint`.
   - **Subject-first verdict**: the relevance verdict gains `subject:
     'this-product' | 'different-product' | 'unknown'` (off-enum tolerated, never cache
     poison), decided in STEP 1 against the identity block — "Quality is not evidence of
     ownership" — before any STEP 2 content judgment. `applySubjectAttribution` derives
     `different-product` ⇒ drop, normalized to `third-party` so item 11b's deterministic
     alias backstop stays reachable; `unknown` falls through to the content judgment
     (terse docs that name nothing keep exactly as before).
   - **Workaround removed**: item 10's fixture/sample/test-tree prompt wording is DELETED
     (rejected as overfit to this repo); a purity test pins that neither prompt builder
     emits layout or product vocabulary. `PROMPT_FINGERPRINT` rolled once →
     `4d8bcc6788273945` (full relevance re-judge, item 11b precedent). This repo's own
     `.truecourseignore` gained `tests/fixtures/` as REPO DATA — a user preference, not
     part of the engine fix.
   Supersedes item 10's prompt wording; extends item 11b's identity machinery.
   TWO ROOT-CAUSE FIXES RIDE THIS ITEM (found by the live probe when validation refused
   to move): (a) **transport argv injection** — `cliTransport` passed the user prompt as
   a positional argv, so 11b's leading `--- IDENTITY` line made `claude` exit 1 with
   "unknown option" on EVERY relevance call since 11b landed; the prompt now travels
   over STDIN (content can never be an option), regression-pinned in
   `tests/shared/llm-transport.test.ts`. (b) **fail-open is loud** — those crashes were
   swallowed by the keep-on-failure default for four scans (the corpus just looked
   permissive); `RelevanceFilterOutcome.classifyFailed` + `CurateStats.classifyFailed`
   now count them and the scan prints "N docs failed classification — kept by default"
   with the all-N transport hint. The earlier "haiku keeps fixture docs / sonnet keeps
   them too" measurements are RETRACTED — both measured the crash, never a model.
   (c) identity extraction hardened on the measured README shape: fence-aware heading
   scan, and an H1 is a TITLE only when nothing but decoration precedes it (`# Install`
   after a logo+tagline is a section, not a product name); tagline may sit above a
   non-title H1.
   STATUS: BUILT + VALIDATED LIVE (2026-07-25, dogfood corpus, haiku): 29/33 fixture
   docs dropped as different-product, 2 near-dup, 4 name-free docs kept by the designed
   unknown→keep rule (covered by this repo's `.truecourseignore`); 14 real docs now drop
   with correct categories (agent-meta/process/third-party findings reports) — the
   filter's first honest pass; 0 classification failures; verdicts cached for the first
   time on this branch.

49. **Per-step environment variables — the env channel gets a per-step word (user approval
   2026-07-25).** Discovered by the flows dogfood: `manage-telemetry-settings` settled
   `blocked-on` because README promises `truecourse telemetry status` behaves differently
   under three environments, and the authoring model said exactly why — "blocked on per-step
   environment variables … `setup.env` is scenario-global, so any env that realizes
   milestones 4–5 contaminates or falsifies the cli enable/disable milestones 1–3". Nothing
   about that world-state was unavailable; the FORMAT had no words for "this step only".
   The capability contract ("Setup capabilities" above) is met point for point:
   - **Schema** — the cli `run` step gains optional `env: Record<string,string>`
     (`packages/shared/src/guard/scenario.ts`); optional ⇒ existing scenarios stay valid and
     `GUARD_FORMAT_VERSION` stays 2. CLI ONLY: an api step drives a long-running server whose
     env is fixed at boot, so a per-request overlay would be a lie — `GuardApiStepSchema`
     rejects it.
   - **Provider** — the runner layers it LAST and per child: base allowlist → `recipe.env` →
     `setup.env` → `step.env` (`overlayStepEnv` in `packages/guard-runner/src/child-env.ts`,
     applied in `run-scenario.ts`). A fresh object per step, so the overlay dies with its step
     and siblings run against the scenario env verbatim. Hermeticity is inherited, not
     re-implemented — the base is already allowlist-built, so a step can only ADD declared
     names, never re-admit a host var. Interpreter pinning (item 7) is untouched: `entry[0]`
     is resolved absolute at run start, so a step `PATH` edit reaches child lookups (stub
     injection stays possible per step) but never the interpreter under test.
   - **Prompt** — the authored schema is Zod-derived, so the field appeared by itself; one
     semantics line in the cli capabilities block says WHEN to reach for it (the same command
     observed under different environments). The api prompt is untouched.
   - **Coverage** — no new gap kind: the flows that settled `blocked-on: per-step environment
     variables` re-plan through the existing `generationInputsHash` gate.
   - **Evidence** — each step's transcript records its DECLARED overlay (names + values;
     declared test data, never the sandbox env), so a failure shows which world produced it.
   COST (the item-4.5 note, as designed): the prompt edit + the derived schema roll the cli
   GENERATE fingerprint `81604a8d9fa37b2e` → `1d085dd48332778a`, so the next generate
   re-authors cli flows — and that same paid run is what converts the blocked sections.
   `GENERATE_API_PROMPT_FINGERPRINT` is unmoved (`c715637666da9fd7`); api flows re-author for
   the format-version-independent reasons only.
   STATUS: BUILT (2026-07-25) — tests: `tests/shared/guard-scenario-api.test.ts` (round-trip,
   absent = today, api rejects it), `tests/guard-runner/step-env.test.ts` (overlay matrix,
   sibling cleanliness, host-var hermeticity under an overlay, interpreter pinned under a
   step `PATH`, evidence carries the overlay), `tests/guard-generator/step-env.test.ts`
   (authored → birth → commit, and birth really runs the overlay),
   `tests/guard-generator/prompts.test.ts` (re-pin + the fingerprint→hash fold that re-plans).

50. **Guard ALWAYS commits authored tests — green-at-birth is retired (user decision
   2026-07-26).** Birth validation used to be a GATE: a scenario that failed its birth
   execution was discarded and re-surfaced as a "finding", a second species the user had to
   learn, holding its flow unsettled forever (a doc-vs-code disagreement never resolves by
   re-generating, so the same flow re-authored and re-failed every run — the disagreement
   was real). Rationale for the flip: **one entity with a status beats two species.** A test
   that fails at birth is a test; "birth" is just the stage where it failed. The user's
   decision surface is the same one they already have for a run failure — fix the code, edit
   the spec, or dismiss the claim — and it is now reachable the normal way (a committed file,
   a surface row, a scenario id) instead of only through a report array.
   - **Commit rule.** A candidate whose birth execution finally fails — after the SAME one
     evidence-retry as before (retry machinery untouched) — is written to the corpus like any
     other, with `status: 'failing'` on its `scenarios/manifest.json` entry and its birth
     result recorded in `guard/result.json`. The flow SETTLES: `generationInputsHash` is
     stamped, so the next generate is a no-op for it until the spec, the code surface, or the
     journeys move (or the claim is dismissed).
   - **The ONE exception (user-confirmed).** A FIDELITY-rejected scenario is still never
     committed — that verdict says "the test is wrong", not "the code disagrees" — so it stays
     the re-author path and keeps its flow unsettled. Item 33 is unchanged in every other
     respect. Authoring/transport ERRORS also still leave a flow unsettled for self-heal.
   - **Schema.** `GuardScenarioResult` gains `stage: 'birth' | 'run'` (optional; absent reads
     as `run` via `guardResultStage`, so every stored snapshot parses — NO format-version
     bump). `GuardManifestScenario` gains `status: 'passing' | 'failing'` (defaulted, so old
     manifests parse) — the INVENTORY status, so a read paints a red test without
     `result.json`. `GuardWrittenScenario` gains the same optional `status`. The old
     `GuardBirthFinding` is unchanged in shape but is now the failed test's RESULT payload:
     it gains `scenarioId` (closing "findings carry no scenario id"), `committed`, and `file`.
   - **Reads.** A surface row's status is the run outcome when there is one, else the
     committed test's birth status, else `guarded` — so a LATEST run always wins over a stored
     birth status, and a birth-failed test that passes at run simply becomes a passing test.
     This structurally closes the "a failing flow has empty surfaces" hole the flows dogfood
     hit (`handle-pathological-files-without-freezing-analyze`): its test is committed, so the
     flow shows `surfaces: [{cli, scenarioId, status: fail, stage: birth}]`.
   - **Dismissal.** Dismissal keys are unchanged. A dismissed claim's flow re-synthesizes
     without it; when the claim was the whole flow, the flow's committed tests are DELETED
     (intent, like a dismissed flow) instead of carried forward as orphaned drift.
   - **Red-run semantics, acknowledged.** OSS `guard run` totals now include known failures
     from day one, so a fresh corpus can be red — that is the honest state, not a regression.
     The EE PR gate is UNAFFECTED: its verdict is a base-vs-head diff over run outcomes, so a
     test failing on both sides is `preExisting` and never blames the PR (and the moment the
     PR fixes the code it reads as `resolved`).
   - **CLI.** The generate summary speaks tests: `tests N written · M passing · K failing
     (birth)`, with the failing one-liners under a `failing` line and fidelity rejections
     under their own `rejected` line (item-8 discipline: a summary, not a dump).
   STATUS: BUILT (2026-07-26) — engine `packages/guard-generator/src/generate.ts` (failed
   tests persist through the same commit path; only fidelity rejections/errors unsettle a
   flow), reads `packages/core/src/commands/guard-read.ts`, schemas
   `packages/shared/src/guard/{result,report,manifest,dashboard,summary}.ts`, CLI
   `tools/cli/src/commands/guard.ts`. Tests: `tests/guard-generator/generate.test.ts`
   (committed + settled + result recorded + re-generate no-op + dismissal removes the file),
   `generate-api.test.ts`, `generate-batched.test.ts`, `step-env.test.ts`,
   `tests/guard-runner/{run,manifest,store}.test.ts` (a red test executes at run; stage +
   status parsing, old snapshots parse), `tests/server/guard-flows.test.ts` (the empty-surface
   hole, birth failure on the detail row, run overrides birth),
   `tests/shared/guard-dashboard-wire.test.ts`, `tests/cli/guard.test.ts`,
   `tests/github-app/guard-gate.test.ts` (gate diff unaffected).

51. **Authoring ceiling 10 → 15 min, and the call log is written on every run (measured
   2026-07-26).** Two dogfood flows authored over the heaviest plan sections
   (`execution-model-v1-cli-driver`, `guard-run-the-new-verify`) died at EVERY generate with
   `claude timed out after 600000ms` — the wall-clock ceiling, not the stall kill. The
   call-timeout note below already measured why: an identical heavy batch completed in 435s
   with 407s of pre-first-token silence, so the tail is real reasoning and the ceiling was
   cutting live work. Two changes:
   a. **Ceiling → 900_000 for authoring ONLY** (`spawnGenerateRunner`, which serves both
      round-1 authoring and the birth retry). Every other stage keeps its own ceiling —
      extract/flows/flows-epic 600s, match 300s, fidelity/recipe 120s — because none of them
      showed the tail. The STALL timer is unchanged and remains the hang guard: it arms on
      the first stream event and kills a started-then-silent stream in 300s, so a hung proxy
      is still caught fast; only legitimate pre-token silence gets the wider budget.
      `resolveTimeoutScale` still multiplies every stage uniformly, so one env knob widens
      all of them together.
   b. **The per-call log is now written on every run, not only under an env var.** The
      diagnosis above was only possible by re-running by hand, because nothing persisted
      per-call telemetry in a plain CLI run — the sink existed but defaulted OFF outside
      `TRUECOURSE_DEV`. Metrics + summary now write on every guard-generate and spec-scan
      (`.truecourse/logs/llm-<label>-<runId>.jsonl` + `.summary.json`, already gitignored);
      the heavy full prompt/response dump stays opt-in (`TRUECOURSE_LLM_DUMP`, on in dev).
      Opt out with `TRUECOURSE_LLM_LOG=0`. Writing is silent — the stderr summary still
      prints only when logging was asked for explicitly or in dev — and a repo that cannot
      be written to yields no logger instead of a thrown run.
   c. **Records now say WHICH clock fired.** `LlmCallRecord` gained `outcome`
      (`ok`/`timeout`/`stall`/`error`), the `timeoutMs`/`stallTimeoutMs` actually in force
      (post-scale), and liveness — `eventCount` + `msSinceLastEvent`. That is the whole
      diagnostic question in two fields: a ceiling kill with `eventCount: 0` died in
      pre-token silence (widen the ceiling), one with events still arriving was alive and
      streaming when it was killed. Previously both looked like the same error string.
   d. **Seam**: the sink installs in the in-process drivers (`guardGenerateInProcess`,
      `curateInProcess`/corpus-generate), which the CLI *and* the dashboard both route
      through — neither can run untraced, and there is no CLI-only path to keep in sync.
      `guard run` makes no LLM calls, so it has no sink.
   Code: `packages/shared/src/llm/transport.ts` (record fields, per-outcome emit,
   `getLlmCallSink`), `packages/core/src/lib/llm-call-log.ts` (default-on, write-safe),
   `packages/guard-generator/src/runners.ts` (900_000). Tests:
   `tests/shared/llm-transport.test.ts` (ok/timeout-silent/timeout-while-streaming/stall/error
   outcomes, scaled limits recorded), `tests/server/llm-call-log.test.ts` (default-on,
   explicit opt-out, unwritable repo, swallow-on-write-error),
   `tests/guard-generator/runner-timeouts.test.ts` (authoring 900s + override, every other
   stage pinned unchanged), `tests/cli/guard.test.ts` (log written at the driver seam, sink
   cleared on success and on throw). STATUS: BUILT.

52. **An orphaned flow is PRUNED when it has no test, MARKED when it does (user decision
   2026-07-26).** Item 50's carry-forward rule ("a flow synthesis stopped producing keeps its
   manifest entry, so its committed tests never silently vanish") was applied to EVERY
   orphan, including the ones that had nothing to preserve. Measured on the dogfood store:
   126 manifest entries, 93 live flows, **33 orphans — 27 of them carrying ZERO scenarios**
   (and 17 stale gaps between them). Those 27 are ghosts, and a ghost is visible in three
   places at once: a hollow flow page (a slug for a title, no goal, no milestones, no test),
   a bare gap row explaining a missing test for a flow that no longer exists, and a journey
   reference that resolves to nothing. The rule now reads the ENTRY, not the sentiment:
   - **No scenario ⇒ prune.** No flow derives it and no test realizes it, so the entry is
     pure stale bookkeeping: it is dropped at the manifest write and its gaps die with it.
     The check is on the entry, so ghosts CARRIED FORWARD BY EARLIER GENERATES are pruned on
     the next run too — the 27 vanish without a migration.
   - **Has scenarios ⇒ carry forward, marked.** Unchanged item-50 behaviour (entry and files
     untouched, so `guard run` still surfaces them as stale drift) plus one additive field,
     `orphaned: true` on `GuardManifestFlowSchema`. The mark is what makes the state
     explicable instead of merely hollow.
   - **"Orphaned" means absent from SYNTHESIS, not merely absent from this run's works.** A
     flow synthesis still produces but that failed to settle (its sections vanished mid-run,
     so it was skipped with an error) is carried untouched — never marked, never pruned. A
     dismissed flow keeps its own path: deleted with its scenarios, by intent (item 50).
   - **Counts stay honest.** `flows.orphaned` means "orphans whose coverage was kept", so a
     pruned ghost decrements it exactly as a dismissed-away flow does, and a prune makes the
     run `noChanges: false` (it rewrote a committed file).
   - **Reads + UI.** `GuardFlowListItem` and `GuardFlowDetail` carry the flag through the
     wire (additive, `orphaned: true` only when the manifest says so AND no synthesized flow
     carries the id — a flow synthesis produces again is derived, whatever an older entry
     says). Such a flow has no goal and no milestones BY NATURE, so ONE muted sentence takes
     the goal's place in the detail header and in the list row: *"No longer derived from your
     specs — kept because its test still runs."* Its tests render exactly like any other
     flow's (clickable, same status words). "Orphaned" stays an engine word — it never
     reaches a reader, and the vocabulary sweep covers the new state.
   STATUS: BUILT (2026-07-26) — engine `packages/guard-generator/src/generate.ts` (the
   carry-forward loop), schema `packages/shared/src/guard/manifest.ts`, wire
   `packages/shared/src/guard/dashboard.ts`, reads `packages/core/src/commands/guard-read.ts`
   (`flowOrphaned`), UI `apps/dashboard/client/src/components/guard/{GuardFlowDetail,GuardFlowsPanel}.tsx`
   + `lib/guard-flow-status.ts` (`GUARD_UNDERIVED_SENTENCE`). Tests:
   `tests/guard-generator/generate.test.ts` (a ghost pruned with its gaps — both the
   pre-mark and post-mark carry shapes, on a run whose only work is the prune;
   test-carrying orphan kept + flagged; the dismissal paths unchanged),
   `tests/server/guard-flows.test.ts` (flag on list + detail, absent for a flow the corpus
   still carries), `tests/dashboard-client/guard-flows.test.tsx` (the sentence renders in the
   detail header and the list row, absent otherwise, test still clickable),
   `tests/dashboard-client/guard-vocabulary.test.tsx` (the new state swept, and "orphan"
   asserted absent from what a flow shows a reader).

53. **The SETTLE INVARIANT — a settled flow accounts for every surface it planned
   (diagnosed 2026-07-26 on the dogfood store).** Measured: 8 of 99 manifest entries had
   `journeys: [cli]` (a realization plan existed), a `generationInputsHash` (settled ⇒
   skipped by every future generate) and BOTH `scenarios: []` AND `gaps: []` — a permanent,
   silent coverage hole, cache-complete forever, rendering in the UI as a bare "Nothing tests
   this flow yet."
   - **Mechanism (evidence, not suspicion).** All 8 were AUTHOR REFUSALS: the author answered
     `{scenario: null, blockedOn: […]}` and generate recorded the `blocked-on` gap — correctly
     — at the settling run. The gap is produced by the AUTHOR stage, which runs only for
     CHANGED flows; but the manifest entry of an UNCHANGED flow was re-derived from that run's
     `work.gaps`, which only the MATCH stage fills. So the FIRST no-op re-generate erased the
     reason while keeping the hash that skips the flow. Corroboration: the store's author
     cache holds 25 refusals (vscode-extension install, dashboard service/browser, agent-transport
     `--io` mailbox, `spec scan` credentials …) whose subjects map one-to-one onto the 8 flow
     ids, while the manifest after a 93-of-93-skipped run contained `{ unrealizable: 56 }` and
     **zero** `blocked-on` gaps — every author-stage gap in the repo had been erased. Fidelity
     rejection was NOT the cause (it correctly records no hash, item 50's exception).
   - **The invariant.** A flow that records a `generationInputsHash` accounts for each surface
     its `journeys` record a plan for with a committed test XOR a gap — never neither.
     `unaccountedSurfaces()` / `violatesSettleInvariant()` in
     `packages/shared/src/guard/manifest.ts` are the ONE definition; the engine, the pre-flight
     estimate and the tests read it.
   - **Root fix.** An unchanged flow carries forward the prior entry's gaps for the surfaces it
     still PLANS — exactly the gaps authoring would have re-derived had it run. They are merged
     into `work.gaps` before the report is built, so the coverage gap also stops vanishing from
     `result.json` on a no-op run. The manifest (committable) stays the durable record; the
     `.cache` (deletable by design) is never load-bearing for it.
   - **Guard.** Every settle write goes through one function: an entry whose planned surface
     records neither a test nor a gap is written UNSETTLED (`generationInputsHash: null`) with
     a run error naming the flow and the surface — it re-runs next generate instead of settling
     in silence. Post-fix it is unreachable through any pipeline path, which is the point.
   - **Heal, no migration.** Work selection treats a violating entry as WORK, disregarding its
     hash, so the 8 existing holes re-run on the next generate — free, since the authoring
     cache replays the refusal — and settle with their gap restored. The pre-flight estimate
     uses the same predicate, so the count it shows matches the work the run does.
   - **UI.** A flow with genuinely zero surfaces no longer falls through to a bare line: it
     renders the same row every surface gets — "Not generated", then *"No test yet — will be
     attempted on the next generate."* The retry sentence stays for the case it describes (an
     authoring that RAN and failed). One vocabulary module, two sentences, no dead end.
   STATUS: BUILT (2026-07-26) — `packages/shared/src/guard/manifest.ts` (the predicate),
   `packages/guard-generator/src/generate.ts` (carry-forward, heal, settle guard),
   `packages/core/src/services/llm/spec-estimate.ts` (same work selection),
   `apps/dashboard/client/src/lib/guard-flow-status.ts` (`GUARD_NOT_ATTEMPTED_SENTENCE`) +
   `components/guard/GuardFlowDetail.tsx`. Tests:
   `tests/shared/guard-manifest-settle.test.ts` (the XOR semantics),
   `tests/guard-generator/generate.test.ts` (the gap survives a no-op re-run — fails without
   the fix; a violating entry becomes work and heals free; no settled entry ever violates),
   `tests/dashboard-client/guard-flows.test.tsx` + `guard-vocabulary.test.tsx` (the row and its
   sentence, swept).

54. **Recipe autonomy + api-testability program — the phase map (user-approved design
   2026-07-28).** Two measured gaps block guard on a repo that is not this one: (a) recipe
   discovery is JS/TS-and-cli-only, so a Python or C# repo — and ANY api repo — starts with a
   hand-written `recipe.json` or nothing; (b) api scenarios that need a stubbed third party, a
   cookie session, or seeded rows settle `blocked-on` with a reason too vague to act on. Items
   55–61 are the phases. **Locked decisions (apply to every phase below):**
   - The recipe **proposer lives inside `guard-generator`** (beside `recipe-discovery.ts`) — it
     is a generate-stage concern, not a runner or core one; the runner keeps consuming a written
     `recipe.json` and knows nothing about how it was proposed.
   - **`guard recipe --init` is NON-INTERACTIVE.** It writes what it can decide and prints the
     rest as TODOs in the file/output; it never prompts. Agent-drivable, CI-safe.
   - **`setup.http` v1 = scripted responses AND request assertions** (both, not responses only —
     see item 58). BUILT 2026-07-28.
   - A **blocked precondition is an ANNOTATION, never an outcome.** Precedent:
     `journeyDrifted` in `packages/shared/src/guard/result.ts` — deliberately "never an outcome
     and never a pass/fail input". The `GuardScenarioResult` outcome enum is **untouched** by
     this whole program.
   STATUS: **Phase 0 (this record + the README documentation gap) — BUILT 2026-07-28.** The
   docs-only phase: this item + items 55–61, plus README coverage of `api.seed` (previously
   undocumented), the seeded-state survival contract, and the "use the app's own fakes" guidance
   for external dependencies. No engine code. Phases 2–7 (items 56–61) are PLANNED.
   STATUS: **Phase 4 (item 58) — COMPLETE 2026-07-28** — the `setup.http` capability, both
   drivers, with the `speced-api` two-blocked-flows acceptance met against the real app.
   STATUS: **Phase 5 (item 59) — COMPLETE 2026-07-28** — the per-scenario cookie jar,
   `captureHeaders`, and the `fromRequest` credential source. Session-cookie and
   login-then-token apps are runnable without a seed script.
   STATUS: **Phase 1 (item 55) — COMPLETE 2026-07-28** across slices 1a/1b/1c: the `${PORT}`
   placeholder, the api-capable proposal schema + verification, the deterministic multi-language
   proposer, `truecourse guard recipe`, the `preparedSurfaces` fix, and the cross-language
   fixtures — with the `speced-api` acceptance met against the real sample repo.
   STATUS: **Phase 6 (item 60) — COMPLETE 2026-07-28** — the enumerated `missing-data` noun
   (both authoring prompts + the dashboard need row) and the blocked-precondition ANNOTATION on
   both drivers, surfaced in the CLI failure detail and the dashboard test view.
   STATUS: **THE PROGRAM IS COMPLETE THROUGH PHASE 6 — Phases 0–6 (items 55–60) are all
   built.** Phase 7 (item 61) stays DEFERRED by design: it unlocks only on telemetry from the
   phases above, not on a schedule.

55. **Phase 1 — multi-language recipe proposer (JS/TS, Python, C#) (planned, item 54).**
   Deterministic per-ecosystem detectors in `packages/guard-generator` beside
   `recipe-discovery.ts`, producing a `RecipeSignals` intermediate → a proposed recipe. The LLM
   is the FALLBACK, reached only when the deterministic path cannot decide.
   - **install, from the lockfile present**: `npm ci` / `pnpm install --frozen-lockfile` /
     `yarn install --immutable` / `uv sync` / `poetry install` / `pip install -r
     requirements.txt`; .NET restores in-build (no separate install).
   - **build**: `scripts.build` when present, else `dotnet build -c Release`, else the no-op
     `"true"`.
   - **api.serve**: a TOKENIZED `scripts.start` (rejecting dev/watch scripts — a watcher is not
     a server under test), else `uvicorn`/`gunicorn`/`manage.py` inferred from the framework
     dependency, else `dotnet <dll>`.
   - **entry (cli)**: package.json `bin`, `[project.scripts]`, or a console-app csproj.
   - **Runner extension — `${PORT}` placeholder.** The runner already allocates a free port and
     injects it as the `PORT` env var; `uvicorn --port` and `ASPNETCORE_URLS` need it INSIDE an
     argv/env value. Substitute `${PORT}` into `api.serve` argv and `api.env` VALUES at boot.
     Additive; the fingerprint hashes the template (not the resolved port), so a port allocation
     never re-plans.
   - **Schema/prompt/verify.** `RecipeProposalSchema`
     (`packages/guard-generator/src/schemas.ts`) gains an optional `api` — and its `entry` must
     become OPTIONAL when `api` is proposed, mirroring `RecipeSchema`'s "entry and/or api"
     refine (today `entry` is `min(1)` REQUIRED, so an api-only proposal cannot validate).
     `RECIPE_SYSTEM_PROMPT` loses its cli-only wording (its fingerprint rolls).
     `verifyProposal` gains an **api branch**: boot through the runner's `startApiServer`
     (`packages/guard-runner/src/api/server.ts`) + health poll, NOT `probeEntry`'s exit-probe —
     a server never exits, so the probe hangs to its timeout.
   - **Health-path ranking** over the derived route surface: `/healthz` | `/health` | `/readyz` |
     `/ping` | `/`. **`services.up/down`** from the existing docker-compose / DB detection.
     **Credential stubs** from OpenAPI `securitySchemes` (item 45's `satisfies` + a guessed
     `valueFromEnv`, with printed fill-in TODOs — never a fabricated secret).
   - **New `guard recipe` CLI command**: show the recipe + its staleness; `--init` / `--refresh`;
     non-interactive per item 54.
   - **Fix `preparedSurfaces`** (`packages/core/src/services/llm/spec-estimate.ts` ~L638): a
     missing recipe currently returns `['cli']`, so an api repo's pre-flight estimate prices the
     wrong surface.
   - **Acceptance**: byte-equivalent reproduction of the hand-written recipe of the `speced-api`
     sample repo, plus new minimal FastAPI and ASP.NET fixtures under `tests/fixtures/` (the
     dotnet fixture SDK-gated like the Roslyn tests).
   STATUS: **Slice 1a (the groundwork) — BUILT 2026-07-28.** Two pieces, both additive:
   - **`${PORT}` in the runner.** `startApiServer` (`packages/guard-runner/src/api/server.ts`)
     substitutes the literal `${PORT}` with the port it just allocated in every serve-argv
     element and every env VALUE, at spawn time — ONE point, so the run-level preflight, every
     scenario boot, and the generator's verification boot all get it, and neither the recipe
     object nor the caller's env is mutated (each scenario boots the same template on its own
     port). `PORT` is still injected as before. The fingerprint was already template-only
     (`computeRecipeFingerprint` hashes recipe.json's TEXT), so nothing there changed.
     Exported: `substitutePort`, `PORT_PLACEHOLDER`.
   - **Proposal schema + prompt.** `RecipeProposalSchema` gained an optional `api`
     (`RecipeApiProposalSchema` = `serve` + `healthPath?` + `env?` — a strict SUBSET of
     `RecipeApiSchema`; credentials/seed/services are never model-proposed) and `entry` became
     optional under the same "entry and/or api" refine the runner's `RecipeSchema` carries.
     `RECIPE_SYSTEM_PROMPT` now proposes cli, api, or both, and documents the `${PORT}`
     placeholder (its fingerprint rolled, as expected — cached proposals re-ask once).
     `verifyProposal` took the REAL boot check rather than a seam: `guard-generator` already
     depends on `@truecourse/guard-runner`, so it calls the runner's own `preflightApiServer`
     (sandbox + boot + health poll + captured startup output) for the api half, and skips
     `missingEntryScript`/`probeEntry` entirely when there is no `entry` — a server never exits,
     so the probe would have burned its timeout twice and rejected a good recipe. The written
     `recipe.json` carries the api block through verbatim.
   STATUS: **Slice 1b (the deterministic proposer) — BUILT 2026-07-28.**
   `packages/guard-generator/src/recipe-propose.ts`: per-ecosystem detectors → a `RecipeSignals`
   intermediate → a language-agnostic assembly, wired into `discoverRecipe` as a PRE-PASS with
   the LLM path as the fallback. Everything it proposes goes through the same `verifyProposal`
   (install → build → boot/probe) and is written only on success.
   - **Option (b) taken — the deterministic path produces a full `RecipeSchema` object**, not a
     `RecipeProposal`. It can fill fields the model is never allowed to (`api.services`,
     `api.credentials`), and `guard-generator` already depends on `@truecourse/guard-runner`, so
     it validates against the SAME schema the runner loads. `verifyProposal` now takes a
     structural `VerifiableProposal` (the fields verification reads), so both proposal shapes
     verify through one path.
   - **The route surface is an INPUT, not a new analysis pass.** `discoverRecipe` takes an
     optional LAZY `routes` provider; `generateGuards` memoizes its journey mapping and hands it
     over, so a recipe-less repo maps journeys once (just earlier) and a repo that already has a
     recipe never pays for it. `routesFromJourneys` reads `{method, path}` off operation-rooted
     journeys. Health ranking: `/healthz` > `/health` > `/readyz` > `/livez` > `/healthcheck` >
     `/_health` > `/ping` > `/status`, GET only, and ONLY when the surface actually declares it —
     an invented health path would 404 and fail every boot.
   - **No new package dependency edges.** compose parsing uses `js-yaml` (already a
     guard-generator dep) plus a local datastore-image set rather than importing
     `@truecourse/analyzer` (heavy: tree-sitter + pyright) for `parseDockerCompose`; python
     dependency detection reads `pyproject.toml`/`requirements.txt` textually rather than adding
     a TOML parser. Security schemes come from `@truecourse/shared/openapi` (`parseSecuritySchemes`)
     over the corpus's OpenAPI docs, or are injected by the caller.
   - **Failure semantics.** A deterministic proposal that fails verification is NOT retried
     deterministically (the detectors are pure — the same inputs derive the same recipe); its
     diagnostic rides into the model's FIRST call as the existing `RecipeRetryContext`, so the
     fallback opens on what failed. The result carries `source: 'deterministic' | 'llm'` and
     `todos[]` (additive on `GuardRecipeReportSchema` + `GuardGenerateResult.recipe`); `guard
     generate` prints both — non-interactive, per item 54.
   - **Conservative deviations, recorded.** `install` is OMITTED when the manifest declares no
     dependencies (running a package manager to fetch nothing is waste). A build-less repo must
     already HAVE the `bin`/`start` file on disk or the path bails. Python uses `python3 -m
     uvicorn` / `-m flask` rather than the bare console script (it runs wherever the package is
     importable — the same condition the app itself needs) and proposes a cli entry only for a
     single `__main__.py` package (a `[project.scripts]` console script may not be on PATH).
   - ~~**Known limitation.** Verification does NOT run `api.services.up`, so a repo whose server
     cannot boot without its compose datastore fails deterministic verification and falls to the
     LLM (which fails the same way). Deferred with the rest of the services story.~~
     **CLOSED 2026-07-29 — see item 67.** Verification now runs the proposal's `api.services`.
   - Tests: `tests/guard-generator/recipe-propose.test.ts` (58 — every ecosystem, every bail,
     tokenization accept/refuse rows, health ranking, compose services, credential stubs incl.
     the unmappable-scheme TODO, and the `speced-api` shape asserted as an exact object) and the
     deterministic pre-pass block in `tests/guard-generator/recipe-discovery.test.ts` (no model
     call end to end; the boot failure falling through to the model with its evidence).
   Deferred to slice 1c: the `guard recipe` command, the `preparedSurfaces` fix, the
   FastAPI/ASP.NET fixtures, and the `speced-api` acceptance against the real sample repo.
   STATUS: **Slice 1c (the command, the estimate, the acceptance) — BUILT 2026-07-28. Phase 1 is
   complete.**
   - **`truecourse guard recipe`** (`tools/cli/src/commands/guard-recipe.ts`), non-interactive per
     item 54: no flags PRINTS the recipe as the runner loads it (inline credential `value`s masked,
     `valueFromEnv` NAMES shown — a name is a capability, the value is the secret), whether it
     parses (the loader's own `RecipeError` text), and its staleness. `--init` derives one for a
     repo that has none and REFUSES over an existing recipe; `--refresh` re-derives over one.
   - **Refresh semantics — decided.** `--refresh` is not a force-write: discovery already writes
     only a proposal that VERIFIED, so a failed refresh leaves the existing file byte-identical
     (asserted). A successful one prints a unified diff of what it replaced and no `.bak` —
     `recipe.json` is committed, so git is the undo, and the diff is what the terminal owes the
     reader. `discoverRecipe` gained `ignoreExisting` (never set by `guard generate`, which must
     reuse the committed, human-reviewed recipe).
   - **Both halves live in core** (`readGuardRecipeView`, `guardRecipeDiscoverInProcess` in
     `guard-in-process.ts`), so the dashboard inherits them and the CLI stays the thin adapter the
     other guard commands are. Staleness is NOT reimplemented: the view calls the dashboard's own
     `readGuardRecipeCard`, so terminal and Scenarios tab cannot disagree. No dashboard read-path
     work was needed — the card already served it.
   - **`preparedSurfaces` — decided.** A missing recipe now asks the DETERMINISTIC proposer (pure
     over the working tree: no LLM, no analysis pass, no process — free inside an estimate) and
     prices the surfaces it would prepare. The route surface is deliberately NOT supplied: deriving
     it is a full journey-mapping pass and it only ranks the health path, never which surfaces
     exist. When the proposer refuses to decide, the estimate quotes EVERY runnable surface — the
     ceiling convention the realization plan is already priced at, never a shortfall.
   - **A Phase-1 defect the acceptance found, and fixed.** The python serve argvs named the app by
     IMPORT STRING, which python resolves against the process cwd — and the runner boots every
     server in a throwaway sandbox dir, so no FastAPI/Flask repo could ever verify. `resolveEntry`
     now absolutizes a path-ANCHORED directory argument (`.`, `./x`, `a/b` — anchoring is what
     keeps `dotnet build` next to a `build/` dir a subcommand), uvicorn gained `--app-dir .`, and
     flask (which has no `--app-dir`) takes the app as a FILE path (`main.py:app`). Verified
     against a real uvicorn: the fixture boots and answers its health path from the sandbox.
   - **Acceptance — MET.** Run against the REAL `speced-api` sample repo (untouched: the proposer
     is pure, and journey mapping ran on a copy), the deterministic path derives
     `{install: "npm ci", build: "npm run build", api: {serve: ["node","dist/index.js"],
     healthPath: "/healthz"}}` — deep-equal to the hand-written recipe, no LLM call. The only
     difference is `JSON.stringify` array formatting (the hand-written file inlines `serve`).
   - **Fixtures + their gating.** `tests/fixtures/recipe-propose/{speced-api-mini,fastapi-mini,
     aspnet-mini}` are real repos, copied to a temp dir per test so a build never touches the
     checkout. `speced-api-mini` runs END TO END (discovery really builds and really boots it; the
     assertion is the recipe FILE's exact bytes) and is dependency-free so it stays offline-safe —
     which also means it has no `install` (the documented no-deps omission). The FastAPI/ASP.NET
     proposal SHAPES always assert; their boots are `describe.skipIf`-gated on the host toolchain
     (uvicorn importable / the .NET SDK), mirroring the Roslyn-host gating. The model runner throws
     in every fixture test: falling through to the LLM is a regression, and it fails loudly.
   - Tests: `tests/guard-generator/recipe-fixtures.test.ts` (5), `tests/cli/guard-recipe.test.ts`
     (12 — every refusal, the masking, both staleness states, --init/--refresh over the real
     fixture, and the unified-diff helper), plus the estimate's surface-pricing block in
     `tests/guard-generator/estimate.test.ts` and the directory-resolution rows in
     `tests/guard-runner/recipe.test.ts`.

56. **Phase 2 — auth quick wins (planned, item 54).** Two load-time diagnostics on the recipe's
   credential block: (a) a credential's `satisfies` must name a security scheme that EXISTS in
   the repo's OpenAPI `components.securitySchemes` — a typo silently un-maps the scheme today
   (item 45), so it becomes a loud diagnostic / hard error; (b) warn when a credential that
   satisfies a `bearer` scheme carries a value without the `Bearer ` prefix — the single most
   common 401-with-a-correct-token cause.
   STATUS: **BUILT 2026-07-28.** As-built decisions (both diagnostics landed where the
   knowledge they need already lives — neither plumbs anything new between the layers):
   - **(a) `satisfies` validation is a GENERATE-TIME check, and a HARD error.** The runner is
     pure (it never loads the OpenAPI docs), so the check lives where recipe + schemes already
     meet: `validateCredentialSatisfies` (`guard-generator/src/openapi-security.ts`, pure —
     credentials + doc texts in, `{errors, warnings}` out), called from `generateGuards` right
     after `collectWorkDocs` and BEFORE the first (paid) extraction call.
   - **The corpus-wide UNION is the authority.** Schemes resolve per doc, so a credential may
     legitimately satisfy doc A's scheme and not doc B's: an error is raised ONLY when the key
     exists in NO OpenAPI doc of the corpus (partial presence is silent). A corpus with no
     OpenAPI doc at all is a **warning**, never an error — a markdown-only corpus is legitimate.
   - **Channel: the existing `recipe-failed` status.** An unresolvable `satisfies` IS a recipe
     defect, so it rides the channel a discovery failure already uses (`emptyResult(
     'recipe-failed')` → `result.json` `status`/`reason` → the CLI's one loud error + non-zero
     exit; its wording generalized from "Recipe discovery failed" to "Recipe unusable"). The
     advisory case needed a home: `GuardRecipeReport.warnings?: string[]` (optional, so older
     reports parse), printed by the CLI whether the recipe was discovered or already existed.
   - **Shared placement, so `guard recipe` shows the same verdict.** `recipeAuthCredentials`
     moved out of `generate.ts` into `openapi-security.ts` (exported), and
     `corpusOpenApiDocs` (`section-plan.ts`) reads ONLY corpus docs with an OpenAPI extension —
     a markdown-only repo touches no file, which is what keeps it cheap enough for the read
     path. `readGuardRecipeView` carries a `credentialSchemes` verdict the `guard recipe`
     printer renders (as an error line, but the show command still exits 0 — generate is the
     enforcer).
   - **(b) the `Bearer ` check is SHAPE-ONLY, in the runner, and never blocks.** Scheme
     knowledge lives in the generator and plumbing it into the run would buy nothing: the real
     mistake is a raw token in `Authorization`. `credentialShapeWarning` (`guard-runner/src/
     recipe.ts`) warns when an `Authorization` value opens with none of the known auth-scheme
     tokens (the IANA registry + `Token`/`ApiKey`/AWS SigV4), and nudges when the token's CASE
     is non-canonical (RFC 7235 says case-insensitive; real servers often compare literally).
     Any other header is never inspected. Emitted through the runner's existing console-notice
     channel (the `[guard seed]` undeclared-key warning is the precedent) as `[guard
     credentials] …`, from `resolveApiCredentials` AND the seed's `resolveManifest` (a minted
     credential lands in the same header). The message names the credential only — never the
     value — and no new run-result field was invented for it.
   Tests: `tests/guard-generator/openapi-security.test.ts` (the pure validator: silent with no
   `satisfies`, error when the key is in no doc, silent when it's in one of several, all bad
   credentials in one verdict, warning for a corpus with no OpenAPI doc, error — not warning —
   when an OpenAPI doc exists but declares no scheme), `openapi-security-wiring.test.ts`
   (generate returns `recipe-failed` before extraction runs; a valid `satisfies` proceeds; the
   no-OpenAPI corpus warns and still runs), `tests/guard-runner/recipe.test.ts` +
   `api-seed.test.ts` (the shape check: raw value warns without the secret, `Bearer `/`Basic `
   are silent, casing nudge, non-`Authorization` header never inspected, env-sourced and
   seed-minted values checked too).

57. **Phase 3 — external-service detection → honest punts (planned, item 54).** A PURE detector
   over the `FileAnalysis[]` guard generate ALREADY holds (the journey-mapping pass) — no new
   analysis run. It reads `externalLayerPatterns`
   (`packages/analyzer/src/patterns/layer-patterns.ts`) for SDK imports and keeps the
   **per-service identity**, which `layer-detector.ts:234` discards today (the service name
   lands only inside a prose `reasons` string before the function returns). Plus a per-service
   base-URL-env presence check — telemetry for a later proxy decision (item 61), not a behavior.
   Product: detected services are STAMPED into the `blocked-on` gap reason ("blocked on stripe,
   sendgrid: …") instead of a generic one, dashboard `CAPABILITY_NEEDS`
   (`apps/dashboard/client/src/lib/guard-flow-status.ts`, the ordered pattern table ~L260) gains
   external-service / third-party / saas rows, and per-service tallies ride the EXISTING
   `blockedOnCapabilities` breakdown (no new store shape).
   STATUS: **Phase 3 — BUILT 2026-07-28.** Detection + honest reporting only; no mocking, no
   stubbing, no egress control (that is Phase 4 / item 58). **EXTENDED by item 63** — SDK imports
   are no longer the only source of identity: a service reached by a bare HTTP request is detected
   from its URL literals, which is why `category` is now optional and `baseUrlEnv` has a list
   beside it.
   - **Placement — the detector is in `@truecourse/analyzer`**
     (`packages/analyzer/src/external-services.ts`, `detectExternalServices` +
     `usesRawHttpClient`), because the pattern registry it reads lives there.
     `guard-generator` does NOT depend on the analyzer (its deps are guard-runner / llm /
     shared), so the SHAPE lives in `@truecourse/shared`
     (`packages/shared/src/external-services.ts`, `DetectedExternalServiceSchema` — the
     `journeys.ts` precedent) and the VALUE is injected exactly the way slice 1b injects the
     route surface: through the existing `JourneyProvider` seam, whose return grew an optional
     `externalServices`. `mapJourneys` computes it off the `FileAnalysis[]` it already has and
     returns it on `MapJourneysResult` — **one working-tree analysis, two products**, and no
     second seam that could re-analyze.
   - **No early return, no transport.** Every file is matched against every registry category
     (`layer-detector.ts` stops at the first hit — the bug this phase exists to route around),
     and deep imports resolve to their package root (`stripe/lib/Webhooks` → `stripe`,
     `boto3.session` → `boto3`). Generic httpClients are EXCLUDED from the named list — "blocked
     on axios" names nothing — and answered separately by `usesRawHttpClient`. The registry's
     `filePatterns` are ignored for the same reason: a path convention never names WHICH third
     party. `ExternalServiceCategory` therefore has no `http` member (no unproducible variant).
   - **`baseUrlEnv` — partial, deliberately.** There is no env-read extractor and this phase does
     not add one. `FileAnalysis.calls` carries raw source text for callee + arguments, so an
     override passed INTO a call (`new Stripe(key, { apiBase: process.env.STRIPE_API_BASE })`) is
     detected by scanning the call text of the files that import the service, requiring the
     identifier to carry a service token AND URL|URI|BASE|HOST|ENDPOINT. A module-top-level
     `const base = process.env.X` is invisible. Absence means "not seen", never "not
     configurable" — it is telemetry for item 61 and nothing branches on it.
   - **Linkage granularity — REPO-level, and the copy says so.** Per-flow linkage was considered
     and rejected as not computable: a `Journey` carries a command or an operation, never a
     source file (see `JourneySchema`), so there is nothing to intersect a service's evidence
     files against. Claiming per-flow precision would be a fabrication; naming the repo's actual
     dependencies is not.
   - **Enrichment is in the CAPABILITY SEGMENT, not a free-text tail** (`enrichBlockedOn`,
     `packages/guard-generator/src/external-blocked.ts`): `composeBlockedOnReason` is unchanged,
     `parseBlockedOnCapabilities` round-trips, and `blockedOnCapabilities` therefore tallies
     `{stripe: 3}` with zero store or format change. Only the AUTHORING-REFUSAL producer is
     touched; the two driver-unprepared producers are about missing recipe prep and were left
     alone. A noun that already names a detected service is canonicalized (`stripe api` →
     `stripe`, word-boundary only); bare `service` is deliberately NOT treated as generic (a
     sibling microservice is not a SaaS); nothing detected ⇒ the generic noun survives untouched.
   - **Prompt: static rule in the system prompt, per-repo LIST in the user prompt.**
     `GENERATE_API_SYSTEM_PROMPT` gained the "name the service, not a generic noun" rule and its
     `blockedOn` shape hint changed, so **`GENERATE_API_PROMPT_FINGERPRINT` ROLLED
     `c715637666da9fd7` → `f97a8d266ae7e274`** (api sections re-author once; the pin in
     `tests/guard-generator/prompts.test.ts` was updated with the reason). The detected NAMES ride
     `AuthorUserContext.externalServices` (the credentials/fixtures precedent), gated so a repo
     with no third-party SDK renders a byte-identical prompt. KNOWN LIMIT: the authoring cache key
     does not include the detected list, so adding a dependency later does not re-ask a cached
     refusal — accepted rather than invalidating every api cache entry on any dependency change.
   - **Surfaces.** `GuardGenerateResult`/`GuardGenerateReportSchema` gained an additive optional
     `externalServices` (whole list, gaps or no gaps); the dashboard's generate overview renders it
     as a read-only chip row; `CAPABILITY_NEEDS` gained the third-party row ABOVE the
     running-service row (else `external-service` reads as "needs a running service" — the opposite
     triage), and a detected NAME needs no row: the default `needs ${capability}` already says
     "needs stripe".
   - Tests: `tests/analyzer/external-services.test.ts` (7 — multi-service file with no early
     return, httpClients excluded, deep/dotted import roots, per-category mapping, baseUrlEnv
     hit/miss, order stability), `tests/guard-generator/external-services.test.ts` (9 —
     `enrichBlockedOn` units incl. what it must not rewrite, the gap reason + round-trip +
     per-service tally, the report field under the strict schema, api prompt injection and its
     absence on cli), `tests/dashboard-client/guard-flow-status.test.ts` (4 — the ordered
     capability table).

58. **Phase 4 — the `setup.http` capability (planned, item 54).** The fourth capability in the
   closed world-state vocabulary (schema / provider / prompt / coverage, per "Setup
   capabilities"), the api analog of `setup.git`.
   - **Schema**: a `setup.http` block in `packages/shared/src/guard/scenario.ts` — additive and
     optional, so **no `GUARD_FORMAT_VERSION` bump** (item 49's precedent). v1 declares stub
     routes with BOTH scripted responses AND expected-REQUEST assertions (method / path / body
     matchers); a violated request assertion reports as a scenario FAILURE, so "the app called
     the third party wrongly" is a red test, not an invisible pass.
   - **Provider**: `packages/guard-runner/src/capabilities/` beside `git.ts` — a loopback stub
     server started per scenario, its port exposed via a placeholder into `setup.env` so the
     app's base-URL env points at it.
   - **Prompt**: nothing hand-written — the authoring prompt's scenario schema is Zod-derived,
     so the capability advertises itself.
   - **First target**: the `speced-api` sample repo's two blocked flows (unmapped WMO code,
     upstream failure).
   STATUS: **BUILT 2026-07-28.** `setup.http` ships with scripted responses AND request
   assertions, on BOTH drivers, and no `GUARD_FORMAT_VERSION` bump (additive optional).
   - **Schema** (`packages/shared/src/guard/scenario.ts`): `setup.http` is stub NAME → `{routes,
     unmatched}`; a route is `{method, path, status?, headers?, body?|json?, expect?, calls?}`.
     Decisions: **path matching is EXACT on the pathname, plus ONE trailing `*` segment** (a
     query string is never part of the match — `speced-api`'s two upstreams are
     `GET /v1/search` and `GET /v1/forecast` with everything meaningful in the QUERY, which is
     why `expect` gained **`query`** — exact param→value — beside `bodyContains`/`jsonPath`/
     `headers`: without it a GET-only upstream has no assertable request surface at all).
     **`calls` is an EXACT count, not a min/max range**, evaluated at scenario end — the
     interesting assertions are "exactly once" (no retries, WX-060) and **`calls: 0`** ("this
     mode must never call the third party", WX-052/WX-075), and a range expresses neither
     better. **`unmatched` defaults to `error`.**
   - **Provider** (`packages/guard-runner/src/capabilities/http.ts`): one `node:http` server per
     stub on 127.0.0.1:0. It is the registry's first **LIVE** capability rather than a sandbox
     MATERIALIZER like `git`, and that distinction is now documented in `capabilities/index.ts`:
     it must exist BEFORE `createSandbox`, because `${HTTP_STUB:<name>}` is substituted into
     `setup.env` VALUES and that env is what the app reads its base URL from. So it is started
     and stopped by each driver around the scenario body (not dispatched from
     `applyCapabilities`, whose contract is "materialize into the sandbox cwd"). Ordering is
     therefore structural: stubs up → sandbox → server boot.
   - **Failure semantics, as specified.** Boot failure / a `${HTTP_STUB:…}` naming an undeclared
     stub → `CapabilityError` → `error` with `CAPABILITY_SETUP_EXPECTED` (so the generator's
     existing setup-defect retry picks it up). Unmatched-under-`error`, a violated `expect`, and
     a `calls` mismatch → the scenario **FAILS** (`subject: 'stub'`, new in both mismatch unions)
     on the step it happened during, request excerpt included and run through the scenario's
     `buildCredentialRedactor` (an app forwards its auth upstream). Violations are recorded as
     they happen and settled at scenario END: a scenario passes only if steps pass AND zero stub
     violations; a step failure still wins over a stub violation raised in the same step.
   - **Both drivers, one seam.** The cli driver's `setup.env` reaches its child exactly like the
     api driver's reaches the server, so the capability is genuinely driver-agnostic and both
     `runScenario` and `runApiScenario` wire it. `${unique}` now also resolves across the http
     block (route paths, response bodies, and every assertion), so a stub can assert that the app
     forwarded the identifier the scenario itself created.
   - **Prompt.** The Zod schema advertises the capability; the SEMANTICS are prose in
     `GENERATE_API_SYSTEM_PROMPT` (the env-var precondition, the four authoring moves, "an
     unmatched call fails the scenario", and "no base-URL env var ⇒ still `blockedOn`"). The
     Phase-3 detected-services USER block now renders `stripe (base URL env: STRIPE_API_BASE —
     stubable via setup.http)`, so `AuthorUserContext.externalServices` carries
     `{name, baseUrlEnv?}` instead of bare names. **Both fingerprints rolled** (GuardSetupSchema
     is shared by the drivers): `GENERATE_PROMPT_FINGERPRINT` `1d085dd48332778a` →
     `59c2a6fd7e1ac505`, `GENERATE_API_PROMPT_FINGERPRINT` `f97a8d266ae7e274` →
     `8be97dbf1290a228`; both pins updated with the reason.
   - **`speced-api` acceptance — MET, end to end, against the REAL app** (a scratch copy; that
     repo was not modified and no `guard generate` was run). Two hand-written scenarios for its
     two blocked flows both PASS through `runGuard`: the unmapped-WMO one stubs the forecast
     upstream with `weather_code: 4`, asserts the WX-053 query params and `calls: 1`, declares
     the geocoding stub with `calls: 0` (WX-052), and gets `condition: "unknown"` +
     `conditionCode: 4` (WX-041); the upstream-failure one scripts a 503 and gets `502
     upstream_unavailable` with the upstream's status and body absent from the client-facing
     error (WX-056/WX-059/WX-060). Negative controls bite as designed: a wrong `query`
     expectation fails with `query "temperature_unit" was "celsius"`.
   - Tests: `tests/guard-runner/capabilities-http.test.ts` (26 — schema accept/reject rows, path
     matching, boot/serve/teardown, request records, both `unmatched` policies, every `expect`
     kind incl. non-JSON bodies, `calls` incl. `0` and the request-before-count ordering, the
     `${HTTP_STUB:…}` substitution + its undeclared-stub error, `${unique}` across the block) and
     `tests/guard-runner/http-stubs-run.test.ts` (9 — both drivers through `runGuard`: the pass
     path, the stub-up-before-app ordering proof, unmatched → fail + evidence, `unmatched: 404` →
     pass, assertion + count failures, the undeclared-stub `error`, and credential redaction of a
     recorded upstream request). Fixtures gained their outbound half: the api fixture's
     `/upstream` + `TC_UPSTREAM_PING` (a STARTUP call — nothing else can prove the ordering) and
     relkit's `fetch`.

59. **Phase 5 — auth, medium (planned, item 54).** (a) A per-scenario **cookie jar** in the api
   executor, captured from response headers and replayed on subsequent steps — session-cookie
   apps are untestable without it. (b) A **`fromRequest` credential source**: a run-level login
   request executed ONCE after boot whose captured value becomes the credential value —
   replacing the shell `api.seed` for simple apps that only need a token.
   STATUS: **BUILT 2026-07-28.** Both halves, plus `captureHeaders` (the header-side sibling
   of `capture`, which the jar work made obviously missing).
   - **The jar** (`packages/guard-runner/src/api/cookies.ts`, ~150 lines, no dependency). ONE
     per scenario run, created in `runApiScenario` beside the scenario's own server and
     discarded with it — never shared, so a sibling scenario's login can never authenticate
     this one (a shared jar would make outcomes order-dependent). The executor attaches the
     matching cookies as `Cookie` and folds the response's `Set-Cookie` back in;
     `Headers.getSetCookie()` (Node ≥ 19.7; this repo runs 22/24) is the only accessor that
     keeps repeated `Set-Cookie` headers apart — a joined header cannot be split, because
     `Expires` carries commas.
     - Honored: name/value verbatim, `Path` (defaulting to RFC 6265 §5.1.4 default-path,
       matched on segment boundaries, longest-path-first on send), `Max-Age` and `Expires`
       (Max-Age wins per §5.3), and the delete idiom (non-positive Max-Age / past Expires).
     - **`Secure` is deliberately IGNORED** — the server under test is loopback http, so
       honoring it would drop every cookie a production-configured app sets and break exactly
       the flows this exists for. Same-origin loopback, no eavesdropper. `HttpOnly` is a
       browser-DOM concept and `SameSite` a navigation one — both stored/sent normally.
       `Domain` is ignored: one scenario talks to one origin, so no public-suffix question.
     - **Precedence**: a step writing its own `Cookie` header wins for that request (explicit
       beats implicit); the jar still observes that response. Documented in the prompt.
     - **No schema field enables it** — it is automatic, like a browser. Behavior of EXISTING
       scenarios changes only for apps whose server sets cookies, and only toward being more
       browser-like; accepted as a strictly better default.
     - **Redaction — a recorded known limit, no new machinery.** Cookie values are app session
       tokens, not recipe credentials, so the credential redactor does not mask them. It does
       not have to today: `ApiEvidenceStep` records request headers, status, and bodies — NOT
       response headers — so a `Set-Cookie` never reaches evidence on its own. A session token
       an app echoes into a response BODY would land unredacted; v1 accepts that (the same is
       already true of any app-minted id) rather than building a second redactor.
   - **`captureHeaders`** — a SIBLING field on `GuardApiStepSchema`, not a value-syntax
     overload of `capture` (`"header:x-token"`): the file's convention is one field per
     concept with a strict zod shape (`body` vs `json`, `expect.headers` vs `expect.json`), and
     a sibling keeps both the zod and the prompt sentence simple. Case-insensitive lookup over
     the already-lower-cased response headers; a missing header fails the step with the same
     construction as a missing body path. Both capture kinds share the `${name}` namespace and
     one evidence `captured` record. `Location` + `redirect: 'manual'` works and is tested —
     capturing a redirect target is the motivating case. `Set-Cookie` is NOT special-cased: the
     jar owns cookies.
   - **`fromRequest`** (`packages/guard-runner/src/api/credential-request.ts`). The credential
     XOR became exactly-one-of `value` | `valueFromEnv` | `fromRequest`. Value source mirrors
     the step design: exactly one of `capture` (dotted body path) or `captureHeader`.
     - **`template` defaults to VERBATIM** — the captured value is injected as-is; a wrapper is
       opt-in (`"template": "Bearer ${value}"`, which must contain `${value}`). A `Bearer `
       default would be wrong for every cookie/api-key/custom-scheme API and would silently
       double-prefix an API that already returns `"Bearer …"`. The Phase-2 Authorization shape
       warning is what nudges an author who forgot one.
     - **Ordering**: static credentials still resolve early (a missing env var must stop before
       anything boots). `fromRequest` needs a live app, so it runs on the run-level PREFLIGHT
       boot via a new `onReady(baseUrl)` hook on `preflightApiServer` — after the seed (so a
       seeded account can be the one it logs in as) and before any scenario. ONE boot, not two.
       Minted values merge into the same `apiCredentials` map static and seeded values share,
       so `{{cred:…}}`, the shape warning, and evidence redaction needed no new plumbing.
     - **Survival contract — the same one `api.seed` carries, and it is load-bearing.** Every
       scenario boots its OWN fresh server, so a token minted against the preflight instance is
       valid later only when the auth state outlives the process: a stateless signed token (a
       JWT signed with a static secret — the common simple case, and what makes this feature
       worth having) or a session row in a datastore `api.services.up` brought up. In-memory
       sessions will 401 in every scenario. Recorded in the schema doc comment, the README, and
       here.
     - **Failure = new run status `credential-request-failed`**, mirroring `seed-failed` at
       every consumer (`runFailureMessage`, the CLI's abort case, `guard-in-process`'s build-phase
       tracker, the EE gate's `infra` error). A connection error, a timeout, a non-JSON body, a
       missing capture path/header, and a blank captured value are all hard stops; the response
       STATUS is deliberately NOT asserted (200/201/302+Set-Cookie are all legitimate logins —
       what must hold is that the declared value is there).
     - **Fingerprint**: `hashableRecipeText` strips credential `value`s only, so `fromRequest`
       is hashed WHOLE — correct, since the login endpoint is a capability and a changed one
       should re-plan. Corollary documented in the schema: do not put a real password in a
       `fromRequest` body; it is committed and hashed. Verified by test.
     - **Not proposed, by design.** Neither the deterministic proposer (item 55) nor the
       recipe-discovery LLM path learns to emit `fromRequest`: choosing a login endpoint and
       its capture path is semantics the detectors cannot see and the model would guess at. The
       proposal schema is unchanged; recipe authors hand-write it.
   - **Prompt**: `GENERATE_API_SYSTEM_PROMPT` gained the cookie-jar paragraph and the
     `captureHeaders` bullet, and `captureHeaders` entered the embedded authored JSON schema —
     `GENERATE_API_PROMPT_FINGERPRINT` rolled `8be97dbf1290a228` → `5120b724b712b7fe`, so every
     api section re-authors once (which is how session-cookie flows convert). Nothing was added
     for `fromRequest`: it is advertised through the existing credential capability list
     (`recipeCredentialCapabilities` reads `header`/`description`/`satisfies`, so the new
     variant needed no change) — to an author a `{{cred:<name>}}` is a `{{cred:<name>}}`.
     NOTE (contradiction found): the scenario schema carries NO zod `.describe()` calls, so
     JSDoc does NOT flow into `jsonSchemaHint` output — field DOCS live in the prompt prose;
     only the field's name and type ride the schema.
   - Tests: `tests/guard-runner/api-cookies.test.ts` (17 — parsing, path scoping incl.
     default-path and segment-boundary matching, longest-first ordering, same-name-different-path,
     Max-Age/Expires/precedence/delete-idiom, unparseable Expires),
     `tests/guard-runner/api-auth-run.test.ts` (16 through `runGuard` — jar within a scenario,
     jar isolation across scenarios, explicit `Cookie` wins, expiry, path scoping,
     `captureHeaders` present/case-insensitive/missing/`Location`/shared-namespace,
     `fromRequest` happy path by body and by header, verbatim-vs-template, capture miss and a
     404 login → `credential-request-failed`, redaction of the minted value, fingerprint
     neutrality/sensitivity), plus schema rows in `tests/guard-runner/recipe.test.ts` (12) and
     `tests/shared/guard-scenario-api.test.ts` (1), and the new status in
     `run-failure-message.test.ts` + `tests/github-app/guard-gate.test.ts`. The api fixture
     server gained `/login` (+`ttl`/`path`), `/me`, `/redirect`, and a STATELESS
     `/auth/token` + `/whoami` + `/whoami-raw` (an hmac of the user under `TC_TOKEN_SECRET`, so
     a preflight-minted token is valid to every scenario's own boot — the JWT case in
     miniature).

60. **Phase 6 — seeding diagnosis (planned, item 54).** (a) An enumerated `missing-data`
   capability noun (authoring prompt + dashboard mapping) so "the row doesn't exist" stops
   hiding inside free-text blocked-on reasons. (b) The **blocked-precondition annotation**: when
   an UNMILESTONED prerequisite step fails, the scenario is annotated blocked-precondition and
   surfaced distinctly in the CLI and dashboard — the claim was never actually exercised. Per
   item 54's locked decision this is an ANNOTATION (the `journeyDrifted` precedent); the outcome
   enum is untouched.
   STATUS: **BUILT 2026-07-28.** As-built decisions:
   - (a) `missing-data` is a SUGGESTED noun (prompt vocabulary + a dashboard row), NOT a schema
     enum — `blockedOn` stays free text. Both authoring system prompts now separate the three
     blocker classes (secret → `credentials`, third party → the SERVICE, pre-existing data →
     `missing-data`) and ask for a SECOND entry naming the entity
     (`["missing-data", "an already-cancelled booking"]`) — the noun makes it countable, the
     entity makes it fixable, and `guardGapNeed` already joins the two into one sentence
     ("needs seed data and an already-cancelled booking"). The FIXTURES AVAILABLE user-prompt
     block names the same noun. Both fingerprints rolled (cli `59c2a6fd7e1ac505` →
     `9c3e1b8cb2e97cdb`, api `fdd9a160df4dd410` → `99337e9d2e65b57c`) — one re-author per
     section, which is how flows blocked on unnamed data acquire the noun.
     Dashboard row `missing-data|seed|fixture|\bdata\b` → "needs seed data", placed AFTER the
     database row (which keeps `database`/`datastore` reading as infrastructure) and with
     `\bdata\b` word-anchored so `metadata`/`dataset` never fall in on a substring.
   - (b) The annotation is `blockedPrecondition?: true` on `GuardScenarioResult`, set by BOTH
     drivers (the cli step schema carries milestones too) through ONE shared rule,
     `blockedPreconditionAnnotation(steps, failingStep)` in `packages/shared/src/guard/result.ts`:
     the failing step (execution stops at the first, so there is only one) carries no
     `milestone` AND some other step of the scenario does. The second clause is deliberate — a
     hand-written scenario declares no milestone anywhere and asserts THROUGH its plumbing, so
     an unmilestoned failure there is its verdict, not a blocked precondition. Scoped to `fail`;
     an `error` is already the infrastructure class.
   - Surfaced as a distinct line in the CLI failure detail (`⊘ blocked precondition — a setup
     step failed before any specified behavior was reached`, above the journey-drift line) and
     as a "Setup failed" marker in `GuardTestView` (the screen both the Tests tab and the run's
     drift detail render), fed by `blockedPrecondition` on `GuardFlowScenarioRow`. Birth
     findings do NOT carry it (`GuardBirthFindingSchema` records the milestone pair, not the
     annotation), so a birth-stage row renders without it — additive later if wanted.
   - NO `blockedPreconditionCount` on `GuardSummary`: no consumer reads a tally today (the
     dashboard strip renders the outcome counts, and the annotation is a per-scenario fact both
     surfaces already read from the result row), so the field would be plumbing with no reader.
   - EE gate: UNCHANGED, per the decision. `ee/packages/github-app/src/guard-gate.ts` keys the
     Check conclusion on `outcome === 'fail' || 'error'` alone; an additive optional field
     cannot reach it. A broken precondition still blocks — it is red either way.

61. **Phase 7 — deferred, telemetry-driven, NOT scheduled (planned, item 54).** Recorded so they
   are not re-litigated ad hoc: AST-derived entity requirements; spec-backed stub responses
   (generate the `setup.http` body from the OpenAPI schema of the upstream); proxy interception
   + real egress control; ~~an `api.externals` declaration stanza~~ (PULLED FORWARD and built —
   see item 62; the user asked for it directly, which is the telemetry this list was waiting for);
   ~~LLM-drafted seed scripts behind the review-and-commit gate~~ (PULLED FORWARD and built as
   STAGE 1 — see item 66; the user approved the design directly, which is the telemetry this
   list was waiting for; AST-derived entity requirements is now item 66's own stage-2 follow-up).
   Each of the rest unlocks only after the phases above produce telemetry saying it is the
   binding constraint.


62. **User-provided external API accounts — `api.externals` (user decision 2026-07-28; the
   `api.externals` stanza item 61 had deferred, pulled forward on request).** Phase 3 (item 57)
   names the third parties a repo depends on and Phase 4 (item 58) lets a scenario STUB one. The
   third answer, and the user's preferred one, is neither: SHOW the detected services and let the
   user hand guard a REAL or SANDBOX account. Provided ⇒ the runner points the app at it and
   authoring writes LIVE-integration flows against it; not provided ⇒ the flows stay blocked,
   byte-identically to before. Stubs remain supported and a PROVIDED service takes precedence over
   stubbing it in authoring guidance — but a scenario that stubs it still wins for ITSELF.
   STATUS: **BUILT 2026-07-28** — engine (schema, load/merge, runner injection, generation
   advertisement, core read/write commands, dashboard-server routes, CLI status footprint, docs)
   plus both UI halves (below). The core/server API is the surface both call; neither owns any
   externals logic of its own.
   - **Two files, split by SECRECY, and that split is the whole design.** The DECLARATION
     (`api.externals` in the committed `recipe.json`): service → `{baseUrlEnv, baseUrl?, mode?,
     env?, description?}`. `baseUrlEnv` is the env var THE APP reads — the same variable a
     `setup.http` stub points at, which is what makes stub-vs-account a precedence question rather
     than two mechanisms. The VALUES live in a sibling **gitignored**
     `scenarios/externals.local.json` (`Record<service, {baseUrl?, env?}>`), merged over the
     declaration per FIELD at load (local wins). Overlay entries for an UNDECLARED service — or an
     undeclared env key — are DROPPED, not adopted: the declaration is the committed half by
     design, so a local-only service could never unblock authoring for a teammate, and honoring it
     would make one developer's run disagree with the corpus. They are surfaced
     (`unknownLocalServices` / `undeclaredLocalEnv`) rather than silently ignored.
   - **The env-var source discipline deviates from credentials, deliberately.** A credential is
     `value` XOR `valueFromEnv` XOR `fromRequest`. An external env var is `value` NAND
     `valueFromEnv` — **neither is legal and is the recommended shape for a real key**: `{}`
     DECLARES that the app needs the variable while the value comes from the overlay. Without this
     the committed recipe could not name a secret-bearing variable at all, and the two halves
     could not travel separately.
   - **PROVIDED / INCOMPLETE / UNPROVIDED — one function, `resolveExternal`
     (`packages/guard-runner/src/externals.ts`).** Provided = a base URL is known AND every
     declared env var resolves (overlay > inline `value` > host env, blank counting as unset).
     Nothing resolves = unprovided (declared so a UI can offer to fill it; authoring unchanged).
     SOME of it resolves = **incomplete**, and that is the dangerous state — a key set with no base
     URL would send the key to the vendor's PRODUCTION default — so the runner HARD-STOPS on it
     (`missing-external-env`) rather than running against a world nobody described. Every
     requirement carries a per-item `resolved`/`source`/`reason`, which is the granularity the UIs
     need and the CLI prints.
   - **Injection: into the SERVER env, never into scenario steps.** The app consumes these, not the
     scenario. Layered in `run.ts` at the api env assembly, so the precedence falls out of the
     existing `constructChildEnv` order: **`setup.env` (incl. `${HTTP_STUB:…}`) > externals >
     `api.env`**. A provided account is therefore the default world AND any single scenario that
     needs response control can still stub the same service for itself. Unprovided/incomplete
     inject nothing.
   - **Fingerprint: the declaration re-authors, the secret never does.** `api.externals` is IN
     `recipe.json`, so declaring a service moves `computeRecipeFingerprint` and re-keys every
     section that generates against it — that IS the self-unblocking mechanism (a flow that settled
     `blocked-on stripe` converts the moment an account is supplied). `hashableRecipeText` strips
     `externals.*.env.*.value` exactly as it strips credential values, and the local overlay never
     reaches the hash at all, so a rotated key or a changed sandbox URL is fingerprint-neutral BY
     CONSTRUCTION rather than by a rule someone must remember.
   - **Hard stop, mirrored across every consumer.** New `missing-external-env` status on
     `RunGuardResult`, wired into `runFailureMessage`, the CLI abort branch, the in-process build
     tracker, and the EE guard-gate's `infra` error class — the complete
     `missing-credential-env` consumer set. A broken `externals.local.json` is an
     `invalid-recipe` stop (never a silently empty overlay).
   - **Redaction.** `buildCredentialRedactor` grew an optional second map: external env values mask
     as `«external:<service>.<VAR>»` (distinct from `«cred:…»` — they are not credentials and the
     evidence should not claim they are). Wired into the scenario redactor and the seed's
     failure redactor, since the seed runs with the server env.
   - **Generation advertisement — a new AUTHORING RULE, so it is in the SYSTEM prompt.**
     `GENERATE_API_SYSTEM_PROMPT` gained the "a provided service is LIVE" block (author against it;
     never stub it; assert shapes/invariants, never an exact upstream-dependent value; a flow
     needing response control uses `setup.http` or stays blocked). **`GENERATE_API_PROMPT_FINGERPRINT`
     ROLLED `99337e9d2e65b57c` → `6ec8e295c37c13e8`** — every api section re-authors once, which is
     how blocked flows convert. The per-repo LIST stays in the USER prompt:
     `ExternalServiceHint` gained `provided`/`mode`/`description`, provided services render under
     `EXTERNAL SERVICES AVAILABLE FOR REAL` and drop out of the `THIRD PARTIES…` blocker list; the
     recipe's `baseUrlEnv` beats the detector's guess (it is what the runner injects), and a
     PROVIDED service the detector never saw is advertised too (the user knows about integrations
     import scanning cannot see). A repo with no declarations renders byte-identically.
   - **The read/write surface the UIs call** (`packages/core/src/commands/guard-externals.ts`):
     `readGuardExternalsView(repoRoot)` joins detection (`guard/result.json`'s `externalServices`,
     absent ⇒ `detectionAvailable: false`, never "no third parties"), declaration, resolution, and
     the per-service blocked-flow count parsed back out of the last generate's `blocked-on` gaps
     (deduped by flow). `writeGuardExternals(repoRoot, {externals})` splits a patch by secrecy —
     declarations to `recipe.json`, values to the overlay, `valueFromEnv` committed (a variable NAME
     is not a secret), `{value, inline: true}` the deliberate escape hatch — validates the WHOLE
     resulting recipe (so an edit that would not load is refused HERE, not discovered by the next
     run), and writes parse-modify-stringify in the file's own 2-space format with its
     trailing-newline presence preserved. **A no-op write touches no file** (byte compare before
     the atomic rename), and unrelated recipe keys survive untouched.
   - **Routes.** `GET /:id/guard/externals` (read surface, `guard.ts`) and
     `PUT /:id/guard/externals` (write surface, `guard-actions.ts`) — both gated on
     `guardsMaterializeInPlace()` (working tree only), the PUT answering the fresh view so the
     client needs no follow-up GET, 400 on a malformed body, 422 (never 500) on a refused write,
     and emitting `spec:complete { kind: 'guard-externals' }` — a NEW kind, because declaring a
     service really does flip the generate-stale dot.
   - **CLI.** `guard status` gained a read-only externals block (one line per service: name, state,
     base URL/mode, the unmet requirements of an incomplete one, and the blocked-flow count);
     silent on a repo with none, so existing output is unchanged.
   - **CLI provisioning — `truecourse guard externals`** (`tools/cli/src/commands/guard-externals.ts`).
     Interactive by default, read-only with `--list` **or in any non-TTY** (piped/CI runs never
     block on a prompt): pick a detected service (or declare one by hand), give it the base-URL env
     var (pre-filled from the detector's guess, labelled as a guess), a base URL, sandbox/real, a
     description, then loop "add an env var?" → paste the value / read it from a shell variable /
     paste a NON-SECRET inline, each option naming the file it lands in. A pasted value is read
     through a clack `password` prompt and echoed only as `••••`+last-4 in the confirm summary;
     every prompt is cancel-safe (`isCancel` ⇒ exit 0, nothing written), a `GuardExternalsWriteError`
     is printed verbatim + exit 1, and the write reports the resulting state with the unmet
     requirements of an incomplete one. `guard status`'s block is now the SAME renderer
     (`printExternalsView`), so the two CLI surfaces cannot drift.
   - **Dashboard page — the `externals` tab, "External APIs"**
     (`apps/dashboard/client/src/components/guard/GuardExternalsPane.tsx` + `useGuardExternals` +
     the two `api.ts` calls). Registered in the Guard section of `navigation/registry.ts` after
     Journeys, `noPanel` (the page is one card list) and **`local-filesystem`-gated** — it reads and
     writes the working tree, which is exactly what the routes' 501 gate says, so hosted never shows
     a tab that could only fail. One card per service: state badge (provided green / incomplete
     amber / unprovided neutral), category chip, blocked-test count, description, base URL + its env
     var (flagged when the source is the detector's guess), the per-requirement reasons of an
     incomplete, resolved secrets as `VAR=•••• stored locally` (never a value), collapsible
     detection evidence, and the declared-but-undetected / detected-but-undeclared notes. Warning
     strips carry `invalidReason`, the missing `api` block, `detectionAvailable: false` ("we have
     not looked", never "there are none") and `unknownLocalServices` /`undeclaredLocalEnv`. The
     inline form writes ONE service per PUT and renders the returned view; a 422 shows inline with
     the engine's wording and the form stays open. Types are mirrored client-side
     (`src/types/guard-externals.ts`) because the client depends on `@truecourse/shared` only —
     `@truecourse/core` is a Node package. Refresh is the page-level `spec:complete
     { kind: 'guard-externals' }` reload key, already wired.
   - UI tests: `tests/cli/guard-externals.test.ts` (9 — the read view, the non-TTY fallback, the
     write split asserted on real files, `valueFromEnv` committed as a name, removal, cancel and
     declined-confirm writing nothing, the no-`api`-block refusal),
     `tests/dashboard-client/guard-externals.test.tsx` (10 — the cards, evidence toggle, the four
     empty/warning states, the two PUT body shapes, manual add + remove, the local validation and
     the 422).
   - Tests: `tests/guard-runner/externals.test.ts` (19 — schema accept/reject incl. the strict and
     duplicate-env-var refusals, overlay load/merge precedence, the three states, the fingerprint
     split both ways), `tests/guard-runner/externals-run.test.ts` (7 — injection into the real
     booted server via the fixture's `/boot` env reflection, both precedence directions, the
     `missing-external-env` stop, the broken-overlay stop, redaction out of failure output AND the
     evidence transcript), `tests/guard-generator/externals-provided.test.ts` (4 — provided flips
     blocker→capability, incomplete does NOT, an undetected provided account is advertised, a
     declaration-less repo is unchanged), `tests/core/guard-externals.test.ts` (13 — the join, the
     write split, byte-stability + the no-op write, the refusals, the gitignore template),
     `tests/server/guard-externals-routes.test.ts` (6 — both routes end to end on real files).

63. **External services detected from PLAIN HTTP, not just SDK imports (user directive
   2026-07-28; extends items 57 and 62).** Item 57's detector reads `externalLayerPatterns`, so it
   can only name what a repo IMPORTS. The `speced-api` bench — whose entire integration is
   `fetch(new URL('/v1/search', baseUrl))` against open-meteo — therefore detects **nothing**, and
   its flows are blocked on a generic noun while the externals page shows an empty list. Worse than
   a wrong answer: a confident silence. The second source of identity is what such an app DOES
   write down — the URL literal itself, and (almost always, in the same statement) the env var that
   overrides it.
   STATUS: **BUILT 2026-07-28** (JS/TS slice). As-built decisions:
   - **A real tree-sitter pass, not a scan of `FileAnalysis.calls`**
     (`packages/analyzer/src/extractors/external-http.ts`, wired into `buildFileAnalysis` beside
     the route/cli extractors). `calls` carries call sites only, and the interesting URL is NOT at
     one: it sits in a module-level `const DEFAULTS = { FORECAST_BASE_URL: 'https://…' }` or a
     `process.env.X ?? 'https://…'` initializer. Structure is also the only honest way to say WHICH
     env var a URL belongs to in a file that declares several. Two additive optional
     `FileAnalysis` fields (`externalHttpRefs`, `urlEnvReads`), the `routeRegistrations` precedent.
   - **Two env-association tiers, and the weaker one never carries a default URL.**
     `literal-fallback` = the source structurally binds them: an env read inside the smallest
     enclosing expression containing this URL **and no other** (the one-URL rule is what stops a
     multi-property object binding every URL in it to one stray env read), or an ENV-SHAPED object
     KEY whose value IS this URL — the defaults-map shape, gated on the file reading the
     environment at all so a constants table is not misread as configuration. `name-heuristic` =
     only the NAME says so (item 57's original tier, kept). MODE variables (`NODE_ENV`, `APP_ENV`,
     …) are never bound: they sit next to URLs constantly and advertising "override NODE_ENV to
     point the app elsewhere" would be false.
   - **Grouping is by REGISTRABLE DOMAIN, name = domain minus suffix.**
     `geocoding-api.open-meteo.com` + `api.open-meteo.com` → one service `open-meteo`. Multi-part
     suffixes come from a small `MULTI_PART_TLDS` list, deliberately NOT a public-suffix
     dependency: the product is a readable name, and being wrong about `foo.co.uk` costs an odd
     name, never a wrong blocked-on decision.
   - **Exclusions are a constant, and repo-own hosts are a CALLER's answer.** localhost/IPs/
     single-label hosts, RFC-2606 names, `.local/.test/.internal/.invalid`, and namespace/spec
     hosts (`www.w3.org`, `json-schema.org`) — nothing is ever requested from those. Nothing in a
     `FileAnalysis` says which hosts the repo OWNS, so that is an optional
     `detectExternalServices(files, { ownHosts })` rather than a guess; wired by item 71 (the
     recipe's `ownHosts` declaration + pinned-env derivation).
   - **Shape evolves ADDITIVELY, and `category` becomes OPTIONAL.** `baseUrlEnvs[]`
     (`{envVar, defaultUrl?, confidence}`), `source: 'sdk' | 'http'` (optional — pre-item-63 data
     reads as `sdk`), and `url` on the evidence entry beside `importSource` (now optional; exactly
     one is present). `category` is optional because an HTTP-detected service has NO registry entry
     and its kind is genuinely unknown — item 57 deliberately dropped `http` as a category, and
     resurrecting one would name a transport, not a kind of third party. `baseUrlEnv` stays
     populated with the best entry for back-compat; every consumer was upgraded to prefer the list.
   - **Union, deduped by service name.** SDK identity wins (category + import evidence), evidence
     and base-URL env vars MERGE with the structural tier first — a repo that both imports `stripe`
     and writes `https://api.stripe.com` in a config default has told us two true things about one
     service. Harvest order is sorted by (file, line, column) so the FIRST override variable of a
     service is the same on every run.
   - **ACCEPTANCE, validated against the real `speced-api` working tree** (read-only, via a scratch
     script): exactly one entry, `{service: 'open-meteo', source: 'http', baseUrlEnv:
     'GEOCODING_BASE_URL', baseUrlEnvs: [GEOCODING_BASE_URL → https://geocoding-api.open-meteo.com,
     FORECAST_BASE_URL → https://api.open-meteo.com, both `literal-fallback`]}`, evidence pointing
     at `src/config.ts`. Before this item the same tree detected an empty list.
   - **NO PROMPT FINGERPRINT ROLL — and that is the correct outcome, contrary to the brief.** The
     advertisement is the per-repo LIST, which item 57 deliberately put in the USER prompt;
     `GENERATE_API_PROMPT_FINGERPRINT` hashes the SYSTEM prompt only. Nothing in the authoring
     RULES changed, so re-authoring every api section would buy nothing. The user-prompt wording
     did change (`detected in its source`, `base URL envs: A, B — stubable via setup.http, or
     provide it`, and the new "point EVERY one of that service's env vars at `${HTTP_STUB:…}`"
     sentence — a half-stubbed vendor is a live upstream), so the two prompt-text assertions in
     `tests/guard-generator/{external-services,externals-provided}.test.ts` moved with it.
   - **Downstream, all additive.** `GuardExternalServiceView` gained `baseUrlEnvs[]` and
     `detectedVia`; the dashboard card names the variables the primary field cannot show and
     renders URL evidence as "requests" (never "imports"); the provide-account form pre-fills the
     extra variables as INLINE rows carrying today's default URL (an origin is not a secret), only
     for a not-yet-declared service; `truecourse guard externals` announces them and offers each
     one in the env loop (offered exactly once, so the loop still terminates on the user's
     answers).
   - **FOLLOW-UP — Python and C# parity.** The URL harvest is JS/TS only. Both languages parse into
     the same tree-sitter shape and the association patterns have direct analogs
     (`os.environ.get('X', 'https://…')`, `Environment.GetEnvironmentVariable("X") ??`), so this is
     an extractor-dispatch change (the `extractRouteRegistrations` per-language precedent) plus
     fixtures — not a redesign. Until then those repos keep SDK-import detection only, which reads
     as "not looked at", never "has no third parties".
   - Tests: `tests/analyzer/external-http.test.ts` (15 — the URL harvest incl. template heads and
     the exclusion list, `ownHosts`, all four association shapes + the two negatives, domain
     grouping incl. multi-part suffixes, the speced-api acceptance, order stability, both merge
     directions), plus one each in `tests/guard-generator/external-services.test.ts` (the
     multi-variable advertisement), `tests/core/guard-externals.test.ts` (the whole HTTP service
     through the join), `tests/cli/guard-externals.test.ts` (the offered extra variable) and two in
     `tests/dashboard-client/guard-externals.test.tsx` (the form pre-fill, URL evidence).

64. **Fault injection on a PROVIDED external — the always-on proxy (`setup.externals`)
   (user decision 2026-07-28; completes items 62/63).** Item 62 made a user-supplied account the
   default world for a third party, and item 58 lets a scenario STUB one — but the two answers
   left a hole exactly where the `speced-api` bench sits: the flow
   `handle-upstream-failures-gracefully` is about the vendor FAILING (WX-055/056/058/060), which a
   live account will not do on request and a stub can only reproduce by replacing the account the
   user just supplied (and every one of its hosts, correctly, by hand). The third answer is to own
   the wire: **every provided external is ALWAYS reached through a runner-managed loopback proxy**,
   and a scenario scripts faults on it. STATUS: **BUILT 2026-07-28.** As-built decisions:
   - **ALWAYS on, not opt-in, and that is the whole design.** An opt-in proxy would have to be
     WIRED by the scenario (a base-URL override the author must remember, on every host of the
     vendor), which is the half-stubbed world item 63 called a confident silence. Unscripted
     traffic passes through verbatim, so a run with no fault script is byte-equivalent in behavior
     to pre-item-64 — the ONE observable change is the value of the base-URL env var the app boots
     with (a `127.0.0.1` origin, not the account's), which two item-62 tests were updated to say.
   - **BOOT IS EAGER (per scenario, per endpoint), and skipped only for a variable the scenario
     overrides.** Lazy binding is impossible by construction: an app can call its upstream during
     STARTUP, so the origin must be in the environment before the process exists — there is no
     first-call moment to bind at. The only proxy not started is one whose variable the scenario's
     own `setup.env` sets (a `${HTTP_STUB:…}`), so no port is spent on traffic that was never going
     to the account. A loopback listener on an ephemeral port costs microseconds and one fd.
   - **`api.externals.<svc>.endpoints` — the first-class home for a multi-host vendor
     (ADDITIVE).** Before this, a service's second base URL could only be modelled as an `env` row
     carrying an inline URL (the item-63 prefill did exactly that): it reads as a key, and nothing
     in the declaration says the value is an ORIGIN — which is precisely what the runner must know
     to proxy it. `endpoints` is `envVar → url`, resolved like `baseUrl` (recipe value, overridable
     per developer under the overlay's own `endpoints`), one requirement each, one PROXY each — and
     all endpoints of one service share that service's fault script and call log, because
     "open-meteo was called twice" is a fact about the SERVICE, not about one of its hosts. `env`
     stays the home of keys; the one-variable-one-owner refusal now spans `baseUrlEnv` ∪
     `endpoints` ∪ `env`, within a service as well as across two. Both UIs write `endpoints` now
     (the CLI asks for each detected extra variable as its own base URL; the dashboard form has
     URL rows beside the env rows), so the item-63 prefill lands in the right block.
   - **The fault vocabulary is four primitives + sequencing, and the naming deviates from the
     brief.** The brief proposed `{ calls?: FaultRule[] }` AND a `calls?: number` count assertion —
     one word for two things. Built as `{ faults?: FaultRule[], calls?: number }`, mirroring
     `setup.http`'s `routes`/`calls` split exactly. A rule is `match?` (method/path, the stub's
     exact-or-one-trailing-`*` semantics) + `respond` (status/headers/`body`XOR`json`) |
     `delayMs` | `refuse: true`, plus `once: true`. `delayMs` COMPOSES (delay-then-respond, or
     delay-then-FORWARD — the latter is how "slower than the app's timeout" is written); `respond`
     and `refuse` are mutually exclusive; a rule carrying only `match` is an explicit passthrough
     that still consumes. Unmatched or exhausted ⇒ passthrough, always.
   - **A fault is NEVER a failure; a wrong `calls` count is.** The scripted world cannot fail the
     scenario it describes. `calls` is exact (the item-58 precedent, and the same two interesting
     assertions: `1` = no retry, `0` = never called), evaluated at scenario end, attributed to the
     last step, and its evidence lists the calls received — run through the scenario's
     `buildCredentialRedactor`, since a vendor key rides the query string of every one of them. A
     new `external` mismatch subject beside `stub`.
   - **Refusal and upstream death are the SAME thing on the wire, deliberately.** `refuse`
     destroys the socket unanswered, and a genuinely unreachable upstream does too — the proxy
     never invents a 502, which the app's own error handling would read as an upstream REPLY.
   - **No `GUARD_FORMAT_VERSION` bump** (additive optional, item 49's precedent). Both prompt
     fingerprints rolled: `GENERATE_API_PROMPT_FINGERPRINT` `6ec8e295c37c13e8` →
     `2ee951b99e6d078b` (a new AUTHORING RULE: a provided service's faults are scriptable, so a
     flow about upstream-failure behavior must NOT be left `blockedOn`), and
     `GENERATE_PROMPT_FINGERPRINT` `9c3e1b8cb2e97cdb` → `b88a19e3f31a06d7` (mechanical:
     `setup.externals` joined the shared `GuardSetupSchema` both drivers embed). The per-repo LIST
     stays in the USER prompt, per item 63's split.
   - **The capability is api-only, and a cli scenario says so LOUDLY.** External accounts configure
     the api SERVER's env (item 62), so the cli driver proxies nothing — and a cli scenario
     declaring `setup.externals` gets the same `CapabilityError` an undeclared stub reference
     earns, never a silent no-op.
   - **`speced-api` ACCEPTANCE — MET, against a scratch copy of the real app** (that repo was not
     modified and no `guard generate` was run). Six hand-written scenarios through `runGuard`, with
     open-meteo declared provided (`baseUrlEnv` FORECAST_BASE_URL + `endpoints` GEOCODING_BASE_URL)
     against a local stand-in for "the real service" so the bench is hermetic: forced 503 →
     `502 upstream_unavailable` with the upstream status and body absent from the client-facing
     error (WX-056/WX-059) and `calls: 1` (WX-060); `delayMs: 2500` against `UPSTREAM_TIMEOUT_MS=1000`
     → `504 upstream_timeout` (WX-055); `refuse` → `502` (WX-058); `[{refuse, once}]` + `calls: 2`
     → the first request fails and the next succeeds, one call each (sequencing + no retry); plus a
     passthrough control (the real service is reached and answers) and a precedence control (a
     `${HTTP_STUB:…}` scenario wins for itself while `calls: 0` proves the account was untouched).
     Negative controls bite: a wrong `calls` count fails with the count received, and asserting the
     upstream's body IS present fails — the non-leakage is real, not a matcher that cannot fail.
   - Tests: `tests/guard-runner/external-proxy.test.ts` (25 — forwarding fidelity incl. query,
     headers, body, chunked streaming, host rewrite, hop-by-hop stripping and a path-prefixed base
     URL; every fault primitive; once-sequencing, exhaustion and match narrowing; per-endpoint
     ports sharing one script + log; the `calls` assertion incl. `0`; the refusals and the
     `overriddenEnv` skip; the schema accept/reject rows) and
     `tests/guard-runner/externals-proxy-run.test.ts` (10 — through `runGuard` on the real fixture
     app: always-on proxying proved from the app's OWN env, passthrough reaching the real service,
     a scripted fault never touching it, refusal-then-recovery, the `calls` fail with redacted
     evidence, `setup.env` winning, the undeclared/unprovided/cli errors, multi-endpoint), plus
     rows in `tests/guard-runner/externals.test.ts` (`endpoints` schema + resolution + overlay),
     `tests/core/guard-externals.test.ts`, `tests/cli/guard-externals.test.ts`,
     `tests/dashboard-client/guard-externals.test.tsx` and the two generator prompt tests.

65. **"Needs setup" — the providable slice of `blocked-on`, promoted to an ACTIONABLE
   presentation (user decision 2026-07-28; completes items 57/62/63/64).** Items 57 and 63 put
   the SERVICE NAME in a `blocked-on` gap and item 62 made the account providable — but the
   dashboard still painted `open-meteo` the same inert grey as "no code path does this". Two
   states with opposite remedies wore one colour: one is unfixable today, the other is a form
   away. STATUS: **BUILT 2026-07-28.** Presentation + read-model derivation ONLY — no outcome,
   no gap kind, no pass/fail count and no EE gate behavior moved. As-built decisions:
   - **A NEW COVERAGE STATUS, not a boolean on the row — the precedence architecture made that
     the honest choice.** `GuardSectionCoverageStatus` is the read model's closed union and
     `GUARD_COVERAGE_STATUS_PRECEDENCE` is the ONE order every rollup (surface → flow → section)
     uses; a boolean beside `status` would have needed a parallel ordering rule in every one of
     those rollups plus the client's own sort, which is exactly the drift the union exists to
     prevent. Both compile-time backstops (the precedence exhaustiveness check in `dashboard.ts`
     and the totals-bucket check in `guard-read.ts`) fired and forced the explicit rank. The
     back-compat cost is nil BY CONSTRUCTION: `dashboard.ts` shapes are computed on read and
     never persisted (`needs-setup` can never appear in a stored file), and the two additive
     optional fields (`GuardFlowGap.needsSetup`, `GuardSectionFlow`/`GuardSectionCoverage`
     `needsSetup`) leave an older `result.json` parsing unchanged.
   - **Ranked in the GAP tier, above `blocked-on`, below every run outcome.** A section that
     ran paints its run (tier-1 rule, untouched — a `pass` still beats a needs-setup sibling);
     within the gaps, most-actionable-first replaced the old flat "could not test" ordering
     lead. In the client's plain-status domain it is a FIFTH word ("Needs setup"), directly
     below "Failing" — the Flows filter therefore gains a chip, which is the point: it is the
     list a user should work next.
   - **The rule is one function, `deriveNeedsSetup`** (`packages/shared/src/guard/needs-setup.ts`):
     a noun that names a service the externals machinery KNOWS (detected OR declared) and that is
     not provided ⇒ needs-setup; already provided ⇒ the **"setup done" sub-state** ("re-run guard
     generate to author N flows" — the gap is the last generate's stale answer, and this is where
     the deferred generate-trigger will eventually hang); a generic noun (`external-service`,
     `third-party`), an unknown service, or NO externals data ⇒ plain `blocked-on`, untouched.
     Matching is whole-noun and case-insensitive — item 57 already canonicalizes `stripe api` →
     `stripe`, so a substring match here would only ever be a guess.
   - **Derived ONCE, in the core read path, never in the client.** The index is
     `readGuardExternalSetupIndex` (service → `provided|incomplete|unprovided`, off
     `readGuardExternalsView`) and it enters through `buildFlowJoin`, so the coverage join, the
     flow list and the flow detail cannot disagree about what a gap is. It is **working-tree
     only** (`guardExternalSetupIndexForView` gates on `guardsMaterializeInPlace()`): a hosted
     store keeps plain `blocked-on`, which is honest — there is no External APIs page there to
     send anyone to, since those routes 501 for the same reason.
   - **Colour: orange, and neither of the two neighbours it could have borrowed.** Red is a
     failure (nothing failed), grey is the gap wall it was promoted out of, and amber is already
     stale/orphaned — a DIFFERENT story ("re-anchor"), so sharing the swatch would merge two
     unrelated to-dos. Orange is the repo's existing "medium severity" attention colour, in the
     same `bg-x-500/15 text-x-600 dark:text-x-400` opacity idiom, so it reads in both themes.
   - **The vocabulary module's own comment said not to do this, and the reversal is deliberate.**
     `guard-flow-status.ts` warns that inventing a second name for `blocked-on` ("Needs setup") is
     the bug the table exists to prevent. That still holds: `needs-setup` is a **different wire
     status**, produced by a join `blocked-on` alone cannot do, which is precisely what lets the
     table give them two names honestly. The comment was updated to say so rather than deleted.
   - **Surfaces.** Totals strip: the blocked chip SPLITS, and the orange chip's expansion is a
     per-SERVICE list ("open-meteo — 3 sections") whose rows are the CTA. Section detail: the CTA
     leads the pane ("Provide open-meteo → External APIs", or the re-generate command in the
     done sub-state). Surface chips and why-no-test rows name the service ("needs setup:
     open-meteo"). `useGuardView` gained `openGuardExternals` (section `guard`, tab `externals` —
     item 62's `local-filesystem`-gated tab). CLI: `guard status` gains one line under the gaps
     detail, from the same core derivation (`guardNeedsSetupServices`), silent when nothing is
     providable.
   - **Extended 2026-07-30 — the CTA is ONE component, and it deep-links to the SERVICE.** The
     flow detail's why-no-test row showed the bare "Needs setup: zoom." sentence with no
     explanation and nowhere to go, while the section side panel next to it had the full
     treatment. The panel's local CTA was extracted to
     `apps/dashboard/client/src/components/guard/GuardNeedsSetupCta.tsx` and both surfaces now
     render it, so a section and the flows through it can never word the same to-do twice. The
     flow row adds the vocabulary's longer explainer (`guardStatusHint('needs-setup')`) — the
     CTA's own `guardNeedsSetupNeed` sentence REPLACES `guardWhyNoTest` there rather than
     doubling it — and the row is tinted orange but stays unclickable-as-a-whole, so it still
     doesn't look like a test. **ONE LINK PER OUTSTANDING SERVICE** (user feedback, same day):
     a gap can name several ("apple and googleapis") and a link opens exactly one card, so the
     single combined "Provide apple and googleapis" button left every service but the first
     unreachable. The need SENTENCE still reads as one phrase; only the ACTION splits, and the
     words come from a new per-service `guardProvideServiceCta(service)` in the vocabulary
     module. **The banner headline is a SENTENCE, the chip phrase stays a label** (same
     feedback round): `needs setup: apple and googleapis` never said what was going on, so the
     banner now leads with `guardNeedsSetupHeadline` — "Not testable yet — apple and googleapis
     are external services that need accounts before guard can test against them." The compact
     `guardNeedsSetupNeed` is unchanged, because the surfaces it feeds (surface chips, journey
     needs, the section panel's flow rows, `guardWhyNoTest`) are ONE LINE and a sentence would
     wreck them — two lengths of the same facts, both in the vocabulary module. Seed data is
     branched apart in the headline (it is a row nothing creates, not an account anyone signs
     up for), and the done sub-state states the fact ("… already set up — these tests just
     haven't been authored since") with the command beneath it as the action. The flow row's
     second line dropped `guardStatusHint('needs-setup')`, which the headline now duplicates,
     for `GUARD_NEEDS_SETUP_NEXT` — the two things the headline leaves out (a sandbox account
     is enough; providing one is step 1 of 2). The hint itself stays for the coverage legend,
     where it is read with no banner beside it. `openGuardExternals(service?)` now carries
     `?gext=<service>`
     (cleared by `clearGuardSelections` like every other guard selection); `GuardExternalsPane`
     consumes it — it opens THAT service's account form, scrolls to the card, and deletes the
     param, so the deep link is a one-shot jump and a later manual visit is a plain read. The
     synthetic `missing-data` key is never linked (it has no card, and by construction only ever
     reaches the CTA in the done sub-state, whose action is a command). `GuardFlowsPane` /
     `RepoPage` pass the callback down; the totals-strip service rows name their service too.
     Tests: `tests/dashboard-client/guard-needs-setup.test.tsx` (+11, incl. the headline wording, N services ⇒ N links
     on both surfaces, each wired to its own service) and
     `tests/dashboard-client/guard-externals.test.tsx` (+4, now rendered under a router).
   - Tests: `tests/shared/guard-needs-setup.test.ts` (14 — every derivation branch incl. the
     mixed and case-insensitive ones, the strict payload, and the ranking: above every gap, below
     every outcome, both rollup directions), `tests/server/guard-coverage.test.ts` (+5 — the join
     end to end, the two sub-states, the generic-noun and no-data degradations, and the proof that
     the stored gap kind and the totals buckets are unmoved), `tests/core/guard-externals.test.ts`
     (+4 — the index over declared/detected-only, the ranked tally, a provided service sinking
     below an outstanding one despite more blocked flows), `tests/dashboard-client/guard-needs-setup.test.tsx`
     (15 — the word, the colour in both themes, the chip split, the expansion + its CTA, both
     sub-states, the link target, the tally), `tests/cli/guard.test.ts` (+2 — the line and its
     silence), plus the fifth-word updates in `guard-flows.test.tsx` / `guard-doc-sections.test.ts`.
   - **NOT built here, by design:** the generate-trigger behind the "setup done" row (a button
     that runs `guard generate`) — the run-hint idea it dovetails with is a separate decision.


66. **Auto-generated DB seeding — Stage 1: LLM-drafted `api.seed` (user-approved design
   2026-07-29; item 61's "LLM-drafted seed scripts behind the review-and-commit gate",
   unlocked).** Item 60 made "the row does not exist" a countable, named blocker
   (`missing-data` + the entity). The remedy was still a human writing a seed script from
   scratch against a schema the analyzer had ALREADY parsed. This stage writes the draft and
   the engine proves it: the model returns a script FILE and the `api.seed` block that runs
   it; the engine writes the script, runs it with `GUARD_SEED_OUT` set, validates the manifest
   against the drafted `provides` with the runner's OWN resolver, and boots the server against
   what it left behind. Nothing reaches the working tree unless all of that passed.
   STATUS: **BUILT 2026-07-29.** As-built decisions:
   - **The gate is four conditions and every refusal NAMES the one that failed**
     (`seedDraftGate`, `packages/guard-generator/src/seed-draft.ts`): flows blocked on
     `missing-data` this run, a database whose SCHEMA parsed, an `api` block, and NO existing
     `api.seed`. The last is absolute — a seed is a committed, human-reviewed file, so the
     stage never overwrites one and `--refresh` semantics are deliberately out of scope.
   - **Drafted AFTER authoring, and the two-pass reality is stated, not hidden.** The trigger
     (`missing-data`) is an authoring OUTPUT, so the stage cannot run before authoring; the
     drafted seed moves the recipe fingerprint, which re-authors the blocked sections on the
     NEXT generate. The CLI says exactly that ("re-run `truecourse guard generate` to author
     the N flows that were blocked"), mirroring the externals needs-setup sub-state (item 65).
   - **The needs-setup derivation was extended, and cheaply.** `readGuardExternalSetupIndex`
     gains ONE synthetic key: `missing-data → provided`, and only when the recipe declares an
     `api.seed`. A missing-data gap then renders through the EXISTING "setup done — re-run
     guard generate" component with no new status, no new rollup, and no client logic. It is
     never carried as `unprovided`: that sub-state's CTA is a link to the External APIs page
     and there is no row there for a seed, so a repo with no seed keeps its plain `blocked-on`
     gap and gets the `guard seed --init` hint instead. `guardSetupServiceLabel` renders the
     synthetic key as "seed data" so no surface calls it a third party.
   - **Fingerprint: an explicit `api.seed.script` field, NOT command parsing.** The runtime
     ignores it entirely (`command` is the whole execution contract); `computeRecipeFingerprint`
     hashes the named file's CONTENT, so editing the seed re-authors its dependents exactly as
     editing `provides` does. Parsing the first file-looking argument out of a shell string was
     rejected: a shell command has no reliable file argument (`sh -c`, pipes, `npx tsx`,
     `dotnet run --project`), and a staleness rule that silently guesses wrong is worse than one
     that asks. The proposal writes the field; a missing file or one that escapes the repo folds
     nothing (never throws), so the field is additive for every hand-written recipe.
   - **Verification writes the script at its FINAL path and DELETES it on failure.** It has to
     be the final path: the command names it and the script imports the app's own modules,
     which only resolve inside the tree. An occupied path is refused outright. A rejected draft
     therefore leaves the tree byte-identical — the "temp location" property without a rewritten
     command. Order: `api.services.up` when declared (absent ⇒ the datastore is the user's to
     have running, the same assumption `guard run` makes) → `runSeed` → `preflightApiServer`,
     with an optional GET probe of one blocked flow's parameter-free journey path as a SOFT
     signal only (a 4xx is not a seed verdict; only the boot is). `services.down` runs when the
     stage brought services up. **Interaction with item 67** (recipe verification now does the
     same): each flow is SELF-CONTAINED — discovery's up/down completes before drafting starts,
     `docker compose up -d` is idempotent, and no flow relies on another's bring-up surviving.
   - **ONE evidence retry, kind-blind**, the `recipe-discovery.ts` pattern verbatim: the
     engine's own diagnostic goes back to the model and the replacement is verified in full. A
     manifest that does not match `provides`, a non-zero exit, and a server that will not boot
     afterwards all arrive as the same two fields. A draft that VERIFIES replaces the rejected
     one under the round-1 cache key, so a later run never re-pays the retry.
   - **Grounding is the analyzer's, not the model's guess.** The `JourneyProvider` seam grew a
     `database` half (the same working-tree analysis pass the journeys and the third parties
     come from): the parsed tables/columns/nullability/defaults/PKs + the FK graph, the detected
     ORM, and the app's OWN client import lines (`DATABASE_IMPORT_MAP`-matched, path-tagged) so
     the draft imports the client the way the repo already does. Connection env vars are the
     recipe's own declared names that look like a datastore URL — names only, never values.
   - **Estimate: one `guardSeed` stage, ceiling-costed, gated on the LAST generate's gaps**
     (`spec-estimate.ts`). Deliberately NOT cache-aware and NOT database-probed: both need the
     working-tree ANALYSIS pass, which a pre-flight estimate must not pay for. It therefore
     over-counts by at most one call on a repo with no datastore — which is what a ceiling is
     allowed to do — and the deviation is documented at the call site.
   - **CLI `truecourse guard seed`** (`tools/cli/src/commands/guard-seed.ts`): no flags prints
     the declared seed (command, script + whether it is on disk, what it provides), the flows
     still blocked on missing data, and the last drafting attempt's verdict off `result.json`;
     `--init` runs the same stage standalone over the last generate's gaps, exiting cleanly
     when there are none. Non-interactive, like `guard recipe`. The recipe-shaped gates are
     applied BEFORE the analysis pass, so a refusal costs nothing.
   - Tests: `tests/guard-generator/seed-draft.test.ts` (14), `generate-seed.test.ts` (4),
     `tests/cli/guard-seed.test.ts` (7 — `--init` end to end against the fixture's real
     `schema.prisma`), `tests/guard-runner/recipe.test.ts` (+3 — the script fingerprint fold),
     `tests/core/guard-externals.test.ts` (+2 — the synthetic key), `tests/guard-generator/
     estimate.test.ts` (+1), `tests/dashboard-client/guard-seed-hint.test.tsx` (4). Fixture:
     `tests/fixtures/seed-draft/` — a prisma schema the parsers read, an app file importing
     `@prisma/client`, and a dependency-free server whose store is one JSON file named by an
     absolute-path env var (so the seed and the sandboxed server share it, exactly as a real
     `DATABASE_URL` would). Docker is never used: the `api.services`-absent path is the tested one.
   - **Stage 2 — AST-derived entity requirements (item 61's remaining seeding bullet), NOT built
     here.** Today the draft's "what rows are needed" comes from the blocked claims' own words.
     Stage 2 would read the ROUTE HANDLERS the blocked journeys reach and derive the entity graph
     each one requires (which tables it queries, which columns it filters on), so `provides`
     covers what the code actually reads rather than what the spec sentence mentions. It unlocks
     on telemetry from this stage — specifically, drafts whose fixtures verify but whose flows
     still fail at birth for want of a row nobody named.

67. **The datastore-repo generate: verification runs `api.services`, the no-compose failure is
   guided, and an early abort ticks no phase (three gaps a real run on a Postgres/drizzle repo
   exposed, 2026-07-29).** The bench: an app that runs drizzle migrations at boot, no Postgres
   running, no compose file, no recipe. Both proposers boot-verified against the dead datastore,
   discovery refused, generate aborted `recipe-failed` with the raw migration error and a generic
   "Add or fix recipe.json" — while the CLI ticked "Authoring — 0 tests written" and
   "Birth-validating — 0/0 flows settled" for phases that never ran.
   STATUS: **BUILT 2026-07-29.** As-built decisions:
   - **Gap 1 — `verifyProposal` runs the proposal's `api.services`** (closes item 55 slice 1b's
     recorded deferral). Order is the runner's: install → build → entry probe → `services.up` →
     boot → `services.down`. The execution is the runner's too — `runBuild(repoRoot, cmd,
     proposal.env, DEFAULT_BUILD_TIMEOUT_MS)`, the exact call `run.ts` makes (same spawn shape,
     repo-root cwd, recipe env, same bound), NOT a second implementation. A non-zero `up` is a
     `services …` verdict carrying the command's own output (a missing docker daemon reads as
     what it is), never an "api server did not start"; teardown is best-effort in a `finally`, so
     it runs on a FAILED boot too, and a failing `down` WARNS rather than rejecting a recipe that
     booted.
   - **Only the deterministic proposer can carry `services`, deliberately.**
     `RecipeApiProposalSchema` still has none (item 55 slice 1a: the model never proposes
     orchestration), so `VerifiableProposal` simply verifies whatever the proposal declares —
     one path, both shapes, unchanged behavior for every serviceless proposal.
   - **Item 66 interaction — each flow is self-contained, and that is the rule.** Seed drafting
     brings services up and down itself; so does every `runGuard` (birth validation included).
     Discovery's up/down is fully nested BEFORE either, and `docker compose up -d` is idempotent,
     so a double bring-up is free and nothing tears down a datastore a later phase still needs.
     No cross-flow handshake was added: a shared "who brought it up" flag would make each flow's
     correctness depend on another's teardown.
   - **Gap 2 — the boot failure names the DEPENDENCY when there is nothing to bring up.** A
     lazy `database` provider on `DiscoverRecipeOptions`, riding the SAME memoized journey pass
     `routes` rides (item 63/1b precedent — never a second analysis), resolved ONLY after a boot
     failed and ONLY when the proposal declares no `services`: the reason then leads with "the app
     depends on a database (drizzle-orm/postgres detected) …" plus the three real remedies (start
     it / add a compose file / hand-write `api.services` + the connection env), with the boot
     excerpt underneath. A healthy boot never resolves the provider (no noise, no cost), and a
     proposal that DID bring services up keeps the plain boot message — "start your database"
     would be a lie there. **Item 68 narrowed the middle remedy**: when guard has already GENERATED
     a compose file for this repo and the chain still failed, "add a docker-compose file" is advice
     it just took, so that line names the generated file instead.
   - **A proposer defect the bench exposed: `docker compose up -d` RACES the boot.** `up -d`
     returns when the containers are created, not when Postgres accepts connections, so the
     server's boot migration died anyway on the real bench. The proposer now emits
     `docker compose up -d --wait` (blocks on the compose file's healthcheck; costs nothing when
     there is none — it waits for `running`, which `up -d` already reached). Hand-written recipes
     are untouched; only what the deterministic proposer derives changed.
   - **A related honesty fix, found while wiring it.** When the deterministic proposal fails and
     the model fallback is UNREACHABLE, the transport error used to replace the engine's own
     diagnostic. Now the deterministic report (the actionable one) leads and the transport failure
     is a parenthetical footnote.
   - **Gap 3 — an early abort ticks no phase that never ran, fixed at the SOURCE.** The phantom
     lines were not the CLI printing a static list: `guardGenerateInProcess` marked every remaining
     step `done` after the generator returned, so `no-docs` / `recipe-failed` closed `author` with
     "0 tests written" and `validate` with "0/0 flows settled". Those two statuses now mark the step
     the run died in as `error` (the reason's first line) and leave every later step PENDING. The
     dashboard consumes the same steps payload, so its popup inherits the fix; the abort still
     persists `guard/result.json` exactly as before.
   - **CLI.** The `recipe-failed` printer renders a multi-line reason multi-line (headline + indented
     detail) through the exported `recipeFailureLines`, mirroring the entry-preflight printer.
   - Tests: `tests/guard-generator/recipe-services.test.ts` (14 — services up/down ordering, the
     step-naming diagnostics, teardown on a failed boot, a warning-only teardown failure, the
     detected-database guidance and its four negative cases, the once-only detector resolution, and
     a serviceless LLM proposal unaffected end to end) and `tests/cli/guard.test.ts` (+4 — both
     early-abort paths' step statuses, `recipeFailureLines`). No docker anywhere: `services.up` in
     the fixtures provisions a FILE the fixture server refuses to boot without — the same causal
     shape, offline.

68. **The datastore is GENERATED — a compose file derived from the app's own connection URL
   (user directive 2026-07-29; closes the last manual step item 67 left).** Item 67 made the
   datastore repo's failure honest: "add a docker-compose file with the datastore — guard proposes
   `api.services` from it". That advice is a human writing down what the app ALREADY says. On the
   `speced-api` bench the whole datastore is one literal — `DATABASE_URL:
   'postgres://localhost:5432/weather'` in the config defaults map — which names the engine, the
   port, the database, and (through item 63's env association) the variable that overrides it.
   Discovery now turns that literal into the container, the `api.services` that runs it, and the
   `api.env` that points the app at it, verifies the whole chain (compose up → migrate → boot →
   `/healthz`), and writes both artifacts behind the same review-and-commit gate.
   STATUS: **BUILT 2026-07-29.** As-built decisions:
   - **The URL harvest is item 63's pass, one scheme set wider.** `extractExternalHttp` already
     walks every string literal and answers "which env var is this URL the fallback for"; datastore
     URLs ride the SAME walk and the SAME two association tiers into a new
     `FileAnalysis.datastoreUrlRefs` (`{url, scheme, envVar?, location}`). They are deliberately
     NOT mixed into `externalHttpRefs`: nothing is REQUESTED from a datastore, its host is the
     machine itself, and item 63's exclusion list drops localhost on purpose. The one-URL rule is
     now per-FAMILY (http literals compete with http literals), which is what lets
     `{API_URL: 'https://…', DATABASE_URL: 'postgres://…'}` bind both keys. JS/TS only, the same
     recorded follow-up item 63 carries.
   - **Derivation is PURE and lives apart** (`packages/guard-generator/src/datastore-compose.ts`).
     No probing at propose time — in particular a port collision is NOT checked: probing would make
     the proposer environment-dependent, and verification finds the collision honestly (`services`
     fails with docker's own message). The proposer HANDS the file out; discovery writes it.
   - **The portable derivation: a neutral user in the compose AND the explicit URL in `api.env`.**
     `postgres://localhost:5432/weather` names no user, so at runtime it resolves to the OS user —
     different on every machine. A compose pinned to the PROPOSING machine's user would break every
     teammate who pulls the committed file. So the compose pins `POSTGRES_USER: guard` and the
     recipe carries `api.env.DATABASE_URL=postgres://guard@localhost:5432/weather`: deterministic
     everywhere, and the recipe states the truth. `api.env` is emitted ONLY when the derivation had
     to deviate — a URL that already carries credentials is honored verbatim and needs no override,
     and mongo/redis (which run open by default) need none either. A URL that needs an override and
     has NO env var bound to it is a refusal, not a guess.
   - **A secret is never invented.** No password in the URL ⇒ `POSTGRES_HOST_AUTH_METHOD: trust`
     (a throwaway loopback datastore is what that is for); mysql's image refuses a `MYSQL_USER`
     without a password, so a credential-less mysql URL is served by root with an empty password
     and a URL naming a user but no password is REFUSED outright. Credentials that ARE in the URL
     are carried into the image's own variables.
   - **A DISTINCT filename, `docker-compose.guard.yml`, and it is the user's the moment it lands.**
     Squatting on `docker-compose.yml` would overwrite a file people have opinions about. The
     generated file carries a header saying what it is and which connection URL it came from, a
     pinned image per engine (`postgres:16-alpine`, `mysql:8`, `mariadb:11`, `mongo:7`,
     `redis:7-alpine`), the app's own port mapping, and a real healthcheck — without which
     item 67's `--wait` waits for nothing. No `restart:` policy: a throwaway test datastore that
     resurrects itself on reboot is not what anyone asked for.
   - **Written BEFORE verification, restored on failure.** `services.up` names the file by path, so
     it must exist at its final path (item 66's seed-script precedent). A rejected proposal deletes
     it — or puts back the exact bytes of an orphan from an earlier refused run — leaving the tree
     byte-identical. An existing guard compose that a recipe ALREADY runs is never rewritten: by
     then it is a reviewed, committed artifact, so `--refresh` re-proposes the same `services`/`env`
     and leaves the file (and any human edits to it) alone.
   - **Gating is four conditions, and every miss falls back to item 67's message unchanged.** An
     `api` proposal, no datastore in the repo's OWN compose files, at least one local connection URL
     harvested, and a derivable engine. Remote URLs are SKIPPED rather than fatal (a deployment
     default or a test double says nothing about the local datastore — the bench has exactly such a
     literal in its test helpers); an unmapped scheme on a LOCAL url IS fatal, because that is the
     repo's datastore and guard cannot build it. Two local URLs of one engine are resolved by the
     env binding (the configured one wins) and refused when that does not decide.
   - **The item-67 message gained one line, only when it is true.** When guard GENERATED a compose
     and the chain still failed, the middle remedy becomes "fix what stopped the
     `docker-compose.guard.yml` guard generated from this app's own connection URL" — advising
     someone to add a compose file guard just wrote would be noise. A run that generated nothing
     prints item 67's text verbatim.
   - **The compose file folds into the recipe fingerprint** (`FINGERPRINT_INPUTS`). Editing the
     datastore changes the world scenarios ran against exactly as editing the recipe does. Hashed
     only if present, so every repo without one keeps the fingerprint it had. The user's OWN compose
     files are deliberately not folded — they are the repo's, they move for reasons unrelated to
     guard, and a recipe that runs one already folds that command.
   - **Both artifacts are named where the recipe is reported.** `guard generate` and
     `guard recipe --init/--refresh` (which inherit this automatically — one `discoverRecipe` path)
     print "review and commit BOTH", and the pinned-user deviation is a TODO line naming the exact
     `DATABASE_URL` the recipe now sets. The compose file lives at the REPO ROOT, not under
     `.truecourse/`, so nothing in the `.truecourse/.gitignore` template changes — the README says
     it is committable.
   - **ACCEPTANCE, on the real `speced-api` bench** (a scratch copy; the working tree untouched):
     discovery derived `docker-compose.guard.yml` + `api.services` + `api.env.DATABASE_URL`, brought
     Postgres up with `--wait`, the app ran its drizzle migrations at boot and answered `/healthz`,
     verification passed, `down` tore the container back down, and both artifacts were written. A
     `--refresh` over the result re-proposed the same services and left a hand-edited compose file
     byte-identical.
   - Tests: `tests/analyzer/datastore-urls.test.ts` (10 — the harvest, both association tiers, the
     per-family one-URL rule, template heads, the scheme set, the collector), `tests/guard-generator/
     datastore-compose.test.ts` (18 — the neutral-user + explicit-URL derivation, credentialed URLs,
     ports, multi-engine, every refusal, and the proposer's four gates),
     `tests/guard-generator/recipe-generated-datastore.test.ts` (6 — write-before-verify,
     delete-on-failure, orphan restore, the guided-message change and its negative, `--refresh`),
     `tests/guard-runner/recipe.test.ts` (+2 — the fingerprint fold and the not-folded own compose),
     `tests/cli/guard-recipe.test.ts` (+1 — `--init` naming both artifacts). No real docker: a stub
     `docker` first on PATH stands in for the daemon and asserts the compose file was on disk when
     `up` ran.

69. **Scenario authoring is GROUNDED IN EXTRACTED CODE TRUTH — the request surface the app
   actually has (user directive 2026-07-29).** The top failure class across every real bench run,
   measured on `speced-api` over three consecutive `guard generate` runs: the model authors
   scenarios that are right about the CLAIM and wrong about the APP, so the scenario dies before
   the claim under test is ever exercised. Three shapes, all the same root cause — the prompt
   described the world in prose and never in the app's own source:
   (a) **stub payload fidelity (5 failures per run, all three runs)** — scenarios stub the
   upstream with `setup.http` and script Open-Meteo's DEFAULT response (`current.time:
   "2026-07-17T14:00"`), while the app sets `timeformat=unixtime` on its outbound request and
   validates every observation field as a finite NUMBER; the app rejects its own stub and answers
   502; (b) **inbound body fidelity** — a setup step signs up with `{email, password}` and the
   app's body validation also requires `name` → 400; (c) **path fidelity** — two scenarios
   invented routes and got `not_found` on step 1, with the exact paths sitting in the journey
   catalog the whole time.
   STATUS: **BUILT 2026-07-29.** Three grounding feeds, all additive, all off the ONE journey
   mapping pass generate already runs. As-built decisions:
   - **The outbound anchor is `new URL(path, base)`, not the transport**
     (`packages/analyzer/src/extractors/outbound-requests.ts`, the item-63 extractor
     conventions). The `fetch` is routinely one indirection away in a shared client module (it
     is on the bench: `src/upstream/client.ts`), while the URL construction sits in the SAME
     function as the query the app sets and the response fields it reads. Harvested: the path
     literal, every `searchParams.set('k', v)` with a literal KEY (value verbatim, or
     `<dynamic>` — the key is the assertable fact either way), the method + literal headers of a
     `fetch` in the same function, and the response property names read off the parsed payload.
   - **Response reads follow a bounded ALIAS CHAIN, and hints are only what the source itself
     checks.** The root is the value an `await` produced (`await res.json()` when the file does
     its own transport, else the first awaited call's result — the shared-client idiom); from
     there `const current = payload['current']` makes `current` mean `current`, so
     `asFiniteNumber(current['time'])` is `current.time (number)`. A hint is recorded ONLY for a
     locally-applied wrapper (matched on the callee's NAME split into words, so `asFiniteNumber`
     resolves and a type-checker is never needed), a `typeof x === 'string'`, an
     `Array.isArray(x)` or an `isRecord(x)`. **A function that builds TWO URLs attributes response
     fields to NEITHER** — nothing in the source says which payload belongs to which. `.length`,
     `.constructor` and method calls are JavaScript, not payload fields, and are dropped.
   - **A `new URL` is not always a REQUEST.** `new URL('../../drizzle', import.meta.url)` resolves
     a file next to the module (the bench does exactly this); an outbound request writes an
     absolute path or an absolute origin, and anything else is addressing something local.
   - **Inbound contracts hang off the ROUTE, with exactly ONE indirection**
     (`packages/analyzer/src/extractors/request-contracts.ts` → additive
     `RouteRegistration.requestContract`). Three direct sources: a `z.object({…})` parsed from
     `req.body` (keys carry their own requiredness), a `if (!req.body.x) → 400` guard (which makes
     the field REQUIRED, verbatim from the code), and plain reads/destructuring (which prove only
     that it is READ). The indirection is where real apps keep this: a handler that hands
     `req.body` to `parseSignupBody` records the SYMBOL, and every top-level function whose first
     parameter is read as a record is harvested per file as a `RequestValidator`, so the join can
     resolve it. **`required` is a three-valued answer** — `true` | `false` | `'unknown'` — because
     "we did not look" and "it is optional" are different claims and a scenario author must be
     able to tell them apart; nothing is ever guessed to `false`.
   - **Requiredness for a hand-written validator comes from its DECLARED RETURN SHAPE.** The
     bench's `parseSignupBody(body: unknown): SignupBody` + `interface SignupBody { email; name;
     password }` is the app's own written statement of what a valid body contains — the only
     requiredness signal a hand-written validator reliably leaves behind, and the one that makes
     the (b) failure impossible. Fields READ but absent from the shape stay `'unknown'`.
   - **Two precision gates the bench itself forced, both recorded as rules.** (1) A field-accessor
     call names a field only when the callee READS like one (`readString(record, 'email', …)`),
     else any two-argument helper would invent fields out of its own options. (2) An accessor's
     RESULT is never another handle on the record — only a call whose callee NAMES a record
     (`asRecord(body)`) aliases it. Without (2) the bench emitted `trim` and `length` as request
     fields, which a scenario author would have dutifully tried to send.
   - **The join is operation-keyed and lives in the MAPPER**
     (`packages/journey-mapper/src/api-contracts.ts`), because it must compose the mount prefix
     and apply `canonicalRoutePath` EXACTLY as `deriveApiJourneysFromTree` does or the
     per-journey lookup silently misses. `ALL` routes are skipped for the same reason journeys
     skip them. Cross-file validator resolution is by NAME (first by file/line wins — naming one
     validator twice is the repo's ambiguity, not a reason to drop the contract). The product is
     `ApiRequestContract[]`, and like `externalServices` it is **never snapshotted**: a fact about
     the working tree, re-derived every mapping.
   - **Both artifacts ride the EXISTING `JourneyProvider` seam** (`requestContracts`,
     `outboundRequests`), the items 57/63/68 precedent — one analysis pass, now five products, and
     no second seam that could re-analyze. Omitted (an older provider, the snapshot fallback) reads
     as "not detected" and renders no block.
   - **Prompt: two per-repo USER blocks, three static RULES in the system prompt.**
     `OPERATIONS THIS FLOW WALKS` lists the flow's own journeys — the exact path even when the
     repo declares no contract, because the path IS the grounding for (c) — with
     `body requires …; also reads …` per operation. **AMENDED by item 70:** the flow's own
     operations were not enough — a flow's SETUP steps routinely need an operation no milestone
     of it names (the favorites flow has to sign up and sign in), and the "a path not listed
     does not exist" rule then pushed the model into inventing one. A SECOND block,
     `OTHER OPERATIONS AVAILABLE (for setup steps — same verbatim-path rule)`, carries the rest
     of the api catalog with the same rendering, and the verbatim rule now spans both. `OUTBOUND REQUESTS THIS APP MAKES` lists the
     app's own request construction with its literal query values and typed response reads. The
     service attribution is honest: by literal host or by base-URL env var, and **an unresolved
     base is rendered unattributed rather than guessed onto the repo's only vendor** (which is what
     the bench gets — its base arrives as a function parameter). Caps: 8 requests, 14 params, 20
     fields, each truncation stating its count.
   - **`GENERATE_API_PROMPT_FINGERPRINT` ROLLED `2ee951b99e6d078b` → `0c9355770abf5b68`** (three new
     authoring RULES: paths verbatim from the listed operations, bodies carrying every required
     field, and a stub whose response satisfies the fields the app reads). Api sections re-author
     once — which is exactly how the three failure classes convert. The pin in
     `tests/guard-generator/prompts.test.ts` carries the reason.
   - **KNOWN LIMIT, the item-57 one, unchanged:** the authoring cache key is composed of the flow,
     surface, section keys, journey fingerprints and recipe fingerprint — NOT the prompt text — so
     editing the app's request construction does not by itself re-ask a cached authoring answer.
     Accepted rather than invalidating every api cache entry on any source change; the fingerprint
     roll above re-asks every api section once regardless.
   - **Estimate: unchanged, and confirmed.** No new LLM call, no new stage — the grounding is a
     pure read of a pass that already runs, so the pre-flight token/cost numbers are identical.
   - **ACCEPTANCE, validated against the REAL `speced-api` working tree** (read-only, extraction
     only via a scratch script — no `guard generate`, no LLM spend). The forecast upstream renders
     `query: latitude=<dynamic>, longitude=<dynamic>, current=<dynamic>, timezone="auto",
     timeformat="unixtime", temperature_unit=<dynamic>, …` and `reads: current (object), timezone
     (string), latitude (number), longitude (number), current.time (number),
     current.temperature_2m (number), … current.weather_code (number), …` — the two facts whose
     absence produced the (a) failures. The signup operation renders
     `POST /v1/auth/signup — body requires email, name, password`, resolved through the
     cross-file `parseSignupBody` → `SignupBody` chain — the fact whose absence produced (b). All
     six of the repo's non-`ALL` operations carry their exact paths, closing (c).
   - **FOLLOW-UP — Python and C# parity**, the same recorded follow-up items 63/68 carry: both
     passes are JS/TS only, so those repos keep the ungrounded prompt they had, which reads as
     "not looked at", never "has no contract".
   - Tests: `tests/analyzer/outbound-requests.test.ts` (12 — the bench forecast shape, the alias
     chain into an array payload, fetch method/headers, absolute-literal host, the env-read base,
     the two-URL abstention, the filesystem `new URL`, the non-JS/TS no-op, and the collector's
     dedup/order/drop rules), `tests/analyzer/request-contracts.test.ts` (12 — reads,
     destructuring, guards, zod, query-vs-body, the validator SYMBOL, a named handler behind
     middleware, and the validator harvest incl. the declared/inline return shape and the two
     precision gates), `tests/journey-mapper/api-contracts.test.ts` (5 — the cross-file
     resolution, operation identity matching the journeys', mount composition +
     canonicalization, `ALL`/empty skipping, and the merge of two registrations),
     `tests/guard-generator/grounding.test.ts` (12 — both joins, the attribution rules and the
     no-guess rule, every cap, both prompt blocks, the absent-data and cli byte-identical
     negatives, and the end-to-end wiring through `generateGuards`' provider seam).

70. **The api surface owns the SERVER PROCESS — lifecycle steps, setup operations, and the
   off-catalog carve-out (user directive 2026-07-29).** Measured on `speced-api`: 9 of 10
   scenarios passed, and everything the run could NOT reach had one of three causes. (a) The
   favorites flow needs an account and signup/signin are nobody's milestone, so the item-69
   `OPERATIONS THIS FLOW WALKS` block listed neither, the verbatim-path rule said a path not
   listed does not exist, and the model invented `/v1/auth/register` → 404 on step 1 (the one
   failing scenario). (b) TEN blocked-on claims were all process-surface — starts with default
   env, invalid env → non-zero exit + stderr, migrations at boot, one stdout line per request,
   graceful SIGTERM/SIGINT exit 0, persistence across a restart — and all settled
   `blocked on a recipe \`entry\`` on a repo with no CLI at all. (c) One `unrealizable` flow was
   the 404/405 contract for unlisted paths and unsupported methods — a claim the verbatim-path
   rule forbade the model from ever authoring.
   STATUS: **BUILT 2026-07-29.** As-built decisions:
   - **Extend the API driver, do not build a third one.** The api driver already spawns the
     server, health-checks it, captures its output and kills its tree; what was missing was
     scenario-VISIBLE control. A "process driver" would have duplicated the sandbox, the
     services, the credentials, the stubs and the evidence bundle to gain nothing — and the
     restart-persistence claim needs the process AND the requests in ONE scenario, which two
     drivers cannot give. `entry`-based cli was rejected for the same reason plus a real one:
     the cli driver is run-to-exit, so it cannot hold a server and observe it.
   - **Three step kinds, one action each, all additive — no `GUARD_FORMAT_VERSION` bump**
     (item 49/58 precedent). `GuardApiStepSchema` becomes a `z.union` over the (unchanged)
     request step plus `boot` / `signal` / `logs`; every consumer went through the exported
     `isApiRequestStep` guard rather than a new field, so a request-only scenario parses,
     renders and runs byte-identically.
   - **`boot: { env?, expect? }`.** `expect.ready` (and an omitted `expect`) demands health;
     `expect.exitCode`/`stderrContains` demand an EXIT within the recipe's ready budget — the
     two are refused together, because a process cannot serve traffic and be dead. `env` is an
     OVERLAY over the recipe env and `setup.env`, resolved per boot with `${unique}` and
     `${HTTP_STUB:…}` exactly as `setup.env` is; there is deliberately **no removal channel**
     (a variable the recipe sets is always set — the bench's "default env" claim is about
     defaults for variables the recipe does not set, and a delete would silently break the
     datastore URL every scenario needs).
   - **`logs` is a STEP, not an `expect` field.** Reading the server's output is an ACTION with
     its own timing: the log line lands when the response finishes, which is after the request
     step settles, so an expect-side matcher would have raced its own step. As a step it also
     gets a bounded WAIT (poll to `withinMs`) and an honest window word — `sinceLastStep` means
     "since the previous step began", which is exactly "what the step before produced". Matching
     is per LINE on RAW output: `normalize` is NOT applied, because a duration or timestamp in
     the line is usually the very thing the claim is about. `count` makes "exactly one line per
     request" sayable; a `count: 0` is checked immediately and is therefore an assertion about
     what has appeared SO FAR (the one soft edge, documented).
   - **A scenario with no `boot` keeps the implicit boot; one with a `boot` owns the
     lifecycle.** Back-compat by construction. A request or `logs` step with no running server
     is an `error` (a scenario defect), never a silent pass.
   - **Failure semantics follow the house rules, with ONE deliberate split**: an unmet
     expectation on an EXPLICIT boot (never became healthy, wrong exit code, missing stderr
     line) is a `fail` with the process output excerpted — the claim really is false — while a
     child that could not be SPAWNED is an `error`, because a process that never existed cannot
     have had its readiness judged. `StartApiServerResult` gained `spawnFailed` so the two are
     told apart by a field, not by sniffing a message. The IMPLICIT boot's failure stays an
     `error`, unchanged.
   - **The server handle became a seam** (`packages/guard-runner/src/api/server.ts`):
     `spawnApiProcess` + `awaitApiServerReady` compose into the unchanged `startApiServer`, and
     the handle exposes `signal` / `waitForExit` / `exit`. One spawn path, so a `boot` step and
     the implicit boot cannot drift. The runner ACCUMULATES every boot's output, so a restart's
     earlier lines stay matchable and the evidence bundle's `server.stdout.txt` carries both
     boots — the previous behavior would have shown only the last process.
   - **Restart persistence works because the sandbox and the services already outlive a boot**:
     the sandbox cwd is per SCENARIO, and `api.services` (the compose datastore) is run-scoped.
     Verified on the bench: signup → SIGTERM (exit 0) → boot → signin succeeds, and the negative
     control (signing in as an address never signed up) 401s. Each boot allocates a FRESH port,
     so `${PORT}` re-substitutes per boot (Phase 1a made substitution per-spawn; a test asserts
     two boots resolve two ports).
   - **The blocked-on gaps came from the EXTRACT prompt, not from matching.** `blocked on a
     recipe \`entry\`` is emitted for a claim whose DRIVER is `cli` on a repo whose recipe has no
     `entry` — so the fix is the driver table: the `api` row now covers the service process
     (startup under a configuration, a failed start, boot migrations, what it writes while
     serving, shutdown, restart persistence), with the line that keeps a package script on
     `cli`. The MATCH prompt gained the companion rule, because journeys are entry points and a
     lifecycle milestone has no journey of its own: it is planned against the journey it is
     observed THROUGH, rather than settling `unrealizable`.
   - **`npm test` / `npm run typecheck` stay honestly blocked, and both prompts say so.** They
     are run-to-exit package scripts — a DIFFERENT program from the service — so bending the cli
     driver (or the api one) to reach them would have been the workaround this plan forbids.
   - **The off-catalog carve-out is scoped to the CLAIM, not to a flow flag.** Authoring may
     request a path outside both operations blocks (and an unsupported method on a listed path)
     when the claim ITSELF is about unknown-path / wrong-method handling; every other step keeps
     the verbatim rule. No runner change — a request has always been arbitrary — and matching
     now says such a milestone is realizable on `api` (the catalog lists what EXISTS; the claim
     is about what happens off that list).
   - **Fingerprints rolled, and the extract one is the expensive one.** api authoring
     `0c9355770abf5b68` → `3cefaf933bdac9a8` (the union entered the canonical schema) →
     `537f94485d73cd2e` (setup operations + carve-out) → `e2db27a355e37c1d` (the lifecycle
     rules); match `57830535ea5d67b2` → `f324094df3ba87fa` → `df2d1a56fb52b946`; extract
     `bf102597e1e53068` → `87fe2fdd9881b428`, which re-extracts EVERY doc of every repo once.
     That is the price of the ten claims changing surface, and it is the point.
   - **Estimate: unchanged.** No new stage and no new call — the setup-operations block is
     another pure read of the mapping pass that already runs, and the lifecycle steps are a
     runtime capability.
   - **ACCEPTANCE, validated against a scratch copy of the real `speced-api` working tree with
     the real docker Postgres** (hand-written scenarios, `runGuard`, no LLM spend): (a) invalid
     `UPSTREAM_TIMEOUT_MS` → exit 1 with `Configuration error: UPSTREAM_TIMEOUT_MS must be an
     integer, got: not-a-number` on stderr; (b) SIGTERM → exit 0, and its `received SIGTERM,
     shutting down` line, then SIGINT → exit 0 on a second boot; (c) `^GET /healthz 200
     [0-9.]+ms$`, exactly ONE line, scoped to the request step; (d) signup → SIGTERM → boot →
     signin, proving the Postgres-backed state survived; (e) `/v1/nope/does-not-exist` → 404
     `not_found` and `DELETE /v1/weather` → 405 `method_not_allowed` with `Allow: GET`. All five
     pass; two negative controls (wrong exit code, an address never signed up) fail as they
     must.
   - **KNOWN LIMITS.** No `boot.env` REMOVAL; a `logs` `count: 0` is a point-in-time assertion;
     log matching does not normalize; and the whole surface is JS/TS-agnostic but the item-69
     grounding feeding it is still JS/TS only (the same recorded follow-up).
   - Tests: `tests/guard-runner/api-lifecycle.test.ts` (28 — every step kind's happy, mismatch
     and infra path, implicit-boot back-compat, the env overlay's two layers, two boots on two
     ports, the log windows incl. `sinceLastStep`, the signal timeout, restart persistence, and
     the evidence rows), `tests/shared/guard-scenario-lifecycle.test.ts` (9 — the union, both
     exclusions, every matcher form, and the step view), `tests/guard-generator/grounding.test.ts`
     (+6 — the other-operations join, its cap, the prompt block, and the end-to-end wiring),
     `tests/guard-generator/prompts.test.ts` (+4 — the setup-operations rule, the carve-out, the
     lifecycle rules, and the two matching rules, plus all four pins).

71. **A repo's OWN hosts are not third parties — wire `ownHosts` (live false positive,
   cal.com bench 2026-07-30).** On the cal.diy bench the item-63 URL harvest read cal.com's
   own production URLs — written as env-var fallbacks (`NEXT_PUBLIC_WEBAPP_URL` →
   `https://app.cal.com`, `CALCOM_PRIVATE_API_ROUTE` → `goblin.cal.com`, …) — as a
   third-party service named `cal`, which then "blocked" 32 flows with a Needs-setup label
   demanding the user provide an account for their own app. Item 63 had already designed the
   answer (`detectExternalServices(files, { ownHosts })`, subdomain-inclusive) but NO caller
   ever passed it — a dead option. STATUS: **BUILT 2026-07-30.** As-built decisions:
   - **The recipe is the source, two layers.** (1) An explicit top-level `ownHosts` field in
     `recipe.json` (bare hosts or full URLs, normalized to the bare lowercase host) — the
     user's declaration, needed because a company's estate spans domains detection cannot
     infer (cal.com also owns cal.dev / cal.ai / cal.eu / calendso.com). (2) Auto-derivation
     with zero config: an env var the recipe's `env`/`api.env` PINS whose URL fallback the
     tree writes down (`process.env.X ?? 'https://…'`, the item-63 `envVar` association) marks
     that fallback's REGISTRABLE DOMAIN as owned — the variable exists so a deployment can
     point the app at itself, and the recipe controls it besides. Widening to the registrable
     domain is deliberate: one controlled base-URL variable proves the whole domain is the
     product (`app.` beside `console.` beside a bare marketing link), matching detection's own
     grouping key. Variables an `api.externals` entry owns (`baseUrlEnv`/`endpoints`/`env`)
     are carved OUT of the derivation — a declared external's variable points AWAY from the
     app by definition (`recipeControlledEnvVars`, guard-runner).
   - **Wired at the single call site.** `journey.service.ts` (`repoOwnHosts`) loads the recipe
     (absent/invalid ⇒ empty list, detection reports every host exactly as before) and feeds
     `deriveOwnHosts` (analyzer) into `detectExternalServices`. Downstream needed NOTHING:
     the fake service never exists, so `external-blocked` composition and the needs-setup
     read-model heal for free. `ownHosts` is a committed recipe field, so it enters the recipe
     fingerprint whole — declaring a host re-authors the sections it used to block, exactly
     like declaring an external.
   - **Root-caused a second contributor:** an UNinterpolated template literal
     (`` `https://console.cal.com` ``) kept its closing backtick through the item-63 harvest,
     yielding a host (`console.cal.com` + backtick) that dodged both the ownHosts match and
     domain grouping. `literalText` (external-http.ts) now strips it for http and datastore
     literals alike.
   - **Validated against cal.diy** (scratch script over the real tree, 4590 files, no store
     writes): with `ownHosts: ["cal.com","cal.dev","cal.ai","cal.eu","cal.diy","calendso.com"]`
     in its recipe, services `cal` and `calendso` disappear; 80 genuine third parties remain.
     Related-but-separate harvest defects observed there and NOT in scope: truncated template
     heads minting junk vendors (`https://accounts.zoho.` → `accounts`, `calendar`, bare
     `https://www.` → `www`) and fixture/example URLs (`amazonaws` from a test literal).
   - **Follow-ups, recorded not built:** `guard init` recipe proposal could pre-fill
     `ownHosts` (e.g. from `package.json` `homepage`/repo metadata); the dashboard External
     APIs surface could offer "this is our own host" as a dismissal that writes the field.
   - Tests: `tests/analyzer/external-http.test.ts` (+4 — declared-host normalization, the
     controlled-env derivation incl. the not-controlled and no-envVar negatives, the
     detection round-trip, the backtick strip), `tests/guard-runner/recipe.test.ts` (+3 —
     the field loads, the empty-entry reject, `recipeControlledEnvVars` union + externals
     carve-out), `tests/core/journey.service.test.ts` (+3 — pre-fix baseline, the pinned-env
     drop, the explicit-declaration drop).

72. **Workspace serve commands need the repo cwd — `api.cwd` (live failure, cal.com bench
   2026-07-30).** Every api boot on cal.diy died identically: the runner boots the server in
   the per-scenario SANDBOX temp cwd (deliberate — fresh cwd state per scenario), but
   `yarn workspace @calcom/web start` from a temp dir finds no workspace root, and corepack —
   seeing no `package.json` with a `packageManager` pin — downloads yarn CLASSIC against
   cal.com's yarn berry ("Cannot find the root of your workspace"). Every birth candidate
   errored at step zero; zero scenarios written. The class is any monorepo whose serve argv is
   package-manager-mediated (`yarn workspace` / `pnpm --filter` / `npm run`).
   STATUS: **BUILT 2026-07-30.** As-built decisions:
   - **An opt-in recipe field, `api.cwd: "sandbox" | "repo"`, default `sandbox`.** The default
     is the behavior every existing recipe had — a file-state app (sqlite in cwd) keeps its
     per-scenario isolation; nothing an existing recipe says changes what happens to it.
     `repo` moves ONLY the server process to the repository root: every boot path (the implicit
     boot, `boot`-step reboots incl. expect-exit spawns, the run preflight, and the seed-draft
     verification boot) honors it, while `setup.files`, capabilities, evidence, and the cli
     driver stay sandbox-rooted. A recipe field, so it enters the fingerprint whole.
   - **Threaded, not defaulted, at each seam:** `RunApiScenarioContext.serveCwd` (one
     `bootCwd` derivation at sandbox creation covers all three boot sites),
     `ApiPreflightOptions.cwd` (absent ⇒ sandbox, exactly as before), `run.ts` passes both
     from the loaded recipe; `seed-draft.ts` passes the preflight cwd. The recipe-DISCOVERY
     preflight is deliberately untouched: it verifies an LLM *proposal*, and proposals do not
     propose `cwd` (a recorded follow-up if the proposer ever meets a workspace repo).
   - Tests: `tests/guard-runner/api-run.test.ts` (+1 — a cwd-reporting server under
     `api.cwd: "repo"` answers with the repo root, end to end through `runGuard`),
     `tests/guard-runner/recipe.test.ts` (+1 — accepts repo/sandbox, absent default, rejects a
     path). The existing per-scenario isolation test pins the sandbox default.

73. **The sandbox HOME made corepack re-download the package manager on every boot
   (live observation, cal.com bench 2026-07-30).** Scenario children run with HOME
   redirected into the per-scenario sandbox (hermeticity, by design) — but corepack
   resolves its cache under HOME (`os.homedir()` reads `$HOME`), so every server boot of
   a corepack-managed serve argv re-downloaded the pinned yarn ("! Corepack is about to
   download …" on every boot's stderr): a network dependency per scenario, seconds of
   overhead, and noise riding failure evidence. STATUS: **BUILT 2026-07-30.** Fix in
   `constructChildEnv`'s sandbox branch: `COREPACK_HOME` points at the HOST's cache
   (`$COREPACK_HOME`, else the corepack default under the real home) — a tool-BINARY
   cache, not user config, shared for the same reason PATH passes through. The build
   `passthrough` path already carried it via the real HOME. Test:
   `tests/guard-runner/child-env.test.ts` (+1 — the sandbox env's COREPACK_HOME is the
   host's, never under the sandbox home).

74. **Birth findings must survive a generate that did not re-run them (live loss, cal.com
   bench 2026-07-30).** `guard/result.json` is overwritten wholesale per generate, and the
   dashboard's flow-join sources a birth-stage row's failure detail EXCLUSIVELY from the last
   report's `birthFindings` — so a cached/no-op regenerate (0 authored) wrote
   `birthFindings: []` over 39 recorded failures, and every committed red test's detail page
   went blank: "Failing (birth)" from the manifest, no expected/actual, no evidence link
   (the transcripts still on disk under `guard/evidence/`, unreferenced). This violated the
   schema's own contract — "one per COMMITTED failing test" — which described the invariant
   but nothing enforced it. STATUS: **BUILT 2026-07-30.** As-built:
   - **Carry-forward at persist, not a second store.** `carryForwardBirthFindings` (shared,
     `guard/report.ts`, pure): a PRIOR finding survives into the fresh report iff the
     manifest still lists its scenario as `failing` AND this generate produced no fresh
     finding for it AND did not re-write it (a re-authored test's truth is its own fresh
     birth). `fidelity` rejections are per-generate advisories about never-committed
     candidates — never carried. Applied in `persistGuardReport` (guard-in-process, both the
     completed and the no-docs/recipe-failed write sites; prior read before the write).
   - Reads need NOTHING: guard-read's `birthFailureById` join and the dashboard render
     as-is once the findings stop vanishing. Evidence paths may 404 after a clone
     (`guard/evidence/` is gitignored) — the existing `hasEvidence` semantics already say
     "the run wrote one", not "it is here".
   - Recovery note: findings already wiped before this fix are not resurrected (the prior
     report is gone); a `guard run` rebuilds the detail at run-stage for every committed test.
   - Tests: `tests/shared/guard-birth-carry-forward.test.ts` (3 — the carry, the
     fresh/re-written/now-passing/deleted drop-outs, the fidelity + null no-ops).

75. **Multi-server recipes — `api.servers` (live failure, cal.com bench 2026-07-30).** A
   recipe could name exactly ONE HTTP server (`api.serve`), so a workspace shipping two
   services was only ever half testable. On the cal.com bench 30/39 api scenarios died on
   Next.js HTML 404 pages: the recipe declared `yarn workspace @calcom/web start` while
   `docs/api-reference/v2/openapi.json` and `agents/skills/calcom-api/references/*.md`
   document `apps/api/v2` — a service no recipe field could even name. Every one of those
   failures was a false report about the app, produced by a gap in the recipe.
   STATUS: **BUILT 2026-07-30** (schema + resolver + runner + authoring surfaces; the
   generate-time SERVER STAMPING and per-app operation filtering landed with item 76).
   As-built:
   - **Schema** (`packages/guard-runner/src/recipe.ts`): `RecipeApiServerSchema`
     (`serve`, `cwd`, `healthPath`, `readyTimeoutMs`, `env`, `app`, `description`) under
     `api.servers` (name → server, names `[a-z0-9][a-z0-9._-]*`) plus `api.defaultServer`
     and the single-server shape's own `app`. `api.serve` became optional and the two
     shapes are EXCLUSIVE (a superRefine, with the api-level `serve` companions —
     `cwd`/`healthPath`/`readyTimeoutMs`/`app` — refused beside `servers`; api-level `env`
     stays, it is the SHARED layer). `defaultServer` is REQUIRED past one server (R1) —
     with two services there is no obvious default, and a wrong guess is a silent
     mis-route. Credentials (declared and seed-provided) gained a `servers` allowlist and
     `fromRequest` a `server` (R8); every name is validated against the declared set.
   - **One resolver seam.** `resolveApiServers(recipe)` collapses BOTH shapes into
     `Map<name, ResolvedApiServer>` + `defaultServer` (a legacy `api.serve` yields one
     server named `default`), with the boot defaults applied and env layered
     `recipe.env ⊕ api.env ⊕ server.env`. `resolveScenarioServer(scenario, resolved)`
     returns the bound server or the actionable reason. Nothing downstream branches on
     the recipe shape again — `run.ts`, `guard-read`, `seed-draft`, the CLI printer and
     `generate.ts` all read the resolver.
   - **Scenario binding.** `GuardApiScenarioSchema.server?` (additive optional, NO
     `GUARD_FORMAT_VERSION` bump — the `journeyDrifted` precedent); absent means the
     default server, which is exactly what every pre-existing scenario meant. A scenario
     naming an undeclared server settles as a per-scenario `error` with the resolver's
     reason, never a run-wide stop — its siblings still run.
   - **Run.** `RunApiScenarioContext.server` replaced the four scalars
     (`resolvedServe`/`serveCwd`/`healthPath`/`readyTimeoutMs`); all three boot sites read
     it. `run.ts` preflights ONCE PER NEEDED SERVER, sequentially in name order — needed =
     the servers its runnable scenarios bound to ∪ the servers `fromRequest` logins must be
     minted against — so a declared server no scenario binds is never booted. Each boot
     gets its own env layer with the externals injection on top; `ApiPreflightOptions.label`
     prefixes the failure with `server "<name>": ` so the ONE loud `entry-preflight-failed`
     says which service died. `api.services` up/down, `api.seed` and the externals/credential
     resolution stay run-level and once (shared world, not per-server); the seed runs with
     the DEFAULT server's env. Concurrency is untouched — still one server per scenario.
   - **Credential allowlist (R8).** A scenario sees only the credentials its bound server
     accepts; the rest ride `foreignCredentials`, which turns a cross-server `{{cred:…}}`
     into an `error` naming the servers it DOES authenticate against, instead of a 401 the
     app gets blamed for.
   - **Authoring + surfaces.** `RecipeApiProposalSchema` gained `servers`/`defaultServer`
     (with the same one-of refine) and `RecipeApiServerProposalSchema` its per-server
     `app`; `RECIPE_SYSTEM_PROMPT` gained the servers paragraph and `buildRecipeUserPrompt`
     the WORKSPACE APP INVENTORY from item 76's route manifest (the single highest-leverage
     change for cal.com — the prompt used to see only the root `package.json`);
     `RECIPE_PROMPT_FINGERPRINT` rolls, which costs one call and only for repos with no
     `recipe.json`. `verifyProposal` boots EVERY declared server (a half-verifying proposal
     is a recipe whose second service is untestable), `services` once around the loop.
     `guard-read`'s recipe card reports the default server's `serve` plus a `servers`
     inventory (`GuardRecipeCard.servers`, optional; the dashboard card renders it), and
     `truecourse guard recipe` prints one line per server.
   - **Fingerprint:** free — `hashableRecipeText` folds the whole canonicalized recipe, so
     declaring a server re-keys every flow and re-authors what it blocked, exactly the
     `ownHosts`/`externals` precedent.
   - **Follow-ups (deliberately out of scope):** (a) a scenario spanning TWO servers — one
     server per scenario, a flow across apps is blocked rather than authored (R2); (b) the
     DETERMINISTIC proposer still refuses workspace repos (R9), so multi-app derivation
     from the route manifest is model-only for now.
   - Tests: `tests/guard-runner/recipe.test.ts` (+9 — both shapes, every refusal, the env
     layering, the resolver reasons), `tests/guard-runner/api-multi-server.test.ts` (6 —
     per-scenario binding end to end, the undeclared-server error beside a passing sibling,
     the labelled second-server preflight failure, the never-booted unused server, env
     layering, the credential allowlist), `tests/guard-runner/api-seed.test.ts` (+1),
     `tests/guard-runner/api-auth-run.test.ts` (+1 — `fromRequest.server`),
     `tests/guard-generator/recipe-discovery.test.ts` (+2),
     `tests/guard-generator/schemas.test.ts` (+1), `tests/guard-generator/prompts.test.ts`
     (+2), `tests/shared/guard-scenario-api.test.ts` (+1). Fixture:
     `tests/fixtures/guard-fixture-api/server-v2.mjs`.

76. **Route-existence preflight — a documented path with no server never becomes a
   scenario (same bench).** With one declared server, an authoring model handed a `/v2/...`
   path it could not reach IMPROVISED rather than reporting the gap: it rewrote prefixes
   (`/v2/bookings` → `/api/v2/bookings`), and substituted a similar-looking endpoint of the
   OTHER app (`/api/book/event` for a documented v2 operation). Both produce a test that
   proves nothing about the doc and reports as a red failure of the app. The fix is
   deterministic, not persuasive: if the tree says a documented path belongs to an app the
   recipe declares no server for, the flow is BLOCKED at generate (a `blocked-on` gap whose
   fix is a recipe edit), and at run time a 404 for such a path is `error` (infrastructure),
   not `fail`. STATUS: **BUILT 2026-07-30** (route manifest + both generate gates + server
   stamping + the prompt rule + the run-time triage and its birth mapping).
   - **Built: the route manifest** (`packages/guard-runner/src/route-manifest.ts`, pure FS +
     regex, no analyzer/LLM/build). `buildRouteManifest(repoRoot, { extraRoutes? })` →
     `{ apps: [{ dir, pkg?, framework, routes, prefixes, opaque }] }`: app discovery from
     the root `package.json.workspaces` / `pnpm-workspace.yaml` globs (nested packages
     included — cal.com's `apps/api/v2` under `apps/*`), else `apps|packages|services/*`;
     Next.js `pages/api` + app-router `route.*` (`[id]`→`{id}`, `[...x]`→`{...x}`,
     `(group)`/`@slot` dropped, `index` collapsed); NestJS `@Controller`/`@Get(':id')`
     composed with `setGlobalPrefix`/`defaultVersion` (cal.com's `/v2` comes from exactly
     this). `whichAppServes(manifest, path)` answers `route`/`prefix`/`null`.
   - **The asymmetric contract (R6), which every later PR must honour:** the manifest may
     only ever POSITIVELY attribute a path. A path that matches nothing, an app with zero
     detected routes, an app marked `opaque` (a `next.config` with `rewrites`/`proxy`/
     `basePath`, a Nest app with no controller file, a tree past the file budget), or a
     server with no `app` — all degrade to the behaviour guard had before. It is NOT
     fingerprinted and NOT persisted (R5): it is derived in memory per generate/run.
   - **The join key** is `api.servers[*].app` (item 75) — a repo-relative workspace dir.
     Without it nothing relates a route to a server; with it both the generate gate and the
     run triage are one map lookup.
   - **The join, one module** (`packages/guard-generator/src/server-binding.ts`).
     `buildServerRouteIndex(manifest, recipe)` maps app dir → server name from
     `api.servers[*].app`, falling back to an INFERENCE off the serve argv (a token equal
     to the app's package name or under its dir) that is dropped whenever it is ambiguous —
     a wrong join would block an authorable flow. `bindFlowServer(paths, index)` →
     `bound` | `unbound` | `missing-server` | `spans`, with `missing-server` taking
     precedence over `spans` (declaring the server is the actionable next step; the
     one-scenario-one-server verdict only becomes true afterwards). `documentedApiPaths`
     harvests a section's paths with no LLM: an OpenAPI operation section's mounted path,
     else `GET /v2/x` prose and `curl` URLs.
   - **Two gates in the flow loop** (`generate.ts`). GATE A (pre-match) fires only when
     EVERY attributed documented path belongs to an app with no server (`alsoBound` empty),
     and skips the match call entirely — the block needs no model to be certain. GATE B
     (post-match, authoritative) reads `plan.journeys[*].entry.path`: `missing-server` or
     `spans` DROPS the plan (never authored), `bound` records the server on the flow's
     work. Both emit the existing `blocked-on` kind (R4, no new `GuardCoverageGapKind`)
     with the two-entry noun pattern of item 60: `['missing-server', 'apps/api/v2 — serves
     /v2/*; recipe.json declares no server for it']`, or `['multi-server-flow', 'apps/web +
     apps/api/v2 — a scenario runs against one server']` (R2). `deriveNeedsSetup` ignores
     unknown nouns, so it renders as a plain blocked-on gap — correct, since the fix is a
     recipe edit, not an External-APIs form.
   - **The scenario knows its server.** `buildFlowScenario` stamps `server` only when the
     bound one differs from `defaultServer` (engine-assigned; the model never authors it,
     so `RawGeneratedScenarioSchema` is untouched and a single-server repo's YAML is
     byte-identical). The authoring prompt describes THAT service: its serve argv and
     health path, a `Service: "<name>" — the workspace app <dir>` header, the setup catalog
     filtered to operations no OTHER app positively claims (unknown is not foreign), and
     only the credentials the bound server's allowlist accepts (item 75 / R8).
   - **The prompt rule.** `GENERATE_API_SYSTEM_PROMPT` gained "# One service, one server —
     never re-route a documented path": no prefix rewriting, no lookalike substitution, no
     authoring against another service's path hoping it is proxied — return
     `{"blockedOn": ["missing-server", …]}` instead. `GENERATE_API_PROMPT_FINGERPRINT`
     rolled to `c9fe437824fab2dc` (R3): every api flow re-authors once, which is how the
     improvised scenarios convert.
   - **Run-time triage.** `RunApiScenarioContext.servesPath?` answers `yes|no|unknown` (+
     the app that DOES serve it); `run.ts` builds the manifest LAZILY and once, so a green
     run pays nothing. A `status` mismatch with `capture.status === 404`, a step whose
     `expect.status !== 404` (R7 carve-out — "an unknown path answers 404" is a real
     claim), and a `no` verdict returns `error` (not `fail`) with `unservedRoute: true` on
     the result (optional, additive — no format bump) and the evidence transcript written
     exactly as today.
   - **Birth mapping.** An outcome carrying `unservedRoute` is NOT an `errors.push`: it
     settles the flow as the same `blocked-on` gap Gate B emits (noun + the runner's
     verdict sentence), so its hash records and the next generate is a no-op instead of
     re-authoring forever. It is the safety net for flows the manifest could not classify
     at generate time.
   - **Deviations from the plan, and why:** (a) `servesPath` returns
     `{ verdict, servedBy? }` rather than a bare string — the plan's own message text names
     the app that serves the path, which a three-value enum cannot carry; (b) the plan's
     "filter journeyContracts too" is a no-op by construction (Gate B binds the server FROM
     those very paths), so only the `otherOperations` catalog is filtered.
   - Tests: `tests/guard-runner/route-manifest.test.ts` (13 — discovery from `workspaces`
     and from the conventional homes, both Next routers, Nest prefix composition,
     `extraRoutes` attribution, exact/param/prefix/miss matching, and the three negatives:
     an `opaque` rewriting app, an app with zero routes, a path nobody claims);
     `tests/guard-generator/generate-server-binding.test.ts` (6 — Gate A blocking with ZERO
     match/author calls, the gap re-derived on a no-op re-generate, authoring + `server:
     api-v2` stamped once the server is declared, the `multi-server-flow` span block, the
     per-server credential catalog, and the regression guard: a repo the manifest knows
     nothing about authors exactly as before); `tests/guard-runner/api-unserved-route.test.ts`
     (6 — the `error` + `unservedRoute` positive with its evidence, plus four negatives:
     the expect-404 carve-out, an `opaque` app, a server with no `app`, and a 404 the bound
     server itself owns); `tests/guard-generator/generate.test.ts` (+1 — an `unservedRoute`
     birth outcome settles as a blocked-on gap with its hash recorded);
     `tests/guard-generator/prompts.test.ts` (+2, and the rolled fingerprint pin). Fixture:
     `tests/fixtures/route-manifest-monorepo/`.

77. **`truecourse guard setup` — the cheap preparation stage, BEFORE the expensive one
   (user-approved design 2026-07-31).** Every environment fact guard needs (the recipe,
   the third parties it talks to, the rows and principals its scenarios drive) is
   discovered today as a BYPRODUCT of `guard generate` — the single most expensive stage
   in the product (~$37 on the cal.diy bench). Worse, FIXING any of those facts edits
   `recipe.json`, which moves the recipe fingerprint, which re-authors every section that
   was already good. The pipeline becomes a strict three-stage chain — `spec scan` →
   `guard setup` → `guard generate` — so all of it is knowable and fixable before the
   first extraction call.
   The central trick is the fingerprint split guard already has:
   `computeRecipeFingerprint` folds `hashableRecipeText(raw)` — the DECLARATION (service
   names, header/env-var names, roles) — while literal secret values and the whole
   gitignored `scenarios/externals.local.json` overlay are excluded. Getting every
   declaration in BEFORE the first generate means later handing guard a real API key
   touches only the overlay and causes ZERO re-authoring churn on already-good sections.
   The steps, in order:
   - **Step 0 — an LLM provider must be configured.** Hard failure with a clear message.
     Cheap, no calls.
   - **Step 0.5 — a corpus is required.** Setup runs AFTER `spec scan`; with no
     `specs/corpus.json` it fails with "run `truecourse spec scan` first" rather than
     half-completing.
   - **Step 1 — the recipe. THE ONLY HARD GATE.** The existing `discoverRecipe` path
     (deterministic proposer first, LLM proposal fallback, verify-by-running,
     write-only-on-success) plus a NEW live endpoint probe: `buildRouteManifest` +
     `resolveApiServers` (items 75/76) pick the cheapest unauthenticated GET with no path
     params per declared server — reusing `rankHealthPath`, the ranking the deterministic
     proposer already applies to the same route surface — and the server is booted through
     the existing `preflightApiServer` and called. PASS BAR: **any HTTP status is a pass,
     401 and 404 included** — a 404 means the route table moved, not that the recipe is
     broken. Only connection-refused, timeout, or 5xx-on-everything fails.
   - **Step 2 — detect.** ONE `mapJourneys(repoRoot)` pass: external services, the
     database + its parsed schema, datastore URLs. Deterministic and free, no LLM.
   - **Step 3 — externals. SOFT, never blocks.** The full `api.externals` declaration
     SKELETON is written for EVERY detected service — including ones the user has no
     account for. Declared-but-unprovided is a state authoring already treats identically
     to undeclared (`resolveExternal`, recipe.ts:233), so the skeleton changes no verdict
     while getting the declaration into the fingerprint once and for all. Interactive
     provisioning (what `guard externals` used to own) moves in here. Unprovided services
     propagate into generate as the existing item-65 needs-setup state.
   - **Step 4 — the seed. ONE artifact covering data AND auth.** `api.seed` is a single
     script with a single `provides` block emitting both `credentials` (name → header +
     role) and `fixtures`. Creating the test principal IS data seeding — you cannot mint a
     login token without a user row — so these are deliberately NOT two steps. The draft is
     grounded in the parsed DB schema + the route manifest + the detected OpenAPI security
     schemes (B7) + the specs (available because setup runs after scan: specs supply the
     role/principal LANGUAGE, the schema supplies what is CREATABLE), and mints ONE
     PRINCIPAL PER DETECTED ROLE. Verification is item 66's, unchanged: `api.services.up` →
     the script through the runner's own `runSeed` with `GUARD_SEED_OUT` set and the
     manifest validated against the drafted `provides` → `preflightApiServer` → probe. A
     rejected draft leaves the tree BYTE-IDENTICAL (the write-then-delete rule item 66
     established).
   - **The credential↔spec check moves.** `validateCredentialSatisfies(recipeAuthCredentials(recipe), docs)`
     fires in setup, where fixing it costs nothing. The generate-side check STAYS as a cheap
     re-validation (specs can move between the two stages) — setup is merely where the user
     first hears about it.
   - **Pre-flight cost.** Setup spends on at most two LLM stages (the recipe fallback
     proposal, the seed draft). A full staged `spec-estimate` integration is overkill for a
     bounded two-call stage: setup emits a one-line "up to N calls (~$X)" off the existing
     per-token `model-prices.ts` source, with `-y, --yes` to skip the confirm — the same
     convention every other LLM-spending command follows.
   - **Persistence.** `guard/setup.json` — GITIGNORED, derived, safe to delete — holds the
     detection snapshot (externals, database, datastore URLs) plus the per-step outcomes.
     `readGuardExternalsView` reads its detection from THERE instead of `guard/result.json`;
     `result.json` stays generate's own artifact.
   - **Re-run semantics.** Setup is idempotent: a bare `guard setup` over a repo that
     already has a recipe + seed REPORTS and no-ops. `--refresh` forces re-derivation, and
     refreshing the SEED must not silently overwrite a hand-edited script — it CONFIRMS
     (item 66 flatly refused), and in a non-TTY with `--refresh` but no `-y` it refuses
     rather than clobber.
   - **Out of scope, deliberately:** EE / hosted (hosted generate keeps its
     self-sufficiency — everything under `guardsMaterializeInPlace()`-false behaves exactly
     as before), and the dashboard's convergence onto a single Setup surface (the scattered
     CTAs stay where they are; a follow-up).
   STATUS: **BUILT 2026-07-31.** As-built decisions (all of them where the code disagreed
   with the sketch, none of them a scope change):
   - **Engine placement.** `packages/guard-generator/src/setup.ts` (the orchestrator) +
     `endpoint-probe.ts` (step 1's probe) + `externals-skeleton.ts` (step 3's pure patch
     derivation). guard-generator is where `discoverRecipe` and `draftSeed` already live and
     is the only package that may depend on both the runner and the LLM stages. The core
     adapter is `packages/core/src/commands/guard-setup.ts`; the CLI is
     `tools/cli/src/commands/guard-setup.ts`. Nothing engine-shaped landed in the CLI or the
     dashboard server.
   - **Step 0 lives in the ADAPTER, not the engine.** "Is a provider configured" is a
     config question and `packages/guard-generator` has no config dependency by design — so
     `guardSetupInProcess` performs it (`getLlmConfig`) and the engine takes an injected
     transport, exactly as generate does.
   - **The probe's pass bar as code.** `probeApiServers` returns one
     `GuardSetupServerProbe` per declared server (`{ server, path, status?, error? }`).
     A server FAILS only when the boot itself failed, when the fetch threw
     (connection-refused / timeout), or when EVERY probed path answered 5xx — and the health
     path is always probed alongside the picked route so "everything" is more than one
     sample. Any other status, 401 and 404 included, is recorded and passes.
   - **DELTA from the sketch, forced by the code: "5xx on everything" samples REAL
     ROUTES, not the health path.** `preflightApiServer` polls the health path to 2xx
     before `onReady` fires, so a health-path sample is a guaranteed pass and including
     it would make the all-5xx verdict unreachable. The probe therefore calls up to
     THREE real routes (same ranking) and judges on those; the health path is the only
     sample when the route manifest knows nothing — in which case the probe is exactly
     the boot check and passes by construction, which is the correct R6 degradation.
   - **DELTA: `--refresh` PRESERVES the blocks discovery never proposes.** A refresh
     re-derives and discovery writes what it derived, which would silently drop
     `api.seed`, `api.externals`, `api.credentials` and `ownHosts` — and, worse, would
     defeat the seed confirmation below (a wiped `api.seed` is not a seed anyone is
     asked about replacing). `runGuardSetup` captures those four before discovery and
     merges them back, re-validating the whole recipe; a merge that cannot be applied
     leaves the derived recipe and the run carries on.
   - **Interactive provisioning moved as specified**, into
     `tools/cli/src/commands/guard-setup-externals.ts` — prompts only, every write
     through core's `writeGuardExternals`, so the secrecy split and the whole-recipe
     re-validation stay in one place. It is offered only in a TTY and only for services
     with no account, and skipping it costs nothing: the DECLARATIONS are already
     written, and a value supplied later is fingerprint-neutral.
   - **The probe path is picked once, deterministically** (`pickProbePath`): the ranked
     health path if the app's own route surface declares one (`rankHealthPath`, reused), else
     the shortest static (parameter-free) route of the app the server serves, else the
     server's declared `healthPath`. A repo whose route manifest knows nothing degrades to
     probing the health path — i.e. exactly the boot check, never a false failure (R6).
   - **The externals skeleton never invents a variable.** A detected service is declared
     only when detection actually saw a base-URL override variable for it (`baseUrlEnv` /
     `baseUrlEnvs`); a service with no variable to point anywhere is REPORTED as
     undeclarable rather than declared with a fabricated `baseUrlEnv` (the schema requires
     one, and a wrong guess would be injected into the app's env at every run). Extra
     detected base-URL variables land as `endpoints` with their detected default URL, the
     item-64 shape. An already-declared service is left byte-identical — the skeleton only
     ever ADDS.
   - **The seed gate lost its item-66 trigger.** `seedDraftGate` no longer requires
     "some flow is blocked on missing data" (that trigger was an AUTHORING output and setup
     runs before authoring): the gate is now recipe → `api` block → a parsed schema →
     no existing `api.seed` unless the caller confirmed a refresh. `blocked` is now optional
     grounding, not a precondition.
   - **The unified draft's new grounding** rides `SeedDraftInput` as four additive fields
     (`routes`, `securitySchemes`, `roles`, `specExcerpts`) and the system prompt gained the
     PRINCIPALS section that turns them into one credential per role.
     `SEED_PROMPT_FINGERPRINT` rolls, which costs one draft call and only for repos that
     have no `api.seed` yet.
   - **Roles are detected deterministically where they exist** (`detectRoleColumns`: an
     enum-ish / defaulted column named `role`/`roles`/`type`/`kind` on a principal-shaped
     table) and handed to the model beside the spec excerpts, which supply the LANGUAGE.
     A schema with no role column yields one principal, which is the honest default.
   - **The estimate is a one-liner, as specified** (`estimateGuardSetup`): recipe-proposal
     calls (0 when `recipe.json` exists) + seed-draft calls (0 when `api.seed` exists),
     each × the per-token price of its resolved model's ceiling. It renders through the same
     `promptLlmEstimate` the other commands use.
   - Tests: `tests/guard-generator/setup.test.ts`, `tests/guard-generator/endpoint-probe.test.ts`,
     `tests/guard-generator/externals-skeleton.test.ts`, `tests/core/guard-setup.test.ts`,
     `tests/cli/guard-setup.test.ts`.

78. **The demotions that make item 77 a chain, not a fork (same decision, 2026-07-31).**
   A preparation stage is only a gate if nothing else can perform preparation. Three write
   paths and one implicit derivation were doing exactly that, and all four are removed:
   - **`guard generate` no longer DERIVES a recipe.** It LOADS one and fails with "run
     `truecourse guard setup`" when there is none. This is the hard gate. It is scoped to the
     working-tree path: hosted/EE generate (`guardsMaterializeInPlace()` false) keeps
     auto-deriving exactly as today — an ephemeral checkout has no user to run setup in it.
   - **Item 66's post-generate seed drafting is DELETED** — the `draftSeed` call at the end
     of `generateGuards`, the `missingDataBlocked`/`seedProbePaths` accumulation, `seedDraft`
     in the result type, and `toSeedDraftReport`. It was already dead by construction once
     setup always writes a seed (item 66's own gate (d) refuses to overwrite an existing
     `api.seed`), so this is a removal, not a behaviour change. The VERIFICATION helpers
     setup reuses are kept verbatim.
   - **`guard recipe`, `guard seed`, `guard externals` survive as READ-ONLY VIEWS.**
     `guard recipe --init/--refresh`, `guard seed --init`, and `guard externals`' interactive
     provisioning are gone; `guard externals` keeps `--list` behaviour as its ONLY behaviour.
     Those write paths now exist in exactly one place: `guard setup`.
   - **No other new command.** `guard status` gains a `setup` row rather than a `guard setup
     --status` sibling.
   STATUS: **BUILT 2026-07-31.** As-built:
   - The generate gate is `loadRecipe` + an early `recipe-failed` result whose reason names
     `truecourse guard setup`; `discoverRecipe` is still called on the hosted path, so the
     `recipe.status: 'discovered'` reporting shape is unchanged there.
   - `guard/result.json`'s `seedDraft` field stays in `GuardGenerateReportSchema` (optional):
     removing it would fail every already-written report on read. Nothing writes it any more.
   - `spec-estimate`'s `guardSeed` stage now always contributes 0 calls to the GENERATE
     estimate (the stage no longer exists there); the seed's cost moved to the setup
     estimate.
   - Tests: the demotions are covered by `tests/cli/guard-recipe.test.ts`,
     `tests/cli/guard-seed.test.ts`, `tests/cli/guard-externals.test.ts` (each asserting the
     write path is refused and points at `guard setup`) and
     `tests/guard-generator/generate.test.ts` (the no-recipe gate).

31. **Conflict resolution redesign — SECTION-scoped, not doc-scoped (user decision
   2026-07-10).** Doc-level verdicts are the wrong tool for what conflicts actually are
   (one disagreement between two specific sections): "Use X only" amputates a whole good
   document for one lying sentence, "Prefer X" is a document-wide precedence for a
   sentence-sized dispute, and neither suppresses the losing claim at extraction today.
   Doc-level exclusion already exists (skip); doc-level replace/precedence MOVES OUT of
   the conflict flow to the relations/chains world (CLI `spec chains add`; conflict detail
   drops those buttons). The conflict flow becomes verdicts on the DISAGREEMENT:
   a. **Pick a side** — "README is right" / "SPEC is right" (labels use the real doc
      paths). Persisted in decisions.json as `conflictResolutions[]` keyed by dispute
      identity (doc pair + section anchors + normalized quotes) so it survives rescans
      and matches the re-detected dispute; orphaned honestly when docs change enough that
      the quote disappears. Effect on generation: the LOSER'S DISPUTED CLAIM is
      suppressed — claim-level, via the verbatim quote (a section can hold one lie and
      three truths; never drop the whole section). Preferred mechanism: inject the
      resolution as context into that section's extraction ("this sentence is resolved
      stale — do not extract claims asserting it"), which re-keys only affected sections'
      extract cache. The conflict gate counts these as resolved (extend the shared
      overlap-resolution derivation).
   b. **Not a real conflict** — dismissal of a detector false-positive; persisted,
      visible, reversible (finding-dismissal analog).
   c. **Fix the doc (edit-in-place)** — the merge-editor analog, OSS-only phase 1 (EE has
      no live tree): the disputed section flips to a raw-markdown textarea; Save POSTs
      `{doc, anchor, newText}` to a new route that re-locates the section BY ANCHOR in
      the current file (never stale line numbers; anchor gone → clear error), splices,
      atomic-writes. The edit lands in the working tree (git diff is the user's normal
      flow). NO auto-rescan — same batching model as skips: save marks scan staleness;
      ONE Rescan (estimate-gated as usual) applies any number of edits/verdicts.
      Later sugar (not phase 1): sentence-level quick-fix prefilled with the quote;
      LLM-suggested reconciliation patch shown as an approvable diff.
   d. **Scan staleness, docs-content half (closes the old follow-up)**: staleness =
      decisionsPending OR any kept doc's mtime newer than corpus generatedAt (tolerant on
      missing files) — feeds the existing Rescan dot; also catches edits made outside the
      dashboard.
   Phases: 31a engine/schema (resolutions store + derivation + gate + extraction
   suppression + staleness half) → 31b dashboard (verdict buttons, dismissal, editor,
   relation-buttons removal). CLI parity: `spec conflicts resolve` gains the side-verdict
   form; existing doc-relation resolve moves under chains.
   STATUS (31a): BUILT — `conflictResolutions[]` in decisions.json
   (`ConflictResolutionSchema`, optional so old files parse); dispute identity =
   unordered doc pair + (normalized quotes when both sides carry one, else section
   anchors); shared derivation
   (`buildCorpusConflicts` carries the matched `resolution`+verdict, `suppressedClaims`);
   the item-25 gate picks it up via `openConflicts` (tested); extraction suppression
   injects a "resolved stale" block into the losing section's view input + folds a
   `suppressionFingerprint` into the view extract-cache key AND `generationInputsHash`
   (both only when non-empty, so unaffected sections/views keep their caches) — a
   newly-suppressed section re-detects as work and re-extracts with the loser's claim
   dropped; `normalizeQuote` hoisted to `@truecourse/shared` (one copy, reused by the
   pointer-verifier); CLI `spec conflicts resolve <n|area> --right/--dismiss` (doc-
   relation flags kept, help points at `spec chains`), `list`/`spec status` render
   section-resolved/dismissed; staleness gains `docsChanged` (kept-doc mtime >
   corpus generatedAt — closes the scan-staleness follow-up); OSS `POST
   /spec/doc/section` re-locates by anchor + splices (heading preserved unless the new
   text carries one), atomic-write, path-confined, EE → 501.
   **REVISED 2026-07-10 (user decision): edit-in-place REMOVED — overkill.** Live testing
   exposed span-mismatch complexity (hierarchical vs flat section spans; a save could have
   replaced a whole README) for marginal value: the user's editor is one cmd-tab away.
   The conflict detail instead shows ONE short hint that fixing the doc itself and
   rescanning is the other resolution path. STRIP: the pencil/textarea flow, GET
   /spec/doc/sections, POST /spec/doc/section, core repo-doc-editor + their tests. KEEP:
   verdicts/dismissals/undo and the docsChanged staleness dot — which is exactly what
   makes external-editor fixes work (edit → dot lights → one Rescan).
   **REVISED 2026-07-25 (user decision): orphan housekeeping REMOVED — auto-prune
   instead.** A stored verdict matching no overlap the fresh corpus flags is deleted from
   `decisions.json` by the scan that writes `corpus.json` (`curate()`, same write cycle,
   atomic, orphan-hood decided by the SAME `orphanedConflictResolutions` derivation every
   surface reads). Safe because a verdict is cheaply re-derivable — if the disagreement
   re-emerges the next scan flags it and the user resolves it again; a rare re-ask beats a
   permanent pile of stranded bookkeeping. STRIP: the dashboard's "N verdicts no longer
   match a conflict" block and the `spec status` orphan line. STATUS: BUILT.
   **REVISED 2026-07-10 (user decision): NO legacy relation-resolution support — dead
   code.** Pre-release, no old decisions files exist to honor. Doc-level relations STOP
   counting as conflict resolutions everywhere: the derivation resolves a conflict ONLY
   via a verdict, a dismissal, or a covering exclude; the conflict view drops the legacy
   resolved-rendering + Revoke; the synthesized resolved entries for user relations go;
   `spec conflicts resolve` drops the doc-relation flags entirely (relations live in
   `spec chains`, which STAYS — doc lifecycle/precedence is unchanged, it just never
   marks a conflict resolved). A replaced doc's textual disagreement stays an open
   conflict until verdicted/dismissed/fixed — honest: the docs still disagree.
   **EE mapping (discussed 2026-07-10, for the EE migration):** verdicts/dismissals are
   pure decision DATA — they port through EE's existing decisions store + per-PR overlay
   (promote on merge) with no extra engine work; the shared overlap-resolution derivation
   already carries them, and identity is content-keyed (quotes/anchors) so it is stable
   across EE's per-commit corpus reads. Edit-in-place CANNOT port as-is (EE repo is
   read-only by design; commit-back was removed) — the editor capability-gates OFF in EE;
   the EE-native evolution is "propose fix as a commit/PR" via the GitHub App, a
   deliberate future decision because it requires contents:write scope. Rescan semantics:
   verdicts need no re-curate in either edition (overlay, read live); set-changing
   decisions re-curate immediately in EE (server-side, org budget) vs batched behind
   Rescan in OSS (user-paid); doc edits re-scan on the next commit webhook in EE vs the
   docsChanged staleness dot in OSS.
   STATUS (31b): BUILT — SpecOverlapDetail action row is the three verdicts (`<docA> is right` / `<docB> is right` / `Not a real conflict`) writing POST/DELETE `/spec/conflict-resolution` (OSS instant ack, no re-curate; EE PR keeps the recurate flow) and rendering resolved/dismissed-in-place with Undo; per the REVISED notes there is NO in-app editor — a one-line muted hint ("Or fix the doc itself and rescan — the Rescan button lights up when a doc changes.") points at the external-edit path, which the `docsChanged` staleness dot picks up — and NO relation-resolution anywhere: the shared derivation resolves ONLY via verdict/dismissal/exclude (`coveringRelation*`, the synthesized resolved rows, and the scan-time relation-skip in `flagOverlaps` are deleted; `recurateStoredCorpus`/`recuratePrCorpus` and the scan outro count open conflicts via the derivation), the conflict view has no relation rendering/Revoke, and `spec conflicts resolve` takes only `--right`/`--dismiss` (relations stay untouched in `spec chains`); the corpus payload carries `conflictResolutions` so the sidebar shows verdict/dismissed badges and a collapsed orphaned-verdict housekeeping line (remove); the Rescan dot lights on `docsChanged` OR `decisionsPending`; inverted tests pin relation-present ⇒ conflict still open across shared/gate/CLI/client, gate green.


30. **Close the pointer action space in the overlap prompt (root cause of item 29's
   mis-anchor; user go 2026-07-10).** The overlap prompt asks Haiku (spec.overlap default)
   to NAME the heading holding each side's claim — free recall over an open set; taskline's
   intro paragraph reads storage-flavored, so "Storage" was the classic
   plausible-association error (same disease as guard's tool-call bug: unclosed action
   space invites invention; per the standing rule, fix the prompt for the small model,
   never upgrade the model). Fix, riding ONE overlap-fingerprint roll: (1) the prompt
   enumerates each doc's actual headings + "the lead" as a closed choice set — pointer
   naming becomes selection; (2) each pointer carries a short VERBATIM quote of the
   disputed sentence (upgrades item 29's verification from token-overlap to exact
   location); (3) the null/lead rule aligns with item 27's lead definition. Queued behind
   item 29 (same file). Cache cost: overlap stage re-detects once per pair on next scan —
   small, accepted.
   STATUS: BUILT 2026-07-10 — overlap user prompt enumerates each doc's headings + a lead option as a CLOSED set (selection, not recall); each side pointer carries an optional verbatim `quote` (persisted to `corpus.json` `OverlapSectionSchema`, optional so old corpora parse); `verifyOverlapSections` (pointer-verifier.ts) locates the quote by normalized substring FIRST (exact hit anchors with certainty, keep-bias on ties), falling back to the item-29 idf token path when no quote/no hit; system prompt + examples rolled the overlap PROMPT_FINGERPRINT (one re-detect per pair, accepted); no other stage changed.

29. **Overlap pointer verification — re-anchor deterministically (user go 2026-07-10).**
   Overlap section pointers are model-chosen and UNVALIDATED: a re-detection anchored the
   README side of taskline's rm dispute at "Storage" while the disputed sentence lives in
   the intro paragraph (the previous roll had it right as a preamble pointer). Worse, the
   dedup representative rule prefers NAMED pointers over null ones ("most bandable"), so
   when duplicates disagree we systematically keep the wrong-but-named anchor. Fix at
   assembly (`flagOverlaps`, same stage as dedup — covers fresh AND cached verdicts, no
   LLM, no prompt roll): score every section of the pointed doc (including the LEAD as a
   null-heading candidate) by content-token overlap with the overlap note; keep the
   model's pointer when its section carries signal; RE-ANCHOR only when the pointed
   section shares ~none of the note's distinctive tokens while another section (or the
   lead) clearly does; no better candidate → keep the pointer (least surprise).
   Deterministic — a pure function of note + doc contents; constants principled and
   documented, never tuned to taskline. Verified pointers also make the dedup
   representative choice trustworthy. Committed old corpora correct themselves on the
   next rescan (cache-warm, assembly-only).
   STATUS: BUILT 2026-07-10 — `verifyOverlapSections` (spec-consolidator `pointer-verifier.ts`) scores each pointed doc's sections (lead = null-heading candidate, item-27 def) by idf-weighted token overlap with the note; re-anchors only when the pointed section is below the meaningful floor AND ≤¼ of the best; runs in `flagOverlaps` before the item-28 dedup so wrong-named duplicates converge on the verified anchor; no LLM / no prompt roll (fresh + cached verdicts).

28. **Cross-area conflict dedup (user go 2026-07-09).** Overlap detection runs per AREA
   over each area's doc pairs, so a doc pair sharing several areas can get the SAME
   dispute flagged once per shared area (live: taskline's rm disagreement appeared twice —
   core/persistence + core/tasks-entity, same pair, same substance, different wording).
   Investigate and fix at the root, choosing deliberately between:
   (a) detection keyed by DOC PAIR, not area×pair — the "do these two docs disagree?"
   question is area-independent (the model reads the docs); areas then reference the
   pair-level verdicts. Structurally impossible to duplicate AND cheaper (one call per
   pair). Check whether the detection prompt uses area context; if the prompt must change,
   that rolls the overlap fingerprint (acceptable — small caches — but say so).
   (b) assembly-level merge: same unordered pair + shared section pointer on at least one
   side ⇒ one dispute (two docs CAN have multiple genuine disputes — never merge by pair
   alone).
   Prefer (a) if the prompt/area coupling allows. UI/schema: one dispute = one conflict
   row however many areas share the pair; keep resolutions doc-pair-level (unchanged).
   Dedup must be deterministic — never note-text similarity.
   STATUS: BUILT 2026-07-09 — chose fork (b) assembly-level merge (the detection prompt
   is area-coupled: the SCOPE instruction focuses a small model per area to catch each
   area's dispute, so pair-keying detection would lose per-area coverage; prompt/fingerprint
   unchanged). ONE deterministic rule in `@truecourse/shared` (`dedupeCrossAreaOverlaps`:
   same unordered pair + a shared section pointer on ≥1 side ⇒ one dispute, union-find),
   applied at assembly (`flagOverlaps`) AND read (`buildCorpusConflicts`, so older
   duplicate corpora surface once). The merged `Overlap`/`CorpusConflict` records every
   spanned `areas[]`; a resolution scoped to any (or unscoped) clears it — cross-area
   disputes record an unscoped relation (CLI + dashboard) so one resolution survives a
   re-scan. Two genuine disputes (disjoint sections) stay two.

27. **Preamble banding must cover the H1-lead shape (live bug 2026-07-09). STATUS: BUILT.** A null
   (preamble) overlap pointer bands "content before the first heading" — but most READMEs
   open with an H1 title on line 1, so that region is EMPTY and the viewer highlights
   nothing (seen live on the taskline conflict; the truecourse README only worked because
   its badges sit above any heading). Fix in the viewer (DocMarkdown/SpecDocViewer), no
   prompt change: the preamble band = the doc's LEAD — content before the first heading
   when non-empty, else (doc opens with a single H1) the H1 section's own body up to the
   next heading. General rule, not doc-specific. Observed alongside: the same doc-pair
   dispute was flagged as TWO conflicts in two areas sharing the pair — cross-area overlap
   dedup is a separate follow-up, logged here, not built with this item.

25. **Generate FAILS on open conflicts (user decision 2026-07-09).** An unresolved
   within-area overlap means two docs make contradictory claims; generate extracts BOTH,
   and the side the code disagrees with births red — a paid committed FAILING test (item 50)
   that is really the unresolved dispute. `guard generate` (CLI and dashboard action alike) now HARD-FAILS
   before any LLM work when the corpus has open conflicts: exit non-zero with the conflict
   list (paths + note, full messages) and the resolution pointers (`truecourse spec
   conflicts list` / the dashboard Conflicts group). "Resolved" reuses the SAME derivation
   the spec surfaces use (a covering relation OR an exclude — hoist that logic into
   core/shared if it lives only in the dashboard route; never duplicate it). No --force
   escape hatch: resolving is cheap and the alternative is paying for noise. The estimate
   gate runs AFTER this check (fail before asking to spend). Related follow-up kept open:
   extraction honoring precedence/keep-both resolutions at section level.
   STATUS: BUILT 2026-07-09 — resolved-derivation hoisted to `@truecourse/shared`
   (`buildCorpusConflicts`/`openConflicts`/`coveringRelation`, the composeGuardStatus
   precedent), consumed by the gate (`guardGenerateInProcess.assertNoOpenConflicts`,
   pre-estimate), the CLI (`spec conflicts`/`spec status`), and the client
   (SpecCorpusView/SpecOverlapDetail) — no second copy; CLI prints the full list + exits 1,
   the dashboard action returns 422 with the same report.
26. **Scan outro points at guard (user report 2026-07-09).** `spec scan` ended with a
   contracts-era next-step fossil. New outro: with open conflicts → "N conflicts to resolve
   (`truecourse spec conflicts list`), then `truecourse guard generate`"; conflict-free →
   "Run `truecourse guard generate`".
   STATUS: BUILT 2026-07-09 — scan + `spec status` outros point at `truecourse guard generate`
   (conflict-free) / count open conflicts via the same derivation and route to `spec conflicts
   list`.

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
   STATUS: BUILT — EXTRACT_SYSTEM_PROMPT gained a "commands that need an LLM provider are not
   cli-testable" rule (any provider-auth-dependent command classifies blocked-on the
   llm-provider capability, not emitted as a cli claim); EXTRACT fingerprint rolled to
   2f26bbf187a8a087.

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
   STATUS: BUILT — committable `scenarios/decisions.json` (`dismissedClaims`, identity = doc+anchor+extracted-claim-text); generate skips a dismissed claim before authoring, records a `dismissed` coverage gap (settles the section, releases held siblings), and reports `orphanedDismissals`; dashboard Dismiss/Un-dismiss on the finding detail + a `dismissed` coverage status; `guard status` shows the dismissed count. EE fix (2026-07-15): hosted generates now materialize the Pg-stored guard decisions into the ephemeral checkout (`materializeAndGenerateGuard`, every path including `skipMaterialize`) — before this the fresh clone had no `scenarios/decisions.json`, so a hosted regenerate re-authored every dismissed claim and held sections never released. Hosted live refresh (2026-07-15): background jobs announce settled work through the core `repo-lifecycle` seam (`repo.baseline`→`scan`, `repo.guard`→`guard-generate`, `guard.baseline`→`guard-run`); the dashboard server's socket layer installs the emitter (repoKey → registry slug → `spec:complete` into the `repo:<slug>` room), so an open Spec/Scenarios/Runs tab refreshes live when the auto-regen or a chained run lands — the hosted analog of the OSS routes' own `spec:complete`.






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
  (relevance/area-tag/vocab/overlap; relation detection removed 2026-07-14, #760) via ONE shared constant. Deliberately EXCLUDED:
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
STATUS: BUILT 2026-07-27 — superseded and expanded by `docs/CLI_API_TRANSPORT_PLAN.md`
(saved config-file selection + first-run wizard + all four providers, not env-only).

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
5. **Birth validation** — deterministic: every new/regenerated scenario is run immediately, and
   its outcome becomes the test's recorded STATUS. A scenario failing at birth is either a
   generation defect (the one evidence-retry's job) or **real existing drift**; after the retry
   it is COMMITTED as a failing test with its birth result, never discarded — see item 50, which
   retired green-at-birth. The one candidate still refused a commit is a fidelity rejection
   (item 33): "the test is wrong" is a re-author path, not a code disagreement.
6. **Fidelity review** (v1.5, separate STATUS) — adversarial LLM pass per scenario: "does this
   assert the section's actual claim, or something weaker?" Weaker-than-spec is the worst failure
   mode (green tests, false confidence) and gets its own gate.

**Authorship is output-only (the transport seam).** Scenario generation, testability
classification, and recipe discovery all ride the existing `LlmTransport` seam exactly like spec
scan: the model **returns** content (scenario YAML, verdict JSON, recipe JSON)
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
- The run executes the whole committed corpus, INCLUDING the tests generate committed red at
  birth (item 50) — a run's totals therefore include known failures, and a red test that the
  code has since caught up with simply comes back `pass`. A result records the `stage` that
  produced it (`birth` | `run`), so a read can say where a failure came from.
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

**PR-view baseline fallback for generate-side reads (user bug report 2026-07-15, hosted
gate dogfood). STATUS: BUILT 2026-07-15.** A hosted PR-gate run persists ONLY the run at
the PR head — the corpus/scenarios/manifest/generate-result it executed live at the
BASELINE commit. The head-pinned guard reads returned nothing, so a PR showed a
self-contradictory Spec Guard view: Coverage listed docs (the spec route already fell back
to the baseline corpus, labelled `corpusCommit`) beside a "No spec corpus" empty state,
Scenarios said "No scenarios yet" while Runs showed the 4 scenarios the gate just ran, and
CLI copy (`spec scan` / `guard generate`) was meaningless for a hosted repo. Fix — the
GENERATE-side reads fall back, per store, from a pinned PR head miss to the BASELINE
commit (the set the gate actually executed; still never "newest by createdAt"):
`storeGuardStaleness` (corpus/manifest/scenario-files/result — `hasRun` stays head-only),
`listGuardScenarios` (whole-set fallback, labelled by the new
`GuardScenarioInventory.scenariosCommit`, surfaced in the panel as "Showing the baseline
scenarios — this PR didn't regenerate them."), `readGuardReport`, and the new
`readManifestForView`/`readGuardResultForView` behind `/guard/status` + `/guard/coverage`
(the RUN in those joins stays pinned to the head). Repo-level (no-ref) reads are
untouched. Companion UX fix: stale/orphaned outcomes now carry a one-line explainer
(`GuardStatusMeta.hint`) under the Runs-list group header and as the badge tooltip — the
outcome name alone didn't tell users the scenario never executed.

**PR run timeline in the Runs picker (user bug report 2026-07-15, follow-up to the
baseline-fallback batch). STATUS: BUILT 2026-07-15.** Under a PR ref the Runs picker
skipped `/guard/history` entirely (correct: baseline runs must never be listable in a PR
view — pinned by test) but that threw out the PR's OWN runs, so "Recent runs" sat empty
next to a painted head run. There is no per-attempt history to list — `guard_runs` is
keyed `(repoKey, commitSha)` and a same-head re-run replaces the row — so the PR timeline
is one run per pushed head. Fix: `/guard/history?pr=N` → core `readGuardHistoryForPr`
resolves the PR's distinct head SHAs through the new `GuardGateHeadsLookup` seam
(`guard-gate-pending.ts`, same idiom as the pending lookup; EE installs
`createGuardGateHeadsLookup(gateStore)` over the gate-run records at boot, OSS leaves it
unset ⇒ empty) and joins each head to its stored run via `readGuardRunForCommit` — a head
whose gate errored before storing a run is skipped (only selectable runs list). Client:
`useGuardRuns`/`GuardDriftsView` take `prNumber` and fetch the pr-scoped history under a
PR ref; selecting an older head's run loads it through the existing `/guard/runs/:runId`.
Baseline runs stay unlistable.

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
  boundary fakes, egress control. STATUS: PoC BUILT 2026-07-16 (no sandboxing tier, per the
  decision to defer isolation). What shipped: the `api` scenario variant (frozen envelope;
  `request`/`capture`/`expect` verbs — status, headers, body matchers, JSON-path matchers,
  `${var}` chaining), the recipe `api` block (`serve` argv + `healthPath`/`readyTimeoutMs`/
  `env` + one-shot `services.up/down` commands), the runner module (per-scenario server boot
  in the sandbox cwd with a runner-allocated `PORT`, health-wait, one loud api preflight
  reusing `entry-preflight-failed`, api evidence bundles incl. server logs), the registry flip
  (`api` runnable), and generation (api authoring prompt + per-driver batches/caches; api
  claims with no recipe `api` block settle as honest `blocked-on` gaps; birth validation runs
  through the same engine). Recipe `entry` is now optional — required only when cli scenarios
  exist. Still open (the rest of this phase): compose-managed ephemeral datastores + baked
  images, network-boundary fakes, egress control, api recipe discovery, per-scenario boot
  amortization (shared-server mode), and the isolation/sandboxing tier.
- **Phase 7 — tui / web / library drivers.** PTY tier; Playwright tier; in-process
  programmatic-API tier (sections already classified; sandbox package-link mechanism
  prototyped in PR #755, closed unmerged — revive on driver start). STATUS: NOT
  STARTED (post-v1)
- **Phase 8 — EE adaptation: hosted Guard replaces the verify drift gate.** Guard becomes the
  enterprise PR gate — scenarios generated server-side from the spec corpus, run on every PR,
  posting the gate Check with a new engine. STATUS: IN PROGRESS (branch `sm/spec-guards-ee`,
  working tree awaiting review). EE swaps seams, not logic: the file store becomes Postgres +
  blob behind the `GuardStore` interface, execution goes behind the `GuardExecutor` seam,
  child processes get a minimal explicitly-constructed env (no DB URL / master secret / App
  key), and gate runs are durable jobs under a bounded worker pool with per-phase timeouts.
  Diff-gate semantics: the Check fails ONLY on scenarios that pass on base and fail on head;
  repo + PR-overlay dismissals honored, held scenarios excluded, stale/orphaned bindings become
  annotations, infra/build/timeout/generation failures settle as an error Check, a genuine
  absence of spec docs is neutral. Detailed issue tracking lives in the external
  guard-ee-hosted-gate tracker; the decided sub-phases:
  - **08.01 — Guard schema + Pg guard store.** Additive drizzle migration; scenario/run/decision
    persistence + blob-evidence pointers behind the `GuardStore` seam. STATUS: BUILT (awaiting review).
  - **08.02 — GuardExecutor seam + minimal-env execution.** The single injected `GuardExecutor`
    function (checkout + scenarios + recipe → run report) at the customer-code boundary; minimal
    child env. STATUS: BUILT (awaiting review).
  - **08.03 — Onboarding generate job + `guard` capability.** Repo connect enqueues a server-side
    generate against the default branch; the `guard` capability advertised only after the guard
    subsystem (store/jobs/routes) registers. STATUS: BUILT (awaiting review).
  - **08.04 — Gate-execution durable job + diff Check (warm path).** The webhook enqueues gate
    execution; the Check sits in-progress while queued; new-failures-vs-base verdict, kill-switch
    neutral, stale annotations, error-vs-neutral settlement, abort-signal cancellation.
    STATUS: BUILT (awaiting review).
  - **08.05 — Cold-generate at gate + spec-change checkbox regen.** First-contact cold-generate on
    the gate's own checkout (persisted under the commit, never neutral-until-noticed); a
    spec-doc-changing PR is offered a checkbox comment that regenerates scenarios for the head and
    re-gates. STATUS: BUILT (awaiting review).
  - **08.06 — Merge baseline refresh + deploy backfill.** The `guard.baseline` durable job
    (pending-buffer coalescing, shared gate limiter) refreshes the baseline on merge to the default
    branch; a one-time deploy backfill enqueues generate + baseline run for every connected repo.
    STATUS: BUILT (awaiting review).
  - **08.07 — Hosted PR-scoped dashboard guard views + evidence.** The EE Guard lens as a third
    repo-console lens (Coverage / Scenarios / Runs), PR-scoped via the head-SHA tab-ref pattern,
    with per-PR deep links in the Pulls feed and the evidence transcript viewer. STATUS: BUILT
    (awaiting review).
  - **08.08 — PR dismissals overlay + merge promotion.** Per-PR scenario dismissals kept as an
    overlay that promotes into the repo's decisions on merge — the spec-decisions carry-over pattern.
    STATUS: BUILT (awaiting review).
  - **08.09 — Retire verify-gate consumers + guard-failure emails + docs.** Verify runs, the
    drift Check content, inline drift comments, drift-failure emails, the infer checkbox, and the
    workspace-contracts job retire; guard-failure emails (Resend, per-repo `notifyEmails`,
    `gateFailure` pref, sent on Check FAILURE only) take over the notification role. The guard
    Check posts as `TrueCourse / Spec Guard`; the `TrueCourse / Code Quality` violations gate stays
    as a separate signal. Contract generation code and stores stay dormant-but-intact (see the
    RETIREMENT DECIDED note above — they are the future spec→code linking half). Workspace-level
    (cross-repo) contracts drop in v1: a documented known regression (data preserved, returns with
    the spec→code work). STATUS: BUILT 2026-07-14 (sm/spec-guards-ee, awaiting review).
  - **08.10 — Open-conflict gate parity + blocked-generation surface.** The OSS guard-generate
    conflict gate silently never fired in EE (`assertNoOpenConflicts` read the corpus through the
    active spec store keyed by the ephemeral checkout path — a Pg miss), so birth generation ran
    over conflicted corpora: both sides extracted, disputed sections failed birth and settled
    nothing, leaving an empty scenario set with a populated Runs tab. Root fix: the gate reads the
    on-disk materialized `specs/{corpus,decisions}.json` (the generator's own doc authority), and
    the EE materialize step writes `decisions.json` alongside the corpus (also unblocks losing-side
    claim suppression). All three EE entry points handle the gate: onboarding and spec-regen catch
    `OpenConflictsError` and persist a `status: 'open-conflicts'` report (no scenarios, no chained
    baseline run — `generateWasBlocked` suppresses it), the gate's cold-generate settles the Check
    NEUTRAL ("pending spec-conflict resolution", never the error bucket). Blocked outcome notifies
    in-app (warning) and emails via the previously-stub `conflicts` pref
    (`sendGuardConflictsBlocked`). Dashboard: Scenarios tab renders a blocked panel with the LIVE
    open-conflict list (corpus-derived, never snapshotted in the report) deep-linking into the
    Coverage resolver; Runs tab empty state gets the one-line variant. A repo-scope decision that
    clears the last conflict while the guard report is blocked auto-enqueues a hosted guard
    generate (core seam installed by the EE server, alongside the contracts refresh). OSS behavior
    unchanged (interactive hard-fail, nothing persisted). STATUS: BUILT 2026-07-14
    (sm/spec-guards-ee, awaiting review).
  - **08.11 — Review-hardening pass (Check lifecycle + read anchoring + queue bounds).** Fixes
    from the pre-merge review, each pinned by a test. Check lifecycle: a duplicate delivery
    reuses the head's existing queued/in-progress Check run (`findActiveCheck`) instead of
    opening a newer run that would shadow the verdict; the head run + evidence persist BEFORE
    the verdict Check posts (a store failure becomes an infra-error Check, never flips a posted
    verdict); a THROWN enqueue settles only a run the delivery itself created and marks the
    tracked job row failed so the single-flight key frees; stored gate runs carry an optional
    `corpusFingerprint` (sha256 over scenario ids + binds) and the redelivery fast path only
    accepts a stored run whose fingerprint matches the committed corpus — a force spec-regen
    run at the head can no longer flip a red PR green on reopen (untagged legacy runs stay
    accepted). Read anchoring: no-ref hosted reads of the manifest/generate-result resolve
    through the baseline scope like every other reader (a PR's regenerated corpus never leaks
    into repo-level status/coverage), and the job-chain consumers (`hasGuardState`, the
    conflict-resolution and last-dismissal regen hooks) read at the repo baseline commit — no
    baseline means no state, never "newest row". Client: PR guard tabs hold behind
    `GuardPrScopeGate` until the head SHA resolves (loading / explicit "gate hasn't run"
    states), `useGuardRuns` drops selection+cache on scope change, and dismissals are inert
    while the scope is unresolved (`guardReadsEnabled`). Queue bounds: onboarding + baseline
    clones fold a 5-minute wall-clock bound with the job's abort signal (`boundedCloneSignal`;
    `repo.guard` threads `ctx.signal`), so a hung clone can no longer occupy a worker slot
    forever. STATUS: BUILT 2026-07-15 (sm/spec-guards-ee, awaiting review).
  - **08.12 — Spec-regen offer email.** When the spec-change checkbox offer is FIRST posted on a
    PR, the repo's `notifyEmails` also get an email pointer to it (`sendGuardSpecRegenOffer`:
    changed-doc list capped at 10, single CTA deep-linking the checkbox comment via its
    `#issuecomment-<id>` anchor — no dashboard link, the action lives on GitHub). First offer per
    PR only: re-arms on later spec-touching pushes stay silent (the existing comment is the dedup,
    no new state). Fire-and-forget after `createComment` succeeds — an email failure never fails
    or slows the offer; forks included (the email follows wherever the offer goes). Gated on
    Resend configured + non-empty `notifyEmails` + the new `specRegen` notification pref (third
    key in `GithubNotificationPrefs`, default on, PATCHable like its siblings, settings toggle
    "Spec changes"). STATUS: BUILT 2026-07-15 (sm/spec-guards-ee, awaiting review).
  - **08.13 — PR-scoped dismissals regenerate the PR head.** Two gaps found dogfooding PR
    dismissals (a PR dismissal wrote the overlay but nothing ever regenerated, so the held
    section and its findings were zombies): (1) `materializeAndGenerateGuard` gains a `pr`
    option — a PR-head regen merges the PR's `_pr/<n>` decisions overlay over the repo row
    (via the now-exported `prGuardDecisionsRef` + `mergeGuardDecisions`) before materializing
    `scenarios/decisions.json`, the generate-side analog of the gate's `foldDismissals`;
    the head-regen pipeline passes its `prNumber`. (2) A PR-scoped dismissal that leaves the
    PR with ZERO active findings enqueues the durable `guard.spec-regen` job for that PR head
    — the PR analog of the repo-scope last-dismissal regen, riding the new core
    `setGuardPrRegenEnqueue` seam. The route pins the PR's report at its latest gated head
    (heads-lookup seam) and derives "active" from the MERGED decisions (repo ∪ overlay); the
    EE installer (`createGuardPrRegenEnqueue`) resolves the live PR (base/head/fork) from
    GitHub and assembles the request through the checkbox handler's shared
    `buildGuardSpecRegenRequest` (one place for the base-branch fallback + fork detection),
    no-ops when the repo's gate is disabled (the job re-gates), and enqueues with
    `commentId: null` — the spec-regen job's checkbox-comment updates are skipped when there
    is no comment to settle (`commentId` is now nullable). STATUS: BUILT 2026-07-15
    (sm/spec-guards-ee, awaiting review).
  - **Hosted execution tier** — ephemeral job containers / sandboxing, warm per-repo snapshots,
    credential rotation (v1 consciously accepts minimal-env in-app child processes). STATUS: NOT STARTED.

Phases 0–5 are the OSS v1. Phases 6–7 (new drivers) and Phase 8 (EE) are independent tracks
after that — order between them is a call to make when OSS v1 ships.

Contract-surface retirement (CLI commands, dashboard views, EE gate signal migration) was
**deliberately not a phase of this plan** — but it has since happened: the verify surface was
fully removed on 2026-07-13 (see item 24), leaving only the reusable matching engine in-process
for the guard-EE branch.

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
- **Two verification systems coexist** (contract verify + guard run) — RESOLVED: the verify
  surface was fully removed on 2026-07-13 (item 24) and guard is now the only user-facing
  verification engine, so the vocabularies no longer overlap. The contract generation engine
  remains in-process (dormant, the future spec→code linking half — not a competing "drift").
- **EE workspace contracts** (Knowledge plan): the workspace-contracts job retired with the
  Phase-8 gate swap, and guard has no cross-repo equivalent yet — workspace-level (cross-repo)
  scenarios are a later design. The loss of the cross-repo ripple is a **documented known v1
  regression** (data preserved, feature returns with the spec→code linking work); the client
  Knowledge surface points at guard rather than presenting workspace contracts as live.
- **`infer`** stays contract-native. Whether an infer-equivalent exists in the guard world
  (generating scenarios for *undocumented* behavior) is deliberately deferred.

## Reconciliation with main — the d035bede fork (decision sheet, 2026-08-01)

**What happened.** The guard branch forked from main at `0c687519` (2026-07-15). The
battle-test campaign (#757/#762) then landed a parallel guard rewrite on main as one squash —
`d035bede` (2026-07-21, 163 files) — and #835 (CLI API transport, merged 2026-07-31) was built
on top of it. Neither line ever synced; the two guard implementations contradict.

**Strategy (user-decided): revert, not weave.** `guard-base` = `origin/main@75944e73` + a
revert of `d035bede`; `sm/api-spec-guard-v2` = the guard branch rebased onto it (8 stops, all
textual; the guard tree is byte-identical to the branch — signature diff empty). The squash's
content returns selectively via the items below, reimplemented for flows/journeys. The full
68-entry inventory of the squash was reviewed and decided with the user on 2026-08-01; the
reference implementation remains permanently readable at `d035bede` and its pre-squash commits
(`11a0d7a4` … `7d414fb9`).

**Branch mechanics.** `sm/api-spec-guard-v2` is THE working line; old `sm/api-spec-guard` is
frozen (nobody commits to it). When the waves below are green: one force-push swaps
`sm/api-spec-guard` to v2, then `sm/spec-web-sources-plan` (PR #837) is rebased onto it. No
force-push before that point. Delegation: behavior-defining items → Fable agents; scoped
ports → Opus; shared-branch git surgery → inline by the coordinating session.

79. **Reimplementation waves (2026-08-01).** STATUS: BUILT (every wave landed). Wave 0 =
    this decision sheet. Wave 1 = item 84's verbatim ports (G9 tripwire first, then the
    spec-conflict surface). Waves 2–5 = items 80–83 + 85 (adapted reimplementations).
    Wave 6 = item 88 (#835 guard halves). End = full suite green → swap → re-seat
    web-sources.

80. **Birth-failure routing (decided 2026-08-01).** A test that fails its birth run commits
    WITH its diagnosis only when triage blames the repo (`code-drift` / `doc-drift`) — it
    lands as red drift, `guard run` reproduces it, CI breaks. `generation-defect` failures
    are withheld into the auto-resolve loop (item 83); environment-class failures route to
    the needs-setup/blocked machinery and never carry a verdict chip. This supersedes BOTH
    the squash's commit-everything and this branch's withhold-everything carry-forward —
    the birth-finding carry-forward narrows to the withheld classes only. STATUS: BUILT.
    As built: the diagnosis is a field on the committed test's MANIFEST scenario entry
    (`GuardScenarioDiagnosisSchema` — failing journey-step identity, expected/actual, raw
    output, evidence pointer, triage verdict, committed file), so it is part of the same
    commit as the red test and survives every no-op/aborted generate by construction;
    `carryForwardBirthFindings` re-derives committed rows from it (legacy clause: a
    pre-diagnosis failing manifest scenario still carries its prior-report row) and the
    prior-report carry narrows to the withheld classes, carried while their flow is live,
    unsettled, and untouched this run. An UNTRIAGED failure commits (conservative default —
    red drift is never silently withheld); a deterministic setup-declaration defect that
    survives its evidence retry stays a birth error (withheld + tainted), never triaged.
    Routing identity asserted in tests: `written('failing').length === committed finding
    rows`.

81. **Triage — verdicts on tests, rolled up to flows (decided 2026-08-01).** Verdict set is
    THREE: `code-drift` | `doc-drift` | `generation-defect`. The squash's `environment`
    verdict is FOLDED into the existing needs-setup states — a state, not an opinion. A
    verdict (plus confidence, plain-words brief, unblock recommendation) attaches to the
    failing TEST — the evidence is that test's journey transcript, grounded in the request
    surface — and the flow row shows the rollup. Two tests of one flow may carry different
    verdicts; a flow-level verdict would lie about one of them. Opus-tier stage. STATUS:
    BUILT. As built: `guard.triage` stage (default opus), ONE call per failing test after
    every birth round has settled (including the self-heal round's failures); evidence =
    the authored YAML + failing step + expected/actual + raw output, the failing
    milestone's section text, and the request-surface grounding the pipeline already holds
    (cli probe transcripts — a cache hit; api inbound request contracts). The prompt embeds
    `jsonSchemaHint(GuardTriageSchema)`; the engine validates with one corrective re-ask
    then fail-soft (an untriaged failing test still commits). Verdicts content-cached under
    `guard/triage` on the failure identity; estimate row ranges 0..authored pairs like the
    retry stage; the validate line gains a `triaging N/M` counter and the CLI finding line
    renders the verdict as its kind word.

82. **Dismissal model completed (decided 2026-08-01).** Manual dismissal is FLOW-level —
    `dismissedFlows` already exists and generate honors it, but no surface can write it:
    build the dashboard dismiss/un-dismiss on the flow detail (+ route) and a CLI command
    (`guard flows dismiss|undismiss <flow-id>`). Tests are never a manual dismissal unit
    (generated identity — a dismissal would silently stop matching on regenerate).
    `dismissedClaims` stays as the AUTO tier: triage auto-resolutions write there marked
    `auto` with the brief as reason. STATUS: BUILT. As built: `dismissGuardFlow` /
    `undismissGuardFlow` in core beside the claim pair (read-merge-write, idempotent on
    `flowId`, `{ pr }` overlay-scoped identically); two instant routes `POST
    /guard/flows/{dismiss,undismiss}` (no job, no lock, no engine run) answering with
    the updated decisions. DISMISSED IS A MARKER, NOT A STATUS — it rides beside the
    status chip in the flow detail header and on a muted list row (and after the counts
    on the CLI row), because ruling a flow out says nothing about whether it passes; the
    row STAYS in the list, since only the detail can undo it and synthesis keeps
    producing the flow anyway. The marker derives from `decisions.json`, so it appears
    the instant the ruling is made; the `dismissed` coverage status still follows on the
    next generate. `useGuardDecisions` carries both tiers and returns the dismissal
    RECORD (not a boolean), so an `auto` record renders its provenance + reason and
    keeps its undo — the defensive read for a writer that item 83's OPEN-CALL confirms
    does not exist yet. Both CLI writes refuse a miss loudly (dismiss names the
    synthesized ids, un-dismiss names the dismissed ones) rather than writing a dangling
    id or reporting a no-op as success.

83. **Auto-resolve ledger + taint + fidelity self-heal, flow-keyed (decided 2026-08-01).**
    Port the A4/A5/A6/A7 family reshaped: `guard/auto-resolutions.json` (gitignored; the
    gitignore template line returns with it) keyed by flow identity; taint bypasses the
    author cache for a flagged flow and carries the prior mismatch as evidence; a
    HIGH-confidence fidelity flag on a green test auto-discards and re-authors the flow ONCE
    (accepted cost: one flow-authoring call — user-approved); the escalation threshold
    surfaces "re-generation is not fixing this" as a human task. The ledger is the safety
    valve — no auto-resolve behavior ships without it. STATUS: BUILT. As built: the ledger
    keys on flow×surface (`autoResolutionKey`, the generator's own ref shape); BOTH auto
    behaviors — the HIGH generation-defect retirement (`triage-resolve` report row) and the
    HIGH-fidelity self-heal (`fidelity-discard` row with its re-author outcome; the
    reviewer now states a confidence on flagged verdicts, fidelity fingerprint moved
    intentionally) — draw on ONE per-flow budget, escalate past
    `DEFAULT_AUTO_RESOLVE_ESCALATE_AFTER` (2) as a finding carrying
    `autoResolveEscalation`, and a flow that converges (commits a passing test) clears its
    count. The taint set covers fidelity rejections, generation-defect verdicts,
    auto-resolutions of either, and persistent setup-declaration defects; a tainted flow's
    fresh author call carries a PRIOR FLAG user-prompt block (author system prompts
    untouched), a completed call clears the taint, an authoring error keeps it. DECISION
    RECORD (auto tier): `dismissedClaims` gained the `auto`/`reason` fields item 82
    reserves, but with no `environment` verdict nothing in-engine writes an auto dismissal
    today — and an ESCALATED identity deliberately does NOT auto-dismiss (a misjudged real
    bug must never be auto-silenced); the escalated finding re-surfaces each run until a
    human settles it.

84. **Verbatim ports — 20 entries (decided 2026-08-01).** In order: G9 (no test may spawn the
    real `claude` binary — port FIRST); the spec-conflict surface E1/E2/E3/E5/E6/E7/E8
    (resolution briefs + CLI review surface + dashboard Apply — E1 must re-merge with #835's
    `jsonSchemaHint(VerifyResponseSchema)`; E7 ports the expected-vs-ceiling seam only);
    sqlfluff hardening C2/C3/C9/C10/C12 (no-op entry schema reject, silent-entry preflight,
    PYENV_VERSION passthrough, id-stem length cap, invalid-regex rejection at build time);
    authoring honesty B1/B2/B3/B9 (full doc always, live failure lines, authoring-error
    status, deduped errors); G3 (slugs are never UI copy); G8 (renderer resize fix); G11
    (battle-test findings docs). Riding verification tasks: the deterministic recipe
    proposer must fail LOUDLY on a no-manifest repo; confirm bin-declaring workspace-member
    coverage. STATUS: BUILT (all slices). Landed: G9 tripwire; E1 (brief re-merged with the
    request-schema work as one `VerifyResponseSchema` on the wire, layered lenient parsing
    on the read), E2 (glob excludes stayed reverted; `spec status --json` keeps this line's
    no-orphan-line rendering and still carries the array), E3, E5+E6, E7 (seam only — flows
    stages populate it later), E8; C2 (the refine rides `RecipeSchema` AND the model-facing
    `RecipeProposalSchema`, so no path writes a no-op entry), C3 (the result carries which
    gate failed, `crash | silent`; the api preflight reports `crash` — a server has no argv
    to vary), C9, C10 (adapted: the flows line names scenario files from the FLOW ID, so the
    cap + 8-hex hash live at `slugForTitle`; it also kills an order-dependent `-N` collision
    for two long titles sharing a prefix), C12 (widened to every regex the flows scenario
    carries — cli stdout/stderr, api body/headers/json, api log patterns — the api log
    matcher compiled unguarded and would THROW mid-run); B1 (audited: no defect to port —
    flow authoring embeds each bound section's full text verbatim, extraction chunks
    losslessly, and flow synthesis sends outlines by design; landed as a regression test
    pinning the invariant), B2 (the unit is the FLOW: live warn line per failed attempt,
    "· N failed" on the flow counter, and the closing summary lists every failed unit
    deduped with an attempt count), B3 (`authoring-error` coverage status, derived on read,
    ranked above every gap and below anything that produced a test; plain status stays "Not
    generated" — nothing ran; authoring errors gained the `surface` they were for), B9
    (adapted: the flow detail keeps its no-errors-block rule, and the deduped messages +
    attempt counts ride INSIDE the `authoring-error` row); G3 (applied at `flowTitle`: a
    flow the corpus no longer names now reads its committed test's title, never its id),
    G8, G11. Both verification tasks found REAL gaps and both are fixed: a no-manifest repo
    reached the model and paid for an invented recipe (now a loud pre-spend refusal naming
    every manifest it looked for), and the bin-declaring workspace member was invisible to
    both proposers (the deterministic one now takes the single member that declares a `bin`,
    bailing by name on zero or several).

85. **Adapted reimplementations — remainder (decided 2026-08-01).** B4+F4 scenario story with
    an api/journey vocabulary (requests, captures, server lifecycle — one shared renderer,
    CLI + dashboard); B5 retry-with-evidence (journey transcript + the recipe's real
    environment); B7 triage evidence rides the existing request-surface grounding (no
    `ground.ts` revival); B8 `guard findings` read surface (flow-grouped, `--json`); C4
    no-op anomaly re-derived per driver; C5 composition rules per driver + the shared
    validate helpers; C6/C7 verify→revise→re-verify wrapping the deterministic proposer;
    D3 example mining as a flow-synthesis rule (the doc's own example runs verbatim); F3
    tool-defect vs drift chips against the flows finding shape; G5 EE onboarding copies
    every evidence bucket; G15 two-sided promises get two-sided tests (happy + rejection
    half — landed as an authoring rule, see as-built); G12/G14 docs and tests ride their
    features. STATUS: BUILT (complete — the three synthesis-behavior entries C4/D3/G15
    landed 2026-08-01, Wave 5; their as-built notes follow the others below). As built:
    B4+F4 — a committed test carries the flow's `promise` (its goal, denormalized at
    write time like `binds`, additive/optional so no format bump), and
    `describeGuardScenario` (shared) renders the whole file as sentences from ONE
    source: cli argv/stdin/env/exit/stream/file assertions AND the api journey's
    requests, bodies, `capture`/`captureHeaders`, the `${var}` chain, status /
    header / body / json-path / response-schema matchers, the server-process
    lifecycle (boot / signal / logs), plus the world a `setup` block declares (seeded
    files, env, git, http stubs with their unmatched policy and call budgets, the
    externals fault script) and the normalizers. Rendered as the test detail's
    `View · Story · YAML` third mode and by `guard flows --show <id> --story`, both
    derived server-side beside the step list; a file that does not parse yields NO
    story (the caller falls back to its bytes). Both authoring system prompts gained
    the missing title rule — a title states the doc's promise, never the literal
    expected output — which is authored vocabulary, so both fingerprints rolled once.
    B8 — `guard findings`, flow-grouped, over the shared `guardFindingClass`
    taxonomy (`drift` = committed red, `defect` = ours and withheld, `escalation` =
    a defect re-generation stopped fixing), with the auto-resolved ledger under a
    divider, `--kind`/`--flow` filters (an unknown `--kind` is refused, never a
    silently empty list) and a stable `--json` envelope. C5 — composition rules per
    driver in `validate.ts` beside the existing re-ask helpers: cli `run[0]` must not
    restate the entrypoint or name a foreign binary; an api `${var}` must come from an
    EARLIER capture and a `${HTTP_STUB:…}` from a declared stub. Routed through the
    same single corrective re-ask, and applied to the cached read so a pre-rule
    scenario re-authors. C6/C7 — the verify→revise→re-verify loop was already built
    and covered end to end (deterministic proposer first, one evidence retry, full
    re-verification, the working revision replacing the cached reject); what was
    missing and landed is the guidance that makes it converge — lockfile-aware
    install forms and "dropping a failing install is a valid revision". F3 — the
    wire splits `findings` (drift only) from `toolDefects`, the milestone chain
    paints red for drift only, a muted `Tool defect` marker rides beside the flow
    status, and `GuardTriageChip` names the verdict beside a failure (the row's
    verdict falls back to the manifest diagnosis, so a fresh clone still explains its
    red tests). G5 — `guardEvidencePaths` enumerates every bucket (the report's
    findings + the manifest's diagnoses) so the hosted job's one copy out of an
    ephemeral checkout cannot miss one.
    C4 — the no-op birth anomaly, re-derived per driver (the last line of defense
    against a silently inert recipe that got past every preflight). Both drivers
    emit a compact observation per executed birth step; the runner aggregates per
    run (`step-stats.ts`), and generate FOLDS the aggregates across its birth
    rounds — round 1, the retry round, and the self-heal round; never the isolated
    re-confirmations, which re-run already-counted candidates — aborting through
    the existing `recipe-failed` channel the moment a driver's sample trips. Every
    fold point precedes the persist stage, so the abort IS the rollback: no
    scenario files, no manifest, no ledger, no findings, no retry/fidelity/triage
    spend. The cli statistic ports near-verbatim (>= 20 executed steps, >= 90%
    exited 0 with no output in under 10ms; `noOpThresholdMs` rides the executor
    seam as the test knob — the G6 seam ported with it). The api predicate is
    fresh and deliberately has NO timing knob — loopback latency does not separate
    a dead stub from a fast healthy server, so a latency threshold would
    false-positive on exactly the fast healthy APIs the gate must never touch.
    What a dead stub does that a healthy server never does is answer EVERY request
    the same way with NOTHING, so over the same >= 20 sample the api anomaly
    requires >= 90% EMPTY response bodies AND exactly one distinct status across
    every completed request AND >= 2 distinct declared `METHOD path` request lines
    (a single hammered endpoint honestly answering 204-empty can never trip it;
    request lines are the DECLARED step paths, so `${unique}`-interpolated
    variants of one route never counterfeit variety). A timed-out request counts
    as executed but is never inert; a refused connection observed nothing.
    `stepStats`/`anomaly` ride the runner's ok result OPTIONALLY, so the hosted
    gate's stored-run replay (which observes no steps) stays honest.
    D3 — example mining, landed as a deterministic BYTE CONTRACT rather than an
    LLM recognition stage: fenced blocks are mined byte-exact out of each
    milestone's bound section (`examples.ts` — per-section cap, oversized blocks
    skipped, never model-echoed, so no echo can drift a byte), rendered clearly
    bounded (`<<<DOC-EXAMPLE …>>>`) in the authoring user prompt with a
    copy-exactly instruction, and both authoring SYSTEM prompts gained the static
    rule: cli seeds the block as the sandbox input (setup.files / stdin), api
    sends a documented request's bytes as the step body and asserts a documented
    response exactly as shown; a block nothing runs constrains nothing.
    Enforcement is `exampleFidelityDefect`: the scenario's input-side carriers
    (seeded file content, cli stdin, api raw request body — the
    byte-compare-feasible set) are compared against the mined blocks, and a
    NEAR-MISS embedding (equal after whitespace erasure, not byte-equal — the
    reformat class) is rejected on the same single corrective re-ask a
    composition defect gets, applied to the cached read too; the regression
    byte-compares the committed YAML against the doc's block. Recognition
    deliberately does NOT live in flow synthesis: synthesis sees claims and
    outlines only — section text (and thus any fenced block) never enters its
    prompts — so the only stage that reads the surrounding prose, authoring,
    decides WHICH block the scenario runs, under the engine's byte check. Both
    authoring fingerprints rolled once for the wave (dated pins at the exports
    and in the pinned-fingerprint tests).
    G15 — landed as an AUTHORING rule + fidelity mirror, not the sketched
    "two-sided flows", decided from how flows/milestones/scenarios relate on this
    branch: milestones SNAP verbatim onto the extracted claim inventory and
    dedupe by claim identity, so a two-sided promise (ONE claim) structurally
    cannot yield two milestones — forcing it would mean loosening the snap gate
    (what keeps synthesis honest) or re-splitting claims at extraction
    (reopening the over-splitting defect the extraction prompt fights). Instead
    the flow's ONE scenario realizes the milestone with steps for BOTH halves
    ("a milestone may take several steps"): the accepted input asserting the
    documented success, and the rejected one asserting its exclusion OBSERVABLY
    (absent from output, a distinct exit/status, the rejection line). The
    fidelity reviewer flags a one-sided scenario `weak` on the same criterion
    (its fingerprint moved once, pinned), so the author and the auditor cannot
    disagree on what "verifies" means; the regression pins the engine half — a
    positive+negative realization on one milestone commits with the rejection
    step INTACT (the historical failure: it was silently dropped).
    B5 + B7 AUDITED — NOTHING TO PORT, already covered by items 80/81. The birth retry
    already acts on its own evidence: `BirthRetryContext` carries the failing step, its
    expected/actual, and the failing run's RAW output excerpts (a cli step's
    stdout/stderr, an api step's response body + server logs), and the authoring
    prompt's RETRY block renders them under a doc-first rule that forbids weakening an
    assertion to make the retry pass. The authoring prompt already states the runtime
    environment the scenario will run in — the bound server's serve argv and health
    path (or the cli entrypoint), the build command, the declared credentials, the
    seed's fixture catalog, the detected third parties (provided ⇒ real, stubbable ⇒
    `setup.http`, neither ⇒ `blockedOn`), and for cli the empty-sandbox probe
    transcripts plus the "no tools, no repository access" contract. Triage evidence
    (item 81) already rides the request-surface grounding the pipeline holds — cli
    probe transcripts (a cache hit) and the plan's inbound request contracts — so
    `ground.ts`'s CLI-probe revival stays unneeded.

86. **DEFERRED — property flows (invariants over input corpora).** The capability (test
    always/never/idempotent promises by sweeping a committed corpus, failure names the
    input file) is kept but NOT built in this reconciliation: it returns as a flows-native
    design — synthesis detects invariant promises and emits a property-flow kind; the
    `stableOnRerun` / `stdinFromStep` step vocabulary rides with it. Build after the guard
    line lands on main. Open sub-question recorded for then: LLM-generated exemplar packs
    (D2) — leaning NO (doc-mined examples only, via D3). Reference impl inside `d035bede`:
    `af0df48f`, `d3a35dbd`. STATUS: DEFERRED.

87. **DROPPED from the squash (decided 2026-08-01, with reasons).** Family clustering A8
    (+ F5 grouped row, G4 family dismiss fan-out): its premise — bursts of dozens of
    identically-broken per-claim artifacts — does not survive one-call-per-flow authoring,
    and the flows line's setup/preflight/refusal states intercept the burst-generators
    earlier; revisit only on flow-era battle-test evidence. The fast-vs-economical dial A10
    (+ F6 toggle): the dial IS the batch size and flow authoring has no batch — NOTE: `--mode`
    shipped in 0.7.3, so its absence is a changelog-worthy removal when this line lands.
    Plus the remaining obsolete entries (A9, B6-as-code, C1, C8, C11, C13, D4, F2, F7, F8,
    G1, G2, G6, G10, G13) — each superseded by a flows-line equivalent or bound to a dropped
    feature; per-entry reasons live in the reviewed inventory.

88. **#835 guard halves re-add (decided 2026-08-01).** The CLI-API-transport work integrated
    with the squash's generator, so the revert necessarily dropped its guard-side halves:
    per-stage LLM-failure accounting for `guard generate` (`llmFailures`, the `llm-failed`
    abort, the CLI failure lines) and schema-enforced structured output for the guard
    runner stages. Both re-wire into the flows pipeline. They are #836/#838 work, not squash
    features. STATUS: BUILT.

    As built (SCHEMAS): all NINE guard runners send their stage's response schema,
    rendered from the SAME Zod definition the engine validates the reply with — and the
    same one each prompt already embeds as its canonical output contract, so there is one
    wording, never two. SIX are ENFORCED (`guard.extract`, `guard.flows` + the epic pass,
    `guard.match`, `guard.fidelity`, `guard.triage`); THREE opt out explicitly with
    `enforceSchema: false` and a comment naming the construct strict output cannot
    express — authoring (a scenario's `setup.files` / `setup.env` records), the recipe
    proposal (`env`, the `servers` map) and the seed draft
    (`provides.credentials` / `provides.fixtures`). The authoring hint is per DRIVER
    (`AuthoredCliResponseSchema` / `AuthoredApiResponseSchema`), so the wire schema and the
    system prompt the call carries always agree. Every guard reply contract was ALREADY
    object-rooted (JSON mode's one hard rule — #838's authoring reshape has no analogue
    here), so NO prompt text moved and NO fingerprint rolled. The CI gate
    (`tests/llm-api/stage-schemas.test.ts`) now drives all ten guard call sites for real:
    the opt-out list is pinned, every schema must be object-rooted, and a guard stage that
    sends no schema at all fails there instead of at a user's provider.

    As built (ACCOUNTING): `generateGuards` wraps ONE `auditTransport` seam around the
    run — the default `cliTransport()` is materialized in the orchestrator so no stage can
    bypass the counting. ALL NINE runners, fidelity and triage included, spawn on that one
    transport unconditionally; a runner is never built behind a condition (#858: gating the
    two adjudication runners on the CALLER's transport disabled both stages in every OSS
    run, since the OSS CLI installs no default transport — 0 fidelity and 0 triage calls
    across 258, every red test committed with no verdict, while the estimate still priced
    both stages). "This caller has no model access" is therefore never INFERRED: such a
    caller attempts, loses every call, and lands on one of the two rules below — the
    systematic-failure abort for a content stage, the adjudication carve-out for fidelity
    and triage (which no longer abort at all; they ship the corpus annotated and unsettled).
    `llmFailures` (per-stage attempts / failures / first error) rides every result and the
    persisted report; a cache hit never reaches the transport and so is never an attempt.

    THE SYSTEMATIC-FAILURE RULE — a stage aborts the run with `status: 'llm-failed'` when it
    lost EVERY call it made AND that loss would REWRITE what is on disk. The rule covers the
    CONTENT stages only — `guard.extract`, `guard.flows`, `guard.match`, `guard.generate`
    (plus `guard.recipe`/`guard.retry`, which fail their own way). Losing them all means
    nothing was generated, and continuing rewrites the corpus with the outage's emptiness:
    zero flows marks every committed flow orphaned, zero plans or zero authored scenarios
    deletes each changed flow's prior scenario files and then settles it on a hash that
    skips it forever. Each gate sits BEFORE the first write — authoring aborts before birth
    even runs — so the abort IS the rollback.

    THE ADJUDICATION CARVE-OUT (2026-08-05) — `guard.fidelity` and `guard.triage` are
    explicitly OUTSIDE that rule: a systemic loss of either never aborts. They do not gate
    content, they gate VERDICTS ABOUT content that already exists and that birth has already
    executed against the real app, so losing them costs ANNOTATION, not correctness. And
    adjudication is the LAST thing a generate does — extract, flows, match, authoring and
    birth have all been paid for by the time fidelity runs — so aborting there throws away a
    whole run's spend (a 258-scenario generate writing nothing because a 429 storm arrived
    at minute 40) to avoid an unreviewed test. Shipping the corpus annotated is strictly
    cheaper than shipping nothing, and pre-flight cannot protect the user: the outage starts
    after the confirm. This became reachable at all when #858 made both stages spawn
    unconditionally — before that they never ran in an OSS generate, so the abort was dead
    code. The carve-out is exactly two stages wide; every other stage keeps the rule verbatim.

    LOUD, NOT SILENT — the abort existed to make a blind batch impossible to miss, so the
    carve-out replaces it with a record, never with silence. `unadjudicated: [{ stage,
    affected }]` rides the result and the persisted `guard/result.json`
    (`GuardUnadjudicatedStageSchema`, optional so older reports parse), beside the
    `llmFailures` tally that already carries the stage's attempts / failures / first error.
    `affected` is what shipped without a verdict: green tests persisted unreviewed
    (fidelity) / failing tests committed untriaged (triage). Surfaced by `guard generate`'s
    closing summary (a warn block naming the stage and the effect), by `guard status`
    (`unadjudicated (the stage lost every call): fidelity review 41`) and by the dashboard
    generate overview (an amber "Unadjudicated" block). The effect sentence and the remedy
    line have ONE copy — `guardUnadjudicatedEffect` / `GUARD_UNADJUDICATED_REMEDY` in
    `packages/shared/src/guard/summary.ts` — so the terminal and the screen cannot drift.
    The `llmFailures` warn block printed just above swaps its per-call effect for a pointer
    when the same stage is reported unadjudicated: a total loss is ONE story, told once.

    AND THE AFFECTED FLOWS DO NOT SETTLE. This is what makes the remedy true rather than a
    slogan: `unadjudicatedRefs` feeds the settle site, so those flows record NO
    `generationInputsHash`. A settled flow is skipped as unchanged by the next generate, so
    settling here would have left the corpus unadjudicated FOREVER — the exact outcome the
    old abort existed to prevent, reached by a quieter road. Unsettled, the next generate
    re-works exactly those flows, and the re-work is cheap in the way that matters: the
    authoring cache is keyed on flow fingerprint + section keys + journey fingerprints +
    recipe fingerprint, none of which moved, so authoring is a CACHE HIT and no authoring
    call is billed; nothing was cached for the lost review/verdict, so the adjudication call
    is made for real. Pinned in `tests/guard-generator/llm-failure-accounting.test.ts`
    (run 1 leaves `generationInputsHash: null`; run 2 makes 0 authoring calls and 1 review).
    Birth re-executes, which costs time, not tokens.

    THE INTERPLAY with item 81's fail-soft triage is explicit and unchanged per call: ONE
    lost verdict still commits its failure untriaged (the conservative default) and one lost
    fidelity review still unsettles its own flow, so the next generate re-reviews just that
    flow — cheap, because the rest of the run succeeded. Only a TOTAL fidelity loss switches
    that default to "persist unreviewed, leave the flow unsettled, and say so", because
    there the alternative is discarding every green candidate in the run. Only a stage that ATTEMPTED calls can be
    systemic — a caller with no model access makes none and is never gated. The threshold is
    `isSystemicTally` (attempts > 0 and failures === attempts), the same predicate the
    spec-side `curate()` uses.

    TWO LOSS CHANNELS, because the tally only counts calls that THREW: a stage whose calls
    all ANSWERED with output that failed validation twice records no tally at all. Flow
    synthesis and authoring therefore carry engine-level wipeout detection as well —
    `isFlowSynthesisWipeout` (zero flows, unsettled areas, calls spent; it also makes
    `synthesizeFlows` refuse to rewrite the committable `flows.json`) and the authoring
    task counters (every task that reached the runner errored, nothing authored). Matching
    counts its own errored calls the same way. On that path the tally stays EMPTY and the
    `reason` states the loss in `formatStageFailure`'s words.

    SURFACES: `guard generate` exits non-zero on `llm-failed` naming the stage, the first
    underlying error and the affected documents; a run that completed anyway prints a
    per-stage warn block (`claim extraction: 1 of 4 calls failed — affected documents
    yielded no claims…`, first failure quoted) and never closes on an unqualified success
    line; `guard status` renders `llm calls failed: <stage> N/M` and the unadjudicated
    stages from the persisted report.
    The dashboard route returns the abort `reason` and the generate hook toasts an ERROR for
    ANY non-`ok` status — closing the pre-existing hole where `recipe-failed` also read as
    "wrote 0 scenarios".

89. **`guard setup`'s recipe verification is a silent multi-minute step (user report
    2026-08-03).** "Deriving the recipe" spins with zero movement while the engine runs the
    repo's real install, build, entrypoint probe and server boot behind it — the model
    proposal is seconds of that, the rest is the engine. The engine knows exactly which
    phase it is in and never said so. Same class as item 12 (grounding's silent gap) and
    the same rule: all long work visibly ticks. STATUS: BUILT 2026-08-03.

    As built: `discoverRecipe` takes `onPhase` and `draftSeed` takes `onPhase` — plain
    callbacks, so both engine packages stay tracker-agnostic (the `onProgress` convention
    the spec sources fetcher already uses); `probeApiServers` now also fires its `onServer`
    counter at 0, which is what makes the common single-server probe visible at all.
    Verification reports the stage it is ENTERING (`install`, `build`, `entry probe`,
    `services`, `server boot` for the recipe; `services`, `seed script`, `server boot` for
    the seed), and `ProposalVerdict`'s failure now carries that `stage` too, so the
    revision loop can name what sent it back without parsing the diagnostic. `setup.ts`
    formats them onto whichever step is running (`onStepDetail`) and core adapts that to
    `tracker.detail` — one string, so the CLI checklist and the dashboard popup render it
    unchanged. The line states the phase that just finished with its elapsed, then the one
    now running (`build 1m 4s · verifying: entry probe`); no clock and no bars — every
    line is written by a real transition. The analysis pass is reported from `mapOnce`, so
    it lands on step 1 or step 2 depending on which one actually pays for it.

90. **Code Analysis web reference expansion (2026-08-11).** STATUS: BUILT —
    CLAIM-COMPLETE. The hand-authored reference corpus adds 15 stateful web interfaces
    and seven executable mixed-driver flows, scoped to the dashboard's Code Analysis tab.
    The added flows cover committed-state stashing, clean-tree handling, deterministic-only
    LLM execution, path registration and first-analysis state, non-git repositories,
    repository rule settings, and the Rules panel. Existing scenarios were expanded for
    flow search/playback, shared tabs, schema rows, run history and diff details, analytics,
    folder toggles, and graph connection state. The corpus totals are 114 interfaces
    (55 web), 51 settled flows and 51 scenarios. Every one of the 301 dashboard claims is
    accounted for exactly once: 222 by executable milestones and 79 by explicit no-flow
    reasons tied to driver/state limitations. G90 is closed; remaining limitations are
    tracked under G83–G88 and G91 rather than represented as false executable coverage.

91. **Driver vocabulary — the five gaps the reference corpus kept filing (2026-08-11).**
    STATUS: BUILT. The dashboard reference corpus filed the same limitations in step
    notes and in the `transform-gaps.md` ledger run after run (G87, and three of the
    channels G88 enumerates): claims that were perfectly observable were authored
    DELIBERATELY PARTIAL, or rode as no-flow gaps, because the vocabulary had no way to
    say them. Five capabilities, all additive and all optional — `GUARD_FORMAT_VERSION`
    stays 3, every committed scenario parses and behaves exactly as before, and no
    fingerprint moves (see the last paragraph).

    1. **`expect.state` — an ARIA state on a role+name target** (web). The `visible`
       matcher's shape with the assertion added: `{ role, name, exact?, checked? |
       pressed? | selected? | expanded? | disabled? }`, several at once allowed and
       each recorded as its own check, in the fixed order the state list declares.
       The value read is the `aria-*` attribute where present, else the element's own
       state (a checkbox's checkedness, an `<option>`'s selectedness, `:disabled`).
       The deliberate outcome for a control whose position is drawn in COLOUR alone —
       the dashboard's three-way detection switch — is a FAIL reading "…exposes no
       aria-pressed state": the state is unobservable to this step and to a screen
       reader alike, and that is the finding, not a reason to weaken the assertion.
    2. **`expect.attribute` and `expect.class`** (web). `attribute: { of?, name,
       value? | present? }` and `class: { of?, has? | absent? }`, both reading the
       DOCUMENT ELEMENT when `of` names no element — which is where a page keeps what
       it does not print (dark mode is a `dark` class on `<html>` plus a `theme`
       storage key, and the theme button's own name never changes). `class` is its own
       member rather than an attribute matcher because a class attribute is a TOKEN
       LIST: `contains "dark"` also passes for `darkroom`, and a scenario should never
       have to spell token boundaries in a regex.
    3. **`expect.visible` takes a LIST** (web). One expectation, several role+name
       targets, one check each, and a miss names WHICH target was missing. The
       motivating claim — the graph canvas's three icon buttons surviving a reload —
       is one claim, and their accessible names are `aria-label`s that never reach the
       page's text, so neither a text matcher nor three separate steps could state it.
       The single-object form is unchanged.
    4. **`until: { marker }` on a `run` step** (cli). Run until that line appears in
       what the command writes, then terminate the child and settle the step on the
       output so far. This is G87: `truecourse dashboard` (console mode) and
       `dashboard logs` hold the terminal by design, so before this the ONLY outcome
       available to them was the whole budget spent and a SIGKILL, reported as an
       infrastructure error that stops the scenario — which is why
       `open-the-dashboard-and-find-your-way-around` had to put its console step LAST
       with seven milestones riding on it red-by-timeout. A marker that never appears
       is a FAIL naming it (the same reading an unasked prompt earns), never a
       timeout; `expect.exit` beside `until` is refused at load, because a step the
       runner stops has no exit code of its own. Works on pipes and on a pty, and both
       marker features (this and the prompt-keyed answers) now read the child's output
       through one module, `guard-runner/src/marker.ts`.
    5. **`history: back | forward`** (web). The browser's own two buttons, a verb on
       the same footing as navigate/click/fill — the web verb set is closed at five
       now. The traversal's return value is deliberately ignored: a same-document
       (single-page) Back completes without a navigation response, which is exactly the
       case the verb exists for, and what the move DID is the expectation's business.
       The claim "browser Back and Forward move through the views" was previously
       authored as re-opening the earlier address, which proves that a link works.

    **Fingerprint discipline.** `until` is added to a new `GuardRunStepObjectSchema`
    (the runner's `run` step) and NOT to `GuardStepObjectSchema`, which
    `guard-generator` extends for the scenario schema it embeds in the authoring
    prompt — the `patch` precedent applied to a field. Verified after the change:
    `GENERATE_PROMPT_FINGERPRINT` is still `1ee6cde76c89e1d9` and
    `GENERATE_API_PROMPT_FINGERPRINT` still `244fc34ecb318a03`, so no author cache
    entry is invalidated and no flow is re-authored. Flow fingerprints (milestone
    composition) and interface fingerprints (an interface's own steps) never folded
    scenario step content, so neither moves either.

    **As built.** Schemas + rendering: `packages/shared/src/guard/web-steps.ts`,
    `cli-steps.ts`, `step-actuals.ts` (the web check subject enum gains `state` |
    `attribute` | `class`; a step record gains `endedAtMarker`, which the actual line
    renders as "stopped at …" instead of "exit (killed)"). Runner:
    `guard-runner/src/web/{executor,tokens}.ts`, `drivers/cli-driver.ts`,
    `{executor,pty,marker,child-kill,evidence,expect}.ts`. Tests:
    `tests/shared/guard-web-steps.test.ts`, `tests/shared/guard-until-step.test.ts`,
    `tests/guard-runner/web-driver.test.ts` (eight new cases against the fixture's new
    `/controls` page), `tests/guard-runner/run-until-marker.test.ts`.

92. **Near-duplicate chaining collapses distinct endpoint reference pages
    (2026-08-12, cal.com reference corpus).** STATUS: OPEN. On the cal.diy
    booking-lifecycle scan (39 curated docs from cal.com's llms.txt sites), the
    relevance filter's deterministic near-duplicate detector dropped
    `confirm-a-booking.md`, `decline-a-booking.md`, and
    `get-a-booking-by-seat-uid.md` as a PAIRWISE CHAIN (confirm ≈ decline ≈
    get-by-seat-uid ≈ get-a-booking, each hop "kept the fuller copy"), leaving only
    `get-a-booking.md`. The pages are OpenAPI-generated endpoint references: the
    boilerplate (headers table, auth note, response scaffolding) dominates the
    diffable text, so similarity is high even though the documents specify opposite
    operations — confirm vs decline suppressed each other. Two defects to weigh:
    (a) chaining — A≈B, B≈C transitively collapses a whole family no member of
    which is a near-dup of the survivor; (b) the similarity measure ignores the
    identity-bearing tokens of a reference page (method + path + operation title),
    which would cheaply separate these. Remedy used in the field: `spec docs
    include` force-includes (`manualIncludes` in `specs/decisions.json`) — but a
    user only discovers the drop by auditing `skippedDocs`, so the default silently
    deletes spec surface on exactly the doc shape (generated API references) the
    guard pipeline cares most about. Candidate fixes: exempt same-source sibling
    docs whose H1/path differ in an operation verb; fold method+path into the
    similarity key; or cap collapse at direct (non-transitive) pairs.

93. **The visual judge — an LLM annotation on failing web steps (2026-08-12).**
    STATUS: IMPLEMENTED. A web step asserts on the DOM: a role, an accessible name,
    a substring of the page's text. When one misses, the transcript can say the
    words were not found and the run leaves a full-page PNG behind — but the first
    question a human has ("so what WAS on the screen?") is answerable only by
    opening that PNG out of a gitignored evidence directory. This stage answers it
    in the transcript: the screenshot the failing step already took, plus the step's
    claim, its rendered expectation and the deterministic mismatch, go to an
    OPUS-tier vision call that returns
    `{ expectedVisible: yes | no | unclear, screenSummary, rationale }`.

    **The rules, all downstream of §10.2's determinism rule.**
    (a) FAILURE-ONLY: a green run makes zero calls, so the feature is free until
    something breaks — which is why it is always on and has no flag. (b)
    ANNOTATION-ONLY: the verdict never moves an outcome, in either direction. Its
    most valuable answer is `yes` — the expected result IS on screen though the
    assertion missed, the signature of a brittle locator or matcher, i.e. the TEST
    being wrong rather than the page — and that is surfaced to a human in those
    words and acted on by nobody automatically (no triage integration in v1). (c)
    FAIL-SOFT in every direction: no transport, a thrown call, a reply that will not
    validate after one corrective re-ask, a screenshot missing or over the 8 MB
    ceiling — each is a `null` verdict and a run bit-identical to one with no judge.
    One call per failing scenario (the run stops at the first failing step), cached
    on the failure identity so a re-run of an unchanged red board is free.

    **The architecture boundary held.** `guard-runner` stays LLM-FREE: it defines a
    callback TYPE (`GuardVisualJudge`, `visual-judge.ts`) threaded
    `RunGuardOptions` → `GuardExecInput` → `RunScenarioContext`, and `core`'s
    `guardRunInProcess` is the ONE place that supplies an implementation. Every
    other caller of the runner — birth validation, a hosted executor, the whole test
    suite — runs with no judge and reaches no model. The driver seam stayed intact
    too: the runner never asks what KIND of step failed, it reads an optional
    `visual: { screenshotPath, expectation }` off the `fail` outcome that the web
    driver alone supplies.

    **Transports gained vision.** `LlmRequest` grew `images?: LlmImage[]`
    (base64 + media type). The cli backend passes `--input-format stream-json` and
    writes ONE NDJSON user envelope (text block first, then one image block each) —
    the shape the Claude Agent SDK emits; the api backend switches from `prompt:` to
    the AI SDK `messages:` content-parts form; the agent mailbox passes `images`
    through. A text-only request is byte-identical to before on all three.

    **As built.** Transports: `packages/shared/src/llm/transport.ts`
    (`LlmImage`, `buildCliStdinPayload`, `cliInputFormatArgs`),
    `packages/llm-api/src/transport.ts` (`promptInputOf`). Schema:
    `packages/shared/src/guard/visual.ts` (`GuardVisualJudgmentSchema`,
    `visualAnnotation`, `visualJudgeLines`) + an additive optional
    `failure.visual` on `GuardFailureDetailSchema` (NO format-version bump).
    Runner: `guard-runner/src/{visual-judge,run-scenario,run,guard-executor,
    evidence}.ts`, `drivers/{types,web-driver}.ts`. Engine:
    `core/src/services/llm/guard-visual-judge.ts` (stage `guard.visualJudge`, cache
    `guard/visual-judge`, prompt fingerprint, one corrective re-ask, prompt-injection
    framing that treats every pixel as page DATA). CLI: `guard run`'s close prints
    `visual judge N screenshots read · M where the expected result LOOKED present`.
    Tests: `tests/shared/{llm-transport,guard-visual-judge}.test.ts`,
    `tests/llm-api/transport.test.ts`, `tests/core/{guard-visual-judge,
    guard-executor}.test.ts`, `tests/cli/guard.test.ts`,
    `tests/guard-runner/visual-judge.test.ts` (a real browser: the judge fires once
    on a failing web step, never on a green one, never on a cli step, and a judge
    that throws leaves the run untouched).

94. **The teardown channel — scenarios that mutate host state clean up on every
    exit (2026-08-12).** STATUS: IMPLEMENTED. Found by the reference corpus: the
    dashboard area's background-service flow installs a REAL user-level service
    (`dashboard --service`, gated by the `host-service-session` supplied
    dependency) and relied on its last two steps (`stop`, `uninstall`) to remove
    it — but the runner stops at the first failing step, and the sandbox's own
    cleanup cannot touch a launchd/systemd registration. Any mid-scenario failure
    (and, before this item, the guaranteed `logs` follow-mode timeout) left the
    service installed and holding port 3001. No workaround was possible in
    authoring: the format had no way to say "run this even after a failure".

    **The channel.** Cli scenarios (only — the api driver's server lifecycle is
    runner-owned) grew an optional `teardown:` step list, same step union as
    `steps`, additive so NO format bump. Step numbering is CONTINUOUS
    (`steps.length + n`), and every whole-scenario pass walks the one concatenated
    sequence via the new `guardExecutionSteps` helper: the loader's regex/capture/
    milestone cross-checks, the step-list presentation, driver chips, the served-
    surface scan.

    **Semantics.** On a GREEN run teardown steps are ordinary, verdict-affecting
    steps — they may carry milestones (the reference's `stop`/`uninstall` teardown
    steps ARE those claims' proving steps). On every other exit — fail, infra
    error, cancellation, even the `${captured:…}` birth-validation throw — the
    runner executes every not-yet-reached teardown step BEST-EFFORT: without the
    run signal (a cancelled run still restores the host; each step stays bounded
    by the step budget), continuing past its own misses, recorded in the same
    evidence bundle (`teardown` / `teardownMiss` on the step record, an advisory
    block in the transcript), and NEVER moving the settled verdict. A best-effort
    miss surfaces as the result's optional `teardownIncomplete` annotation —
    "host state may remain" is a fact a reader gets told, not a silent leak.

    **As built.** Schema: `shared/src/guard/scenario.ts` (`teardown`,
    `guardExecutionSteps`, `GuardScenarioStepView.teardown`; a named
    `GuardSandboxStepListSchema` alias keeps the doubled step union under the
    TS7056 declaration-emit cap), `shared/src/guard/result.ts`
    (`teardownIncomplete`). Runner: `guard-runner/src/run-scenario.ts`
    (`finishTeardown`, hoisted so the outermost catch restores the host too),
    `evidence.ts`, `scenario-loader.ts`, `claim-refs.ts`, `capture-refs.ts`,
    `run.ts`. Engine/UI: `core/src/commands/guard-read.ts`,
    `dashboard-client` step chips (`teardown` badge). Reference:
    `run-the-dashboard-as-a-background-service.cli.1.yaml` moves `stop`/
    `uninstall` into `teardown:`. Tests:
    `tests/guard-runner/run-scenario-teardown.test.ts`,
    `tests/shared/guard-scenario-teardown.test.ts`.
