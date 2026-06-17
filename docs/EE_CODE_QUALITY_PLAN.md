# EE Code Quality — Analyze as a Second Mode

## Goal

Bring the OSS **analyze** engine (architecture graph + violations) into the hosted
(EE) edition as a first-class second mode alongside the existing **Verification**
(spec → contracts → drift) mode. A connected repo — and every PR against it — can
now be looked at through two lenses: *"is the architecture sound?"* (Code Quality)
and *"does the code honor documented decisions?"* (Verification). Both lenses gate
PRs.

EE was deliberately drift-only until now (the analyze seam is installed as the OSS
default and never exercised). This plan reverses that decision with a **trimmed**
analyze surface — no sequence diagrams, no file explorer, no database viewer, no
node-level drill-down — reusing the existing components, not forking them.

## Constraints (locked)

- **No duplication — extend, don't fork.** Every behavior difference is a prop /
  flag / capability on an existing shared component. The only genuinely-new code is
  thin: a segmented-switch view, one capability, the `PgAnalysisStore` adapter, and
  the gate wiring for a second Check.
- **EE shell is unchanged.** The workspace left rail stays exactly as it is
  (Repositories · Pull requests · Knowledge · Settings · Admin). The mode switch
  lives *inside* a selected repo or PR, never in the rail.
- **Hosted analyze runs server-side.** No local Claude CLI per user; the EE server
  clones the repo and runs `analyzeInProcess` with the configured EE LLM provider,
  storing results in Postgres — same pattern as verify/spec/contracts.
- **Verification's PR behavior is untouched.** Its Check and its inline code-line
  review comments stay exactly as they are. Code Quality adds a second Check and
  contributes to one shared summary comment; it posts no inline comments.

## UX model — the two-mode switch

Two nav levels, only the inner one is new:

```
Workspace rail (unchanged):  Repositories · Pull requests · Knowledge · Settings · Admin
                                      │  open a repo or a PR
                                      ▼
   ┌─ repo / PR detail header ───────────────────────────┐
   │  [ ◉ Code Quality   ○ Verification ]                │  ← segmented switch
   └──────────────────────────────────────────────────────┘
```

- The switch is a **segmented control** in the repo/PR detail header — *not* the OSS
  `SectionSwitcher` dropdown. It reads/writes the **same** `dashboardSection` state
  and `useVisibleSections()` registry; section ids stay `analysis` (Code Quality)
  and `drift` (Verification). Only the rendering differs; switching logic is single-source.
- **Default mode: Verification.** (Configurable later; remember-last-choice is a nicety, not v1.)
- It produces a clean **2×2 — {repo, PR} × {Code Quality, Verification}**: a repo
  shows the baseline, a PR shows the delta.

## Code Quality v1 — graph + violations

Code Quality is two surfaces, **not cross-linked** (clicking a graph node to filter
violations is the deferred "interactive pass"):

1. **Architecture graph** — the existing `GraphCanvas`, made **navigate-only**:
   - **Keep:** depth levels (Services → Modules → Methods), pan / zoom / fit /
     minimap, collapse / expand groups (persisted), drag to reposition (persisted),
     the filter panel (search + exclude by type / framework / layer), and **hover
     highlight** (hover a node → highlight its connections, dim the rest).
   - **Drop:** **node selection** — clicking a node does nothing. This also drops
     *focus mode* (click-to-lock isolation) and *node → open file*, both of which
     rode on selection. Hover-highlight already gives the "what's connected" insight
     transiently, so nothing meaningful is lost and there's no file-open to repoint.
2. **Violations** — the analyze violations for the repo (baseline) or the PR (delta),
   as a list/table.

Trimmed away entirely in EE: **Flows** (sequence diagrams), **Files** (explorer +
code viewer), **Databases** (schema viewer) — all need the repo on local disk, which
hosted EE doesn't have.

## PR gate — two checks, one comment

- **Two independent GitHub Checks:** `TrueCourse / Code Quality` and
  `TrueCourse / Verification`, each pass/fail on its own.
- **One combined summary comment**, updated in place on each push:
  > **TrueCourse** — ✅ Code Quality · ❌ Verification (1 new drift)
  > [View Code Quality →] · [View Verification →]
- **Inline comments:** Verification keeps its inline review comments on new-drift
  lines (unchanged). Code Quality posts **none** — its findings live in the summary
  count + the deep-link to the PR's Code Quality view. (A drift is a point finding
  with a precise line; an architecture violation is systemic/relational and often
  has no honest single line — so inline fits one and floods the other.)
- **Code Quality gate threshold — configurable, with a default.** Mirror the drift
  gate's per-repo config (`blocking` on/off + `minSeverity`). **Default: block on new
  `high`+ violations, advisory below** (architecture analysis is noisier than drift,
  so "block on any" is too aggressive as a default). Tunable in repo settings.

## How it runs (hosted, server-side)

Analyze plugs into the two flows the gate already drives:

- **Baseline** (merge to the default branch): the existing baseline job additionally
  runs `analyzeInProcess` on the clone and stores a baseline analysis snapshot.
