# Spec-Coverage Automation — Design

A loop that takes **groups of spec docs**, generates `.tc` contracts from them, measures how
much of each group our contract **kinds** can capture **structurally** (code-derivable; not
`unenforceable-obligation` prose), and **discovers + adds the missing kinds** — one human-gated
kind at a time — until a group's code-derivable coverage clears the bar with **zero
`unenforceable-obligation`**.

It is the **kind-discovery sibling** of [`docs/drift-fp-automation`](../drift-fp-automation/README.md)
(which hunts verifier false-positives) and [`docs/fp-automation`](../fp-automation/README.md)
(deterministic-rule FPs). Same skeleton — stateless cloud **[Claude Code Routines](https://code.claude.com/docs/en/routines)**,
state in GitHub, contracts frozen on per-group storage branches — different goal.

## What this loop optimizes

The round-trip is: **spec docs → `contracts generate` → blind-reverse the spec from the contracts
only → compare to the originals.** A requirement "counts" as covered **only if a structural,
code-derivable kind captured it** — prose dumped into `unenforceable-obligation` does **not** count
and is driven toward **zero** (it inflates a round-trip but the engine can't derive or enforce it
from code). The loop's output is an **evolving catalog of general, code-derivable contract kinds**.

| | drift-fp loop | **spec-coverage loop** |
|---|---|---|
| target unit | an OSS repo (campaign) | **a group = an uploaded folder of `.md` specs** |
| target run | deterministic `verify` | `contracts generate` (LLM) → **blind reverse + coverage judge** (LLM) |
| FP source | a comparator/extractor | **a missing/insufficient contract KIND** |
| "fix" | edit a comparator (small) | **add a new KIND end-to-end** (grammar+lifter+extractor+fixtures) — big, general, **human-gated** |
| issue unit | one `(drift-kind, repo)` | one **proposed kind** (a code-derivable requirement class with no kind yet) |
| convergence | `fp == 0` | **coverage(code-derivable subset) ≥ `target_pct` AND obligations == 0** |
| contract storage | per-campaign storage branch (never merged) | same — `claude/spec-cov-store/<group>` |
| what merges to `main` | engine fixes | **new kinds** (grammar/lifter/extractor/fixtures) |

**Why "code-derivable subset," not "all requirements"?** Roughly a third of a typical feature/PRD
doc is pure narrative (problem statement, user stories, UI copy, file paths, future-work) with no
code signal. Forcing it into contracts is exactly the `unenforceable-obligation` cheat this loop
removes, so 95% of *all* requirements is unreachable by design. The gate is against the
**code-derivable subset** (the requirements an extractor could plausibly lift from code). The
measure step classifies every requirement `structural | obligation-only | narrative | missed` and
the denominator excludes `narrative`.

## Groups

A **group** is one folder of `.md` specs that belong together (one feature / module / PRD set).
You add a group by committing it under `docs/spec-coverage/groups/<group-name>/` (the "upload" is a
git push, optionally via the GitHub API). `groups.yaml` is the ordered roster + status + coverage
results; `spec-coverage-generate` picks the first group with **no storage branch yet** (branch
existence, not a yaml flag, is the "already started" signal — same idiom as drift-fp).

The group's **specs + generated contracts are scaffolding**: they live on a per-group storage
branch `claude/spec-cov-store/<group>` (a storage PR that is **never merged**, deleted at group
close). They **never land on `main`**. Only **kinds** (engine code + fixtures) merge to `main`.

## The kind lifecycle (the human-gated core)

Each candidate kind is tracked in [`kinds.yaml`](kinds.yaml) and flows through **two PR gates**:

```
new-kind issue ──► [spec-kind-propose] ──► INTENT PR ──(you merge)──► [spec-kind-implement] ──► IMPLEMENTATION PR ──(you merge)──► [spec-coverage-remeasure]
   (filed by                              "will build X"               builds the kind             grammar+lifter+                 regenerate group,
    measure)                              kinds.yaml: planned          end-to-end                  extractor+fixtures              recount; close or
                                                                                                   kinds.yaml: built               file more issues
```

- The **intent PR** is the *plan* gate: it states what kind, what requirement class it covers, the
  proposed `.tc` shape, the deterministic **code signal** (how an extractor derives it from code),
  and the fixture plan — but contains **no engine code**. Merging it = "yes, build this." This is
  deliberate: a kind is a large, general engine change, so you approve the design before the build.
- The **implementation PR** is the *code* gate: the full kind (types + ohm grammar + lifter +
  cross-language code extractor + sample-IL fixtures), full `pnpm test` green, snapshot
  re-baselined. Merging it = "accept this kind," which fires the re-measure.

`kinds.yaml` status: `proposed` (issue filed) → `planned` (intent PR open) → `approved` (intent PR
merged) → `building` (implement routine running) → `built` (implementation PR open) → `done`
(implementation PR merged). A kind is `rejected` if you close its intent PR instead of merging.

**Generality gate (enforced in the prompts):** a kind is only built if it's *general*
(cross-feature/ORM/framework — no domain vocabulary in grammar/types) **and** has a deterministic
code extractor proven on a fixture. A requirement with no code signal is **narrative** → it stays
uncaptured (never an `unenforceable-obligation`, never a kind). The propose step rejects kind ideas
that fail either test and notes them on the measure PR.

## Architecture

Each box is a routine; arrows are GitHub events (head-branch prefix + label filters). Only
`generate`, `measure`, and `remeasure` use the LLM (`--llm-transport agent`); `propose` is
mechanical; `implement` is an engine build + tests.

```
  [push group folder / Run now]
            │
            ▼
┌─────────────────────────────────────────┐
│ spec-coverage-generate  (LLM)            │
│ pick next group w/ no store branch;      │
│ spec scan→resolve→contracts generate via │
│ --llm-transport agent; commit specs+     │
│ contracts to claude/spec-cov-store/<g>   │
│ → STORAGE PR (label spec-cov-store,      │
│   NEVER merged)                          │
└──────────────┬──────────────────────────┘
               │ storage PR OPENED
               ▼
┌─────────────────────────────────────────┐
│ spec-coverage-measure  (LLM)             │
│ blind-reverse spec from contracts only;  │
│ score coverage (structural/obligation/   │
│ narrative/missed); FILE one new-kind     │
│ issue per code-derivable gap.            │
│ → MEASURE PR (to main): groups.yaml      │
│   baseline coverage + the recreated spec │
└──────────────┬──────────────────────────┘
               │ new-kind ISSUE opened (label new-kind)
               ▼
┌─────────────────────────────────────────┐         ┌───────────────────────────────────────┐
│ spec-kind-propose                        │         │ spec-kind-implement                     │
│ open INTENT PR: plan + .tc shape + code  │ merge   │ build kind end-to-end (types+grammar+   │
│ signal + fixture plan; kinds.yaml planned │────────►│ lifter+ohm semantics+extractor+IL       │
│ → branch claude/spec-kind-propose/<kind> │ intent  │ fixtures); pnpm test green; re-baseline │
│   label spec-kind-propose                │ PR      │ → IMPLEMENTATION PR (to main)           │
└─────────────────────────────────────────┘         │   label spec-kind-implement; Closes #N  │
                                                     └──────────────┬────────────────────────┘
                                                                    │ merge implementation PR
                                                                    ▼
                                                     ┌───────────────────────────────────────┐
                                                     │ spec-coverage-remeasure  (LLM)          │
                                                     │ regenerate affected group(s) with the   │
                                                     │ new kind; recount. coverage≥target &    │
                                                     │ oblig==0 → CLOSE PR (groups.yaml done,  │
                                                     │ delete store branch). else file more    │
                                                     │ new-kind issues.                        │
                                                     └─────────────────────────────────────────┘
```

## Triggers

| PR/issue event | Branch / source | Label | Fires |
|---|---|---|---|
| **push** (or Run now) | adds `docs/spec-coverage/groups/<g>/` | — | `spec-coverage-generate` |
| PR **opened** | `claude/spec-cov-store/` | `spec-cov-store` | `spec-coverage-measure` |
| **issue opened** | — | `new-kind` | `spec-kind-propose` |
| PR **merged** | `claude/spec-kind-propose/` | `spec-kind-propose` | `spec-kind-implement` |
| PR **merged** | `claude/spec-kind-implement/` | `spec-kind-implement` | `spec-coverage-remeasure` |

The first group is bootstrapped with **Run now** on `spec-coverage-generate`. Push-based group
ingestion uses a `push`/`pull_request` trigger filtered to paths under `docs/spec-coverage/groups/`.

**Prompt convention** (same as drift-fp): the routine config holds a one-line bootstrap pointer;
the authoritative instructions live under `docs/spec-coverage-automation/prompts/<routine>.md`,
edited via PR.

> Execute the instructions in `docs/spec-coverage-automation/prompts/<routine>.md` from the cloned
> `truecourse-ai/truecourse` repository. Treat that file as the authoritative prompt; follow every
> step exactly. If the file is missing or unreadable, post a short failure note and end.

## State

- **`groups.yaml`** (on `main`) — group roster + status (`pending`/`measuring`/`done`/`skipped`) +
  `baseline`/`final` coverage `{ measured_at, target_ref, total_reqs, structural, obligation_only, narrative, missed, code_derivable_pct, obligations }`.
- **`kinds.yaml`** (on `main`) — every candidate kind + lifecycle status + the group(s) that
  motivated it + the code signal.
- **`new-kind` issues** — one per proposed kind (the build queue). YAML body: `kind`, `motivating_group`,
  `requirement_class`, `proposed_tc_shape`, `code_signal`, `fixture_plan`, `status`.
- **Storage branch** `claude/spec-cov-store/<group>` — `groups/<group>/{specs,contracts,reconstructed.md,meta.yaml}`; never merged; deleted at group close.

Labels: `new-kind` (gates propose), `spec-kind-target:<kind>` (groups issue+PRs), `spec-kind-in-progress` (lock),
`spec-kind-rejected` / `needs-design` (bail-outs). The Claude session is the only writer.

## Convergence & the close gate

A group **closes** when `spec-coverage-remeasure` measures, against the freshly-built engine on the
regenerated contracts: **`code_derivable_pct ≥ target_pct`** (default 90) **AND `obligations == 0`**
**AND** every still-missed requirement is `narrative` (no remaining code-derivable gap). It then
opens a close PR (to `main`) flipping `groups.yaml` `status: done` + `final.*`, and deletes the
storage branch. If a code-derivable gap remains, it files more `new-kind` issues and the group
stays `measuring`.

## Acceptance criteria

**Intent PR** (`spec-kind-propose`): touches only `kinds.yaml` (+ the PR body); states kind name,
requirement class, proposed `.tc` shape, deterministic code signal, fixture plan, and the
motivating issue (`Refs #N`). No engine code. Branch `claude/spec-kind-propose/<kind>`, label
`spec-kind-propose`.

**Implementation PR** (`spec-kind-implement`): the kind end-to-end — `ArtifactKind` + `*Contract`
type, ohm grammar rule + lifter (+ ohm semantics if needed), a **cross-language (JS+Python)
deterministic code extractor**, sample-IL fixtures (code + `.tc`) in both projects, new tests, and
a **re-baselined snapshot** (existing fixtures still byte-identical; new artifacts added). Full
`pnpm test` green. `Closes #N`. Branch `claude/spec-kind-implement/<kind>`, label `spec-kind-implement`.

## Setup checklist

1. Install the Claude GitHub App on `truecourse-ai/truecourse`; enable auto-delete head branches.
2. Add a first group folder under `docs/spec-coverage/groups/<g>/` and an entry in `groups.yaml`.
3. Create the routines at claude.ai/code/routines, each with the bootstrap pointer on the Default
   environment (first step is `pnpm install && pnpm build:dist`; no keys — LLM stages use
   `--llm-transport agent`):
   - `spec-coverage-generate` → `generate.md`; trigger **push** on `docs/spec-coverage/groups/**` (+ Run now to bootstrap).
   - `spec-coverage-measure` → `measure.md`; trigger PR **opened** `claude/spec-cov-store/` + `spec-cov-store`.
   - `spec-kind-propose` → `propose.md`; trigger **issue opened** label `new-kind`.
   - `spec-kind-implement` → `implement.md`; trigger PR **merged** `claude/spec-kind-propose/` + `spec-kind-propose`.
   - `spec-coverage-remeasure` → `remeasure.md`; trigger PR **merged** `claude/spec-kind-implement/` + `spec-kind-implement`.
4. **Run now** on `spec-coverage-generate` to start the first group.

## Resolved decisions

1. **Coverage counts only code-derivable structural capture; `unenforceable-obligation` → 0.** Prose
   with no code signal is `narrative` and stays uncaptured (never an obligation, never a kind).
2. **Kinds are human-gated by two PR merges** (intent, then implementation) — a kind is a big,
   general engine change; the plan is approved before the build.
3. **Generality + code-derivability are hard requirements** for any kind (cross-domain grammar; a
   deterministic extractor proven on a fixture). Enforced in `propose` and `implement`.
4. **Contracts are scaffolding** (storage branch, never merged, deleted at close); **kinds merge to `main`**.
5. **Only generate/measure/remeasure use the LLM** (agent transport); propose/implement are
   mechanical/build.
6. **The seed corpus is `docs/benchmark/`** — the worked round-trip example (3 docs → the
   `validation-rule` / `fallback` / `field-exposure` / `architecture-decision` persistence kinds);
   see `docs/benchmark/rounds/` for the version history this loop generalizes.
