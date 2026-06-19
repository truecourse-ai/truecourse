# Drift-FP Detection Automation — Design

A loop that runs Truecourse's **drift verifier** against open-source repos,
identifies false-positive **drifts** (the verifier flagged a spec↔code divergence
that isn't real), and converts each one into an IL-fixture case + comparator/extractor
fix, one PR at a time. It is the **drift-engine sibling** of
[`docs/fp-automation`](../fp-automation/README.md) (which does the same for the
deterministic analysis rules).

Routines are **stateless** cloud sessions, so all cross-session state lives in GitHub:
- **`campaigns.yaml`** (on `main`) — the ordered target list + status + results.
- **GitHub issues** — one per drift-kind with FPs (the fix queue), exactly like the analysis loop.
- A **per-campaign storage branch** `claude/drift-fp-store/<owner>-<repo>` — holds the generated
  specs + contracts for the campaign's lifetime. It's opened as a **storage PR that is never
  merged** (pure storage + the discover trigger) and is **deleted at campaign close**. The
  contracts therefore **never land on `main`** — they live and die on that branch, like the FP
  issues. Only the engine fixes (fixtures + comparator changes) merge to `main`.

The loop runs on **[Claude Code Routines](https://code.claude.com/docs/en/routines)** —
Anthropic-managed cloud sessions triggered by GitHub events. No self-hosted runners.

## How drift FP detection differs from analysis FP detection

The analysis loop runs `analyze --no-llm` — fully deterministic, no setup. The drift
pipeline is **two-phase**: stages 1–2 (`spec scan`, `contracts generate`) use an LLM (the
`claude` CLI) to turn prose specs into `.tc` contracts; stage 3 (`verify`) is deterministic
tree-sitter comparison. **All drift false positives live in stage 3** — the comparators
(`packages/contract-verifier/src/comparator/`) and code extractors
(`packages/contract-verifier/src/extractor/`). The LLM stages only produce the contracts the
deterministic stage checks against.

So the design **generates the contracts once and freezes them on the storage branch**:

> Contracts are generated **once per campaign** (the LLM step) by `drift-fp-generate` and
> **committed to the campaign's storage branch** `claude/drift-fp-store/<owner>-<repo>`. Every
> later routine session — discover, fix, close — fetches that branch and runs only the
> **deterministic `verify`** against those frozen contracts. No routine ever re-runs `spec scan` /
> `contracts generate`, so the verify result for a frozen (contracts, code@`target_ref`) pair is
> reproducible byte-for-byte — the drift analog of `analyze --no-llm`. Freezing (not regenerating
> each session) is what makes the FP-count delta measurable across a fix.

Generation happens **once per campaign**, up front, in the **`drift-fp-generate`** routine, which
runs the LLM stages via the **`--llm-transport agent`** transport (the routine answers the prompts
itself — no `claude` binary or key needed). See
[Generating & storing contracts](#generating--storing-contracts).

> **Why generate once and freeze, instead of regenerating each session?** Determinism. The inner
> loop is *freeze contracts → change the verifier → re-run `verify` → measure the drift-count
> delta*. That only works if the contracts are a fixed baseline. If they were LLM-regenerated each
> session, the baseline would shift run-to-run and "did my fix reduce FPs?" becomes unanswerable —
> the same reason the analysis loop runs `analyze --no-llm`. So generation is a one-time step
> (`drift-fp-generate`, the only LLM routine), and its output is frozen on the storage branch for
> the rest of the campaign.

| | analysis FP loop | drift FP loop |
|---|---|---|
| target run | `analyze --no-llm` (deterministic) | `verify` against **frozen contracts** on the storage branch (deterministic) |
| LLM | never | once per campaign, in `drift-fp-generate` (`--llm-transport agent`); the discover/fix/close loop is LLM-free |
| contract storage | n/a | per-campaign branch `claude/drift-fp-store/<owner>-<repo>` (never merged; deleted at close) |
| FP source | a **rule** (`packages/analyzer/src/rules/…`) | a **comparator / extractor** (`packages/contract-verifier/src/…`) |
| issue unit | one `(rule, repo)` | one `(drift-kind, repo)` |
| target clone | `--depth=1` at HEAD; `target_ref` = whatever HEAD is | **full** clone + `git checkout <target_ref>` (verify needs a real git repo at the *pinned* SHA the contracts were generated against) |
| convergence gate | `tp_rate >= 0.90` | **`fp == 0`** (tp≈0 here, so a TP-rate gate is meaningless) |
| fixture host | `sample-{js,python}-project-{positive,negative}` | `sample-{js,python}-project-il` (one fixture, bidirectional markers) |
| FP marker | add to `…-positive` (asserts zero violations) | add **unmarked** `// FP-GUARD:` code+contract to the IL fixture (asserts no drift) |
| TP/regression marker | `// VIOLATION: <rule-key>` in `…-negative` | `// IL-DRIFT: <drift-key>` in the IL fixture |

## Goal

Targets and order are defined in `docs/drift-fp-automation/campaigns.yaml`. The flow is **one
LLM "generate" step at the front, then a fully-deterministic verify loop.** All routine sessions
run `node $TRUECOURSE_DIR/dist/cli.mjs` from a fresh `pnpm build:dist` (the bytes publish.yml
ships; never `npx truecourse`).

1. **drift-fp-generate** (the only LLM routine) picks the next `pending` campaign with no storage
   branch yet, clones the target, scopes its `.md` specs with a `.truecourseignore`, runs
   `spec scan → spec resolve --all-defaults → contracts generate` **via the `--llm-transport agent`
   transport** (the routine answers the prompts itself — no `claude` subprocess, no key), and
   **commits** the generated **specs + `.tc` contracts + scope +
   `meta.yaml`** onto a new branch **`claude/drift-fp-store/<owner>-<repo>`**. It opens a **storage
   PR** (base `main`) labelled `drift-fp-store`. **This PR is never merged** — it just holds the
   contracts and fires discover when it opens.
2. **Opening the storage PR** fires **drift-fp-discover** (no human review of contracts): it
   fetches `claude/drift-fp-store/<owner>-<repo>`, clones the target at the `target_ref` from
   `meta.yaml`, copies the contracts into `/tmp/target/.truecourse/contracts/`, runs
   `verify --no-stash` (deterministic, no LLM), and reads
   `/tmp/target/.truecourse/verifier/LATEST.json` `.drifts[]`.
3. Triage drifts into TPs (genuine spec↔code divergence) / FPs (extraction or comparison
   artifact) / borderline.
4. For every **drift-kind** with ≥1 FP, file one GitHub issue labelled `drift-fp-fix`
   (drift-kind = comparator + obligation family, e.g. `operation/implementation-missing`,
   `named-constant/value-mismatch`, `enum/no-code-counterpart`). Open a discovery PR (to `main`)
   labelled `drift-fp-discover` updating `campaigns.yaml` with `status: discovering` + baseline
   `fp`/`fp_rate`. The user merges it to start the inner loop.
5. **Merging the discovery PR** fires `drift-fp-next-fix-bootstrap` (the same prompt as
   `drift-fp-next-fix`, just a second trigger). The fix loop consumes open
   `drift-fp-fix` issues in **batches of up to 5 per session**. For each issue:
   a. Paraphrase the FP-triggering **(contract, code) pair** into the IL fixture
      (`sample-{js,python}-project-il`) **without** an `// IL-DRIFT:` marker (and with a
      `// FP-GUARD: <drift-kind>` header) — the IL end-to-end test asserts the verifier's drift
      set equals the marker set *exactly*, so an unmarked case that drifts fails the test until
      the comparator/extractor is fixed.
   b. Add a paraphrased genuine-drift counterpart with `// IL-DRIFT: <drift-key>` so the fix
      doesn't over-correct and silence real drift.
   c. Fix the comparator / extractor under `packages/contract-verifier/src/` until both the
      FP-guard (no drift) and the regression (still drifts) hold and full `pnpm test` is green.
   At the end of the batch: commit, push `claude/drift-fp-fix/batch-<YYYYMMDDHHMM>`, open one
   PR that closes all N issues + a `## Drift-count delta` table.
6. Each batched **fix PR targets `main`** (engine fixes land on `main`, exactly like analysis);
   its merge fires the next batch. The storage branch is never touched by fix PRs.
7. When no `drift-fp-fix` issues remain, `drift-fp-next-fix` **re-runs verify against the
   freshly-built dist** (with all merged fixes) on the frozen contracts (fetched from the storage
   branch) and re-triages. If **no false-positive drifts remain (`fp == 0`)**, it opens a
   **campaign-close PR** to `main` (bumps version, flips `status: done`). If FPs remain (`fp > 0`),
   it files new `drift-fp-fix` issues; the campaign continues.
8. When the campaign-close PR merges, two routines fire in parallel:
   `drift-fp-campaign-close` pushes `vX.Y.Z` (publish.yml ships from dist) **and closes the
   storage PR + deletes `claude/drift-fp-store/<owner>-<repo>`** (the contracts were scaffolding —
   they never reach `main`); and **`drift-fp-generate` starts the next pending campaign**
   (generate → storage PR → discover → …).

### TP/FP rubric (shared by discover and the close gate)

Classify each sampled drift as exactly one of:
- **TP** — a genuine spec↔code divergence the verifier correctly flags.
- **FP** — the verifier is wrong (symbol exists in a shape it didn't lift; collided two unrelated
  symbols; didn't reconstruct a route mount).
- **info / borderline** — chiefly `*.no-code-counterpart` (the verifier honestly reports it
  couldn't bind a documented symbol). Tracked as `info`; **excluded from the ratio** until a
  human confirms it FP or TP.

Then: `fp` = FP count, `tp` = TP count, `info` = the excluded bucket, and
`fp_rate = fp / (tp + fp)` (define `fp_rate = 0` when `tp + fp == 0`).

**Convergence is `fp == 0`, not a TP-rate threshold.** These targets have ~0 genuine drift
(tp≈0), so a "tp_rate ≥ 0.90" gate (as the analysis loop uses) is unreachable/meaningless here —
`0/(0+fp) = 0`. The loop drives the verifier toward **emitting no false positives**. The campaign
closes when a re-verify yields `fp == 0` (every remaining drift is a genuine TP or a
human-accepted `info`). `tp_rate` is reported for parity (define `= 1.0` when `fp == 0`).

### Campaign-close PR

When `drift-fp-next-fix`'s queue-empty path measures **`fp == 0`** against the freshly-built
dist, it opens a campaign-close PR that:

- Sets `status: done` for the campaign in `docs/drift-fp-automation/campaigns.yaml` and fills
  `final.*` (verified_at, target_ref, total_drifts, tp, fp, info, fp_rate).
- Bumps the **patch** version (drift FP fixes are bug fixes) in all four required places, per
  CLAUDE.md "Releasing":
  1. `tools/cli/package.json`
  2. `packages/core/package.json`
  3. `apps/dashboard/server/package.json`
  4. `tools/cli/src/index.ts` — the `.version("X.Y.Z")` call
- Carries label **`drift-fp-campaign-complete`**.
- Branch `claude/drift-fp-campaign-close/<owner>-<repo>`.

On merge, `drift-fp-campaign-close` pushes the tag and `drift-fp-generate` fires on the same
event to start the next pending campaign (generate → pin → discover → …) — both in parallel,
each doing one job.

### Drift-kind grouping (the issue unit)

A **drift-kind** is the *shape* of a failure, independent of which specific identity/value
triggered it — so every `constant.<X>.value-mismatch` collapses into one fixable kind. Derive it
as `<artifact-type-slug>/<obligation-family>`:

- `<artifact-type-slug>` = `artifactRef.type` kebab-cased (`Operation`→`operation`,
  `NamedConstant`→`named-constant`, `Enum`→`enum`, `StateMachine`→`state-machine`,
  `QueryRule`→`query-rule`, …).
- `<obligation-family>` = the `obligationKey` with the artifact **identity and any specific
  value stripped out**, reduced to its descriptive tail. Concretely:

  | Example `obligationKey` (from the engine) | drift-kind |
  |---|---|
  | `implementation.missing` | `operation/implementation-missing` |
  | `response.201.headers.location` | `operation/response-header` |
  | `response.2xx` / `response.200` | `operation/response-status` |
  | `constant.ACTIONS.value-mismatch` | `named-constant/value-mismatch` |
  | `constant.maxPendingReleases.no-code-counterpart` | `named-constant/no-code-counterpart` |
  | `enum.ReleaseStatus.no-code-counterpart` | `enum/no-code-counterpart` |
  | `enum.OrderStatus.extra-value.archived` | `enum/extra-value` |
  | `transition.illegal.shipped-to-paid` | `state-machine/illegal-transition` |
  | `query.predicate.missing.tenant_id` | `query-rule/predicate-missing` |

  Rule of thumb: drop the segment that is the artifact identity (`ACTIONS`, `ReleaseStatus`, …)
  and any trailing concrete value (`archived`, `tenant_id`, a status number); keep the verb/family
  (`value-mismatch`, `no-code-counterpart`, `extra-value`, `missing-value`, `implementation-missing`,
  `illegal-transition`, `predicate-missing`, `response-status`, `response-header`). When unsure,
  list `obligationKey` samples in the issue so the family is auditable.

### Borderline drifts

If a session is uncertain whether a drift is a TP or FP, it does **not** auto-fix. It posts a
comment tagged `borderline:` (on the discovery PR, or on a `drift-fp-fix` issue if one exists for
the kind) with the drift key, the code URL **if any** (see the carve-out below), the contract
path, and a one-paragraph case each way. A human adds `drift-fp-confirmed` (→ the maintainer or
next discover run files it as a normal `drift-fp-fix` issue the loop then consumes) or
`drift-tp-confirmed` (→ accepted as genuine; not fixed). The loop never auto-fixes an unconfirmed
borderline — it only consumes plain `drift-fp-fix` issues.

**`*.no-code-counterpart` carve-out.** These are the most common borderline shape: the verifier
reports it couldn't bind a documented enum/constant to a *named* code symbol. Two engine facts
the prompts must respect: (1) such a drift sets `filePath` to the **spec symbol name** (not a code
file) and `lineStart: 0`, so there is **no code URL / file:line** to cite — say "no code location
(coverage gap)" instead; (2) the fixture language is decided from the campaign's
`tech_stack`/`code_dir`, not from the drift's `filePath`. Whether it's an FP (extractor coverage
gap — the symbol exists in a shape we don't lift, e.g. a strapi inline schema enum) or a real
omission needs judgement; treat as `info`/borderline unless clearly one.

### Comparator / extractor refactors

If fixing a drift-kind requires a refactor beyond the comparator/extractor itself — a new
mount-graph pass, threading new resolver state, a new code-fact channel — the session does
**not** attempt it. It opens the PR with the fixture additions and a `## Refactor needed`
section, labels it `needs-design`, and ends. The user decides whether to greenlight it.

### Fixture convention (confirmed against the repo)

The drift fixtures use **one project per language** with a bidirectional marker test, instead
of the analysis loop's two `positive`/`negative` projects.

`tests/contract-verifier/verify-end-to-end.test.ts` (and `verify-python-end-to-end.test.ts`):
> Parses every `// IL-DRIFT: <drift-key>` marker in the fixture's code tree, runs the verifier,
> and asserts the verifier's drift set **equals the marker set exactly** — no missing (false
> negative), no extras (false positive). `drift-key` is `<ArtifactType>:<identity> / <obligationKey>`.

Marker-scan roots differ by language: the **JS** test scans `code/src/`, the **Python** test
scans the whole `code/` tree. So author fixture code under the language's existing layout — JS
under `code/src/`, Python under `code/app/` (the Python fixture has no `src/`) — and keep markers
inside those roots, or the engine will fire a drift the marker parser doesn't count (an
"unexpected drift" failure).

So a drift FP fix means, in `tests/fixtures/sample-{js,python}-project-il/`:

- **FP-guard case** — add the paraphrased FP code under `code/src/` **with no `// IL-DRIFT:`
  marker** and a `// FP-GUARD: <drift-kind>` header comment, plus the matching `.tc` contract
  under `reference/contracts/` that the verifier (wrongly) drifts against. Before the fix, the
  verifier fires an *unexpected* drift → the "no extras" assertion fails.
- **Regression case** — add a paraphrased genuine-drift code shape with `// IL-DRIFT:
  <drift-key>` and its contract, so the comparator/extractor must **still** fire for the real
  divergence (guards against over-correcting into a false negative).
- After the comparator/extractor fix: the FP-guard case yields no drift, the regression case
  still drifts, and the marker set matches exactly.

(The existing IL fixture already contains a precedent FP-guard test — *"traces single-file
delegation handlers (no implementation.missing FPs)"* — asserting zero `implementation.missing`
drifts for delegated route handlers. New FP-guards follow the same spirit.)

## Architecture

Each box is a routine. Arrows are GitHub events: the generate→discover hop is a `pull_request.opened`
(the storage PR); every other hop is a `pull_request.closed` (merged), filtered by head-branch
prefix + label. The only LLM work is the first box; everything else is deterministic `verify`.

```
   [Run now / campaign-close merge]
              │
              ▼
┌──────────────────────────────────────────────┐
│ Routine: drift-fp-generate   (ONLY LLM step)  │
│ pick next pending campaign w/ no store branch;│
│ spec scan + contracts generate via --llm-transport agent│
│ (routine answers prompts); commit specs+      │
│ contracts onto a NEW branch.                  │
│ → STORAGE PR  claude/drift-fp-store/<o>-<r>   │
│   label drift-fp-store   (NEVER merged)        │
└───────────────┬──────────────────────────────┘
                │ storage PR OPENED  (pull_request.opened)
                ▼
┌──────────────────────────────────────────────┐
│ Routine: drift-fp-discover                    │
│ fetch store branch; clone @ meta.target_ref;  │
│ copy contracts; verify --no-stash (NO LLM);   │
│ triage TP/FP; file drift-fp-fix issues.       │
│ → PR (to main) claude/drift-fp-discover/…     │
│   label drift-fp-discover                      │
└───────────────┬──────────────────────────────┘
                │ merge discovery PR → fires drift-fp-next-fix-bootstrap
                ▼
┌──────────────────────────────────────────────┐
│ Routines: drift-fp-next-fix (+ -bootstrap)    │
│ fetch store branch for contracts. Batched ≤5  │
│ fixes (cap 10). Per issue: lock, paraphrase FP│
│ (contract+code) into IL fixture UNMARKED      │
│ (+FP-GUARD), add IL-DRIFT regression, fix     │
│ comparator/extractor, tests green.            │
│ → PR (to MAIN) claude/drift-fp-fix/batch-<ts> │
│   label drift-fp-fix; Closes #N + delta table │
│ ── queue empty & fp==0 → campaign-close PR    │
│ ── queue empty & fp >0 → re-discover          │
└───────────────┬──────────────────────────────┘
                │ each fix-PR merge → next batch; when fp==0:
                │ PR (to main) claude/drift-fp-campaign-close/… label drift-fp-campaign-complete
                ▼
┌──────────────────────────────────────────────┐
│ Routine: drift-fp-campaign-close              │
│  (∥ drift-fp-generate — same trigger)         │
│ read version, check 4 locations, git tag &    │
│ push (publish.yml ships). CLOSE the storage   │
│ PR + delete claude/drift-fp-store/<o>-<r>.    │
│ No verify — next-fix already measured fp==0.  │
└───────────────┬──────────────────────────────┘
                │ same merge also fires drift-fp-generate → next campaign
                └────────────────────► (loop)
```

## Generating & storing contracts

Generation happens **once per campaign** by `drift-fp-generate`, and the output is **committed to
the storage branch `claude/drift-fp-store/<owner>-<repo>` — never to `main`.** The branch is the
durable, campaign-scoped store every later session reads from; it's deleted when the campaign
closes. On that branch, `docs/drift-fp-automation/contracts/<owner>-<repo>/` holds:

```
specs/                # claims.json + decisions.json — the frozen consolidated spec
contracts/            # the generated .tc tree (verify reads this)
truecourseignore      # the doc-scope used (provenance)
meta.yaml             # { target_repo, target_ref, code_dir, generated_at, doc_scope[], tool_version, llm }
```

(Storing `specs/` too means contracts can be re-derived later — after an extractor improvement —
without re-running the expensive `spec scan`.) This path does **not** exist on `main`; the
per-campaign content lives only on storage branches.

Later sessions read it with `git fetch origin claude/drift-fp-store/<owner>-<repo>` and copy
`contracts/` into `/tmp/target/.truecourse/contracts/`, then run `verify --code-dir <meta.code_dir>`
— no regeneration.

**Maintainer fallback** (to seed a campaign by hand instead of letting `drift-fp-generate` run):
generate the stages locally where `claude` is signed in and push the same storage branch + open
the storage PR:

```bash
pnpm install && pnpm build:dist
git clone https://github.com/<owner>/<repo>.git /tmp/<repo>
cd /tmp/<repo> && git rev-parse HEAD                      # record as target_ref
# write /tmp/<repo>/.truecourseignore (the doc scope; gitignore semantics)
node $TRUECOURSE_DIR/dist/cli.mjs spec scan               # --llm cli uses the local claude login
node $TRUECOURSE_DIR/dist/cli.mjs spec resolve --all-defaults
node $TRUECOURSE_DIR/dist/cli.mjs contracts generate
node $TRUECOURSE_DIR/dist/cli.mjs contracts validate
# on a NEW branch claude/drift-fp-store/<owner>-<repo>, commit specs/ + contracts/ + truecourseignore
#   + meta.yaml under docs/drift-fp-automation/contracts/<owner>-<repo>/, push, and open the
#   storage PR (base main, label drift-fp-store) — do NOT merge it.
```

## State: one issue per drift-kind

Each `drift-fp-fix` issue is the source of truth for one `(drift-kind, target repo)` pair. Body
is a machine-readable YAML block followed by a human-readable section.

```yaml
target_repo: strapi/strapi
target_ref: e666ee2…                  # the SHA the contracts were generated at (from meta.yaml)
contracts_branch: claude/drift-fp-store/strapi-strapi   # storage branch holding the contracts
contracts_path: docs/drift-fp-automation/contracts/strapi-strapi   # path within that branch
drift_kind: operation/implementation-missing   # comparator + obligation family
comparator: packages/contract-verifier/src/extractor/operation.ts   # likely fix site
fp_count: 20
samples:                               # up to 5 representative FP drifts
  - drift_key: 'Operation:GET /content-releases/{id} / implementation.missing'
    code_url: https://github.com/strapi/strapi/blob/e666ee2/packages/core/content-releases/server/src/routes/release.ts#L20
    contract: content-releases/operations/get-content-releases-id.tc
    why_fp: "route exists as relative path '/:id' mounted under /content-releases; extractor doesn't reconstruct the mount prefix"
  - …
status: open                           # open | in_review | merged | skipped | blocked
pr: null
```

Labels:
- `drift-fp-fix` — gates the **drift-fp-next-fix** routine.
- `drift-fp-target:<owner>-<repo>` — groups issues by campaign; used to detect "campaign done".
- `drift-fp-in-progress` — concurrency lock; set the moment a session picks an issue.
- `drift-fp-skipped` / `drift-fp-blocked` — set when bailing out.

The Claude session is the only writer. Ordering is "oldest open issue without
`drift-fp-in-progress` first".

## Triggers: five Routines

The chain is **generate → storage PR opened → discover → discovery PR merge → fix loop →
campaign-close PR merge → (close tags + cleans up + generate starts next)**. Every hop is a
`pull_request.closed` (merged) event, **except** generate→discover which is `pull_request.opened`
(the storage PR is never merged). Each routine is filtered by **head-branch prefix only** — the
prefix is unique per routine, so the label is redundant as a trigger. **Labels are not trigger
filters**; they only organize issues (finding open work, `*-blocked` / `*-skipped` state, the
Telegram burst rollup). Configure each routine's GitHub trigger on the branch prefix alone.

| PR event | Branch (trigger) | Fires |
|---|---|---|
| **opened** | `claude/<SCOPE>drift-fp-store/` | `<SCOPE>drift-fp-discover` |
| merged | `claude/<SCOPE>drift-fp-discover/` | `<SCOPE>drift-fp-next-fix-bootstrap` |
| merged | `claude/<SCOPE>drift-fp-fix/` | `<SCOPE>drift-fp-next-fix` |
| merged | `claude/<SCOPE>drift-fp-campaign-close/` | `<SCOPE>drift-fp-campaign-close` (tag + cleanup) **+** `<SCOPE>drift-fp-generate` (next campaign) |

`<SCOPE>` is the per-account prefix (empty for the default account; `cs-` for the C# account) —
see [Scopes (multi-account)](#scopes-multi-account). The very first campaign is bootstrapped with
**Run now** on `drift-fp-generate`.

All run as Anthropic-managed cloud sessions on the **Default** environment. Configured at
[claude.ai/code/routines](https://claude.ai/code/routines). As in the analysis loop,
`drift-fp-next-fix` and `drift-fp-next-fix-bootstrap` are two routines sharing one prompt (the
Routines UI allows one GitHub trigger per routine).

**Prompt convention**: the routine config holds a tiny bootstrap pointer; the real instructions
live under `docs/drift-fp-automation/prompts/<routine>.md` (source of truth, edited via PR).

Bootstrap pointer (paste into each routine's prompt field, substituting the file name):

```
Execute the instructions in `docs/drift-fp-automation/prompts/<routine>.md` from the cloned
`truecourse-ai/truecourse` repository. Treat that file as the authoritative prompt; follow
every step exactly. If the file is missing or unreadable, post a short failure note in the
session and end.
```

For a **scoped** account, append the two parameters the prompt's "Routine parameters" section
reads (omit them on the default account — empty is the default and behaves identically):

```
Parameters: SCOPE=cs-  TECH_STACKS=csharp
```

### Scopes (multi-account)

The same chain can run on more than one account over **disjoint** campaign sets — e.g. the default
account handles TS/JS + Python while a second account handles **C# only**. Both accounts clone the
same `truecourse-ai/truecourse` and share one `campaigns.yaml`; isolation comes from two prompt
parameters (defined in every prompt's "Routine parameters" section):

- **`SCOPE`** prefixes every branch, label, and issue-title tag (default empty; C# uses `cs-`). Since
  each routine triggers on its branch prefix, a `cs-`-scoped routine only ever wakes on `cs-…`
  branches and only reads/writes `cs-…` labels + titles — it never collides with the default
  account, and vice versa.
- **`TECH_STACKS`** filters campaign selection by each campaign's `tech_stack` (default empty = all;
  C# uses `csharp`). This is what stops the C# account's `generate`/`discover` from picking a
  TS/JS/Python campaign.

To stand up the C# account: create the five routines below on it, each with its branch-prefix
trigger using the `cs-` prefix (e.g. `claude/cs-drift-fp-fix/`), and paste the bootstrap pointer
with `Parameters: SCOPE=cs-  TECH_STACKS=csharp`. Add C# repos to `campaigns.yaml` with
`tech_stack: [csharp, …]`. The default account needs **no change** — omitting the parameters keeps
its behavior byte-identical.

### 1. `drift-fp-generate` (the only LLM routine)

| Field | Value |
|---|---|
| **Trigger** | `pull_request.closed` on `truecourse-ai/truecourse` |
| **Filters** | `Is merged` = `true` AND `Head Branch` starts-with `claude/<SCOPE>drift-fp-campaign-close/` |
| **Bootstrap** | First-time run is **Run now** (no campaign-close PR has merged yet). |
| **Environment** | Default |
| **Prompt** | pointer → `drift-fp-generate.md` |

Shares its trigger with `drift-fp-campaign-close` — both fire in parallel on each campaign-close
merge (close tags + cleans up the finished campaign; generate starts the next). Picks the first
`pending` campaign **with no `claude/drift-fp-store/<owner>-<repo>` branch yet** (branch existence,
not a yaml flag, is the "already generated" signal), runs the LLM stages via `--llm-transport agent`, commits
specs + contracts to a new `claude/drift-fp-store/…` branch, and opens the storage PR (label
`drift-fp-store`, **never merged**).

### 2. `drift-fp-discover`

| Field | Value |
|---|---|
| **Trigger** | `pull_request.opened` on `truecourse-ai/truecourse` |
| **Filters** | `Head Branch` starts-with `claude/<SCOPE>drift-fp-store/` |
| **Environment** | Default |
| **Prompt** | pointer → `drift-fp-discover.md` |

Fires when the storage PR is **opened** (contracts are now on the storage branch — no human review).
Fetches `claude/drift-fp-store/<owner>-<repo>`, clones the target at `meta.target_ref`, runs
deterministic `verify` against the contracts, triages, files `drift-fp-fix` issues, and opens the
discovery PR to `main` (`claude/drift-fp-discover/…`, label `drift-fp-discover`).

### 3. `drift-fp-next-fix` (+ `-bootstrap`)

| Field | `drift-fp-next-fix` | `drift-fp-next-fix-bootstrap` |
|---|---|---|
| **Trigger** | `pull_request.closed` | `pull_request.closed` |
| **Filters** | merged=true AND Head Branch starts-with `claude/<SCOPE>drift-fp-fix/`  | merged=true AND Head Branch starts-with `claude/<SCOPE>drift-fp-discover/`  |
| **Environment** | Default | Default |
| **Prompt** | pointer → `drift-fp-next-fix.md` | pointer → `drift-fp-next-fix.md` |

Batched: up to 5 successful fixes (cap 10 attempts) per session; one PR at the end. See
`prompts/drift-fp-next-fix.md` for the full per-issue mechanics.

### 4. `drift-fp-campaign-close`

| Field | Value |
|---|---|
| **Trigger** | `pull_request.closed` on `truecourse-ai/truecourse` |
| **Filters** | merged=true AND Head Branch starts-with `claude/<SCOPE>drift-fp-campaign-close/`  |
| **Environment** | Default |
| **Prompt** | pointer → `drift-fp-campaign-close.md` |

Reads the new version, sanity-checks the four locations, tags `vX.Y.Z`, and **cleans up the
finished campaign**: closes the storage PR and deletes `claude/drift-fp-store/<owner>-<repo>`.
`drift-fp-generate` fires on the same event in parallel to start the next campaign.

## Setup checklist

1. **Install the Claude GitHub App** on `truecourse-ai/truecourse`.
2. **Enable "Automatically delete head branches"** in repo settings.
3. **Add the first campaign** to `campaigns.yaml` (`status: pending`, with `code_dir` + `doc_scope`).
4. **Create the five routines** at claude.ai/code/routines, each with a bootstrap pointer
   (substitute the file name) on the **Default** environment (Trusted network covers GitHub +
   the OSS repos we clone; `pnpm install && pnpm build:dist` runs as the prompt's first step; no
   env vars or API keys). The five (trigger = the PR event/branch/label from the table above):
   - `drift-fp-generate` → `drift-fp-generate.md`; trigger **merged** `claude/drift-fp-campaign-close/`
     + `drift-fp-campaign-complete` (+ Run now to bootstrap). The **only** routine doing LLM work
     (via `--llm-transport agent`).
   - `drift-fp-discover` → `drift-fp-discover.md`; trigger **opened** `claude/drift-fp-store/` +
     `drift-fp-store` (note: `pull_request.opened`, not merged).
   - `drift-fp-next-fix` → `drift-fp-next-fix.md`; trigger **merged** `claude/drift-fp-fix/` + `drift-fp-fix`.
   - `drift-fp-next-fix-bootstrap` → **same pointer** (`drift-fp-next-fix.md`); trigger **merged**
     `claude/drift-fp-discover/` + `drift-fp-discover`. **Two routines share one prompt**,
     differing only in trigger (the Routines UI allows one GitHub trigger per routine) — don't
     point it at a different file or the inner loop won't kick off on the discovery-PR merge.
   - `drift-fp-campaign-close` → `drift-fp-campaign-close.md`; trigger **merged**
     `claude/drift-fp-campaign-close/` + `drift-fp-campaign-complete` (shares the trigger with `drift-fp-generate`).
   Verbatim pointer to paste (swap the filename):
   > Execute the instructions in `docs/drift-fp-automation/prompts/<routine>.md` from the cloned
   > `truecourse-ai/truecourse` repository. Treat that file as the authoritative prompt; follow
   > every step exactly. If the file is missing or unreadable, post a short failure note and end.
5. **Bootstrap** by clicking **Run now** on `drift-fp-generate`. It generates the contracts and
   opens the storage PR — which immediately fires `drift-fp-discover` (no merge needed).
6. From there it's **automatic**: storage PR opened → discover files issues + opens the discovery
   PR → **merge the discovery PR** → fix loop. The only human gate is reviewing + merging the
   discovery PR and each fix PR (contracts are not reviewed).
7. **Loops are automatic**: inner loop per fix-PR merge; outer loop per campaign-close merge (which
   tags, cleans up the storage branch, and fires `drift-fp-generate` for the next campaign).

## Acceptance criteria

A **drift-fp-fix PR** is mergeable when:

- Contains 1–5 drift-kind fixes (typically 5).
- For each: a new **FP-guard** IL-fixture case (code with no `// IL-DRIFT:` marker + its `.tc`
  contract; verifier emits no drift), a new **regression** case (code with `// IL-DRIFT:
  <drift-key>` + contract; verifier still drifts), and a scoped comparator/extractor edit under
  `packages/contract-verifier/src/`.
- Full `pnpm test` green (the IL end-to-end marker test included).
- Body has one `Closes #N` per fixed issue, per-drift-kind sections with OSS source URLs (URL
  only — no paste), fixture diffs, and a `## Drift-count delta` table (verify on the frozen
  contracts before/after, per drift-kind).
- Branch `claude/drift-fp-fix/batch-<YYYYMMDDHHMM>` **(base `main`)**, label `drift-fp-fix`.

A **campaign-close PR** is mergeable when:

- The campaign in `campaigns.yaml` is `status: done` with `final.*` filled.
- Patch version bumped consistently in all four locations.
- No other file changes (no contracts — those never reach `main`).
- Branch `claude/drift-fp-campaign-close/<owner>-<repo>`, label `drift-fp-campaign-complete`.

## Resolved decisions

1. **Generate once, freeze on a storage branch.** The LLM stage (`spec scan` + `contracts
   generate`) runs once per campaign in `drift-fp-generate` (via `--llm-transport agent`) and is committed to
   `claude/drift-fp-store/<owner>-<repo>` — **never to `main`** (the storage PR is never merged;
   the branch is deleted at close). Every other routine fetches that branch and runs only
   deterministic `verify`. Freezing (not regenerating) is what makes the FP-count delta measurable.
2. **FP source is the verifier, not the contracts.** Fixes land in
   `packages/contract-verifier/src/{comparator,extractor,resolver}/` and merge to `main`. A wrong
   contract (LLM mis-extraction) is *not* a drift FP — it's a contract-generation issue; flag it
   `needs-design` and skip, don't "fix" the verifier to paper over it.
3. **Verification is pre-release**, against the local `dist/` build (`pnpm build:dist` →
   `dist/cli.mjs`, byte-equal to what publish.yml ships). Never `npx truecourse`.
4. **No contract review.** `drift-fp-discover` fires on the storage PR *opening* — the generated
   contracts are not human-reviewed. Human review is on the discovery PR and each fix PR.
5. **Borderline drifts** (esp. `*.no-code-counterpart`): not auto-fixed; `borderline:` comment +
   human label. **Refactors**: not auto-attempted; `## Refactor needed` + `needs-design`.
6. **Cost control**: only `drift-fp-generate` uses the LLM (once per campaign, bounded by the
   `.truecourseignore` doc-scope); discover/fix/close are LLM-free.
7. **Branch hygiene**: `claude/`-prefixed branches; auto-delete on merge. The storage branch is the
   exception — never merged, explicitly deleted by `drift-fp-campaign-close`.
8. **Concurrency**: `drift-fp-in-progress` lock before any work on an issue.
9. **Target order**: `campaigns.yaml` is the source of truth; `drift-fp-generate` picks the first
   `pending`, non-`skipped` campaign whose storage branch doesn't exist yet.

## Selecting targets

A repo is only worth a campaign if drift can actually surface — i.e. its **non-dot `.md` specs**
overlap **liftable code** (Prisma entities; TS/Zod/str-Enum enums; Express/FastAPI routes;
Knex/Prisma queries; named constants). Vet each candidate empirically:

1. Shallow-clone it and run `truecourse infer --dry-run` to see what the extractors actually lift.
2. Read its non-dot `.md` docs and check they describe the *same* enums/entities/constants/routes.
3. Score the overlap; only seed a campaign if it's real.

Of 24 repos scouted / 10 probed this way, only **`strapi/strapi`** (JS) and **`feast-dev/feast`**
(Python) cleared the bar as "strong" fits — both seeded in `campaigns.yaml`. Most repos fail it:
specs in a separate repo, `.mdx`/`.rst` docs (invisible to the tool), or non-Prisma ORMs the
extractors don't lift. Add new campaigns the same way.

## What's next

1. Walk the setup checklist; create the five routines on the Default environment.
2. **Run now** on `drift-fp-generate` to start the first campaign (strapi/strapi).
