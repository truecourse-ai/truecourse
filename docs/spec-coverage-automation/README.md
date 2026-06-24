# Spec-Coverage Automation — Design

A loop that takes **groups of spec docs**, generates `.tc` contracts from them, measures how
much of each group our contract **kinds** can capture **structurally** (code-derivable; not
`unenforceable-obligation` prose), and **discovers + adds the missing kinds** — one human-gated
kind at a time — until a group's code-derivable coverage clears the bar with **zero
`unenforceable-obligation`**.

It is the **kind-discovery sibling** of [`docs/drift-fp-automation`](../drift-fp-automation/README.md)
(which hunts verifier false-positives) and [`docs/fp-automation`](../fp-automation/README.md)
(deterministic-rule FPs). Same skeleton — state in GitHub, the same `.tc` engine — different goal.

## Topology — spec processing is LOCAL; only kind-building is on the public repo (CURRENT)

This loop runs **split across two places** (the rest of this doc was written for an all-cloud design
— where that conflicts with the split below, **this section wins**):

- **LOCAL (your machine) — spec processing.** `generate`, `measure`, and `remeasure` run **locally**
  via the Claude Code skills `/spec-coverage-generate`, `/spec-coverage-measure`,
  `/spec-coverage-remeasure` (authoritative procedures: `prompts/{generate,measure,remeasure}.md`,
  now written as **local** procedures). Your spec docs and the generated `.tc` contracts **never
  leave your machine** — the LLM work is done by the Claude session you invoke the skill in
  (`--llm-transport agent`; no `claude -p` spawn, no API key). There is **no storage branch, no
  storage/measure/close PR, no `groups.yaml`** in the local flow. Outputs live in
  `<spec-path>/.truecourse/`.
- **PUBLIC repo (`truecourse-ai/truecourse`) — kind-building only.** Exactly **two routines**:
  `spec-kind-propose` and `spec-kind-implement`. They consume the **sanitized `new-kind` issues** you
  file by hand (from local `measure`/`remeasure` output) and build the kind into the engine.
- **The seam.** Local `measure` finds a code-derivable gap → emits a **sanitized** `new-kind` request
  (paraphrased; no private spec text, doc paths, or revealing group names) → **you** file it on
  public → `propose` → (you merge intent) → `implement` → (you merge) → the kind is in the engine.
  Then locally you `git pull` + rebuild and run `/spec-coverage-remeasure` to re-score. That
  public→local hop is **manual** (a public merge can't trigger a local run) — by design.

So: **the only thing that crosses from private to public is an abstract, sanitized contract-kind
request.** Private specs stay local. The "storage branch / measure PR / close PR / `groups.yaml`"
machinery described below applies only to the original all-cloud design and is **not** used in this
split.

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

> **Historical (all-cloud design).** The diagram below shows the original design where all five
> phases were cloud routines wired by GitHub events. In the **current split** (see
> [Topology](#topology--spec-processing-is-local-only-kind-building-is-on-the-public-repo-current)),
> only `spec-kind-propose` and `spec-kind-implement` are routines; `generate`/`measure`/`remeasure`
> run locally via skills, with no storage branch / storage PR / measure PR / close PR. Read the
> diagram for the *conceptual* flow; read Topology for what actually runs where.

Each box is a phase; arrows are the conceptual hand-offs. Only `generate`, `measure`, and
`remeasure` use the LLM (`--llm-transport agent`); `propose` is mechanical; `implement` is an engine
build + tests.

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

## Triggers (current split)

**Local — no triggers; you invoke a slash command:**

| Phase | Run it with | Prompt |
|---|---|---|
| generate | `/spec-coverage-generate` | `prompts/generate.md` |
| measure | `/spec-coverage-measure` | `prompts/measure.md` |
| remeasure | `/spec-coverage-remeasure` | `prompts/remeasure.md` |

**Public repo — two routines:**

| Event | Branch / source | Trigger filter | Fires |
|---|---|---|---|
| **issue opened** | — | label `new-kind` | `spec-kind-propose` |
| PR **merged** | `claude/spec-kind-propose/` | merged + head-branch prefix (no label filter) | `spec-kind-implement` |

(Branch prefix is the unique trigger; a label filter on the merge trigger is redundant — same
convention as the fp/drift-fp loops. The `new-kind` issue trigger needs the label since issues have
no branch.)

**Public-routine prompt convention:** the routine config holds a one-line bootstrap pointer; the
authoritative instructions live under `prompts/<routine>.md`:

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

**Public repo — create two routines** at claude.ai/code/routines (Default environment; first step
is `pnpm install && pnpm build:dist`; no keys):
- `spec-kind-propose` → `propose.md`; trigger **issue opened**, label `new-kind`.
- `spec-kind-implement` → `implement.md`; trigger PR **merged**, head-branch prefix
  `claude/spec-kind-propose/` (no label filter needed).

Install the Claude GitHub App on `truecourse-ai/truecourse` and enable auto-delete head branches.

**Local — use the skills** (no routines, nothing committed). On a local truecourse checkout:
1. `pnpm install && pnpm build:dist` (builds `dist/cli.mjs`, which the skills invoke).
2. Put your specs in a folder **outside** the repo (any `.md` folder; a whole repo is fine — the
   scan's relevance filter curates).
3. `/spec-coverage-generate` → give it the spec path + a group label.
4. `/spec-coverage-measure` → same path/label; it prints sanitized `new-kind` requests for any gap.
5. File a request as a `[new-kind]` issue on the public repo → the two routines build the kind.
6. After it merges: `git pull` + rebuild, then `/spec-coverage-remeasure` to re-score.

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
6. **The loop was first validated by hand on a worked example** — a feature spec run across three
   rounds, which is what produced the initial `validation-rule` / `fallback` / `field-exposure` /
   `architecture-decision`(persistence-strategy) kinds (structural coverage ~28% → ~81% of the
   code-derivable subset, 0 `unenforceable-obligation`). This automation generalizes that loop.