- **PR** (`handlePullRequestGate`): additionally runs analyze on the PR-head clone,
  diffs against the baseline snapshot → the Code Quality **delta** → the Code Quality
  Check + the comment's Code Quality line.

Storage: re-add a **`PgAnalysisStore`** behind core's analysis-store seam
(`setAnalysisStore`), content-addressed in Postgres exactly like `PgVerifyStore` /
`PgSpecStore`. (The EE analysis-store was removed when EE went drift-only; this
brings it back.)

## Implementation — extend, don't fork

| Piece | Reuse | New / changed |
|---|---|---|
| Graph | `GraphCanvas` (already takes optional `onNodeSelect`) | don't pass `onNodeSelect` + one flag to skip click-to-zoom |
| Tab trimming | `SECTIONS` registry + `requiredCapability` | tag Flows/Files/Databases with a `local-filesystem` capability that **OSS advertises and EE omits** (inverse gate) |
| Mode switch | `dashboardSection` state + `useVisibleSections` | a thin segmented-switch **view** (or a `variant` on the switcher) with EE labels "Code Quality"/"Verification" |
| Repo/PR detail | `RepoPage` (already `isEe`-aware) | remove the "force `section=drift`" lock so section plumbing flows |
| PR gate | `gate-handler.ts`, `postCheck`, the comment renderer | run analyze + post the 2nd Check; generalize the renderer to carry both signals — one handler, not two |
| Server analyze | `analyzeInProcess` (core) | re-add `PgAnalysisStore` + wire it into the baseline + gate flows |
| Gate config | gh_repos repo config | add Code Quality `blocking`/`minSeverity` alongside the drift ones |

## Phases

1. **Server-side analyze + storage** — ✅ **DONE.** `PgAnalysisStore` (jsonb-direct:
   `analyses` / `analysis_current` / `analysis_history`, drizzle migration
   `0001_code_quality_analyses`); wired via `setAnalysisStore` in `installEeStores`;
   `runBaseline` runs `analyzeInProcess` on the warm clone (`codeDir`=clone,
   `project.path`=repoKey) after drift, best-effort, using the EE transport. Verified
   the analyze engine runs hosted via the transport (no CLI dependency). Round-trip
   tests green. (Data exists; no UI yet.)
2. **EE Code Quality UX** — ✅ **DONE.** Inverse-gate capability `local-filesystem`
   (OSS advertises it via `COMMUNITY_CAPABILITIES` seeded into the ee-loader
   registry; EE overwrites → omits it) hides Flows/Files/Databases in EE. New
   `EeSectionSwitch` segmented control `[ Verification | Code Quality ]` (Verification
   first) in `EeRepoChrome`, left-anchored so the per-tab actions don't shove it;
   drives `dashboardSection` (`setSection` now always writes `?section`). RepoPage
   lock unlocked to allow `analysis` alongside `drift`, default Verification.
   `GraphCanvas` gained `readonly` (no node selection/zoom), passed `readonly={isEe}`.
   **Code Quality tabs = Analytics · Violations · Graph · Rules · Settings** —
   `HomePanel` gained a `mode` prop (`full`|`analytics`|`violations`) to split the
   OSS combined view; `cq-analytics`/`cq-violations`/`cq-rules` are EE-only registry
   tabs gated on `workspace`; `cq-rules` renders `RulesPanel`; `settings` is
   section-neutral (sourced from the drift section, shown in both lenses, hidden in
   PR mode). Data routes already read via the store seam (→ `PgAnalysisStore`).
   Build 17/17; client tests green. Data shows after a baseline analyze runs.
3. **PR gate** — ✅ **DONE.** Per-PR analyze runs `analyzeCore` (stateless, no
   persist → baseline untouched) on the gate's PR-head checkout; its full-mode
   lifecycle yields `pipelineResult.added` = new violations vs the baseline (the
   delta is free — no manual diff), `latestBaseline === null` → no baseline.
   `decideCodeQuality` (mirrors `decideGate`, default block on new `high`+) →
   a 2nd Check `TrueCourse / Code Quality` (best-effort). `renderGateComment`
   prepends a combined two-signal header (Code Quality + Verification status +
   `prSectionUrl` deep-links); Verification's inline comments unchanged, Code
   Quality posts none. Per-repo config `codeQualityBlocking`/`codeQualityMinSeverity`
   (gh_repos migration `0002`, store/routes/shared/RepoSettings toggle+dropdown,
   default block on `high`+). Build 17/17; gate tests green (+ `decideCodeQuality`).

## Out of scope / deferred

- **Interactive pass:** node selection → filter violations, node → GitHub deep-link,
  focus-mode lock. (v1 is navigate-only.)
- Sequence diagrams, file explorer, database viewer (no local disk in hosted EE).
- Remember-last-mode, per-user default mode.
- A cross-repo Code Quality rollup (the workspace "Pull requests" page stays
  verification-centric; Code Quality is per-repo/per-PR in v1).
