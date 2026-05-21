# Conflict & Version-Chain Resolution — Improvements

Status: planned, not started. To be done **before** the LLM-model-config
work (`PLAN_LLM_MODEL_CONFIG.md`).

## Why

Scanning Compliance (a real ~35-doc project) produced **46 open
conflicts**. Pattern breakdown:

- 25 with byte-identical content across all candidates (trivially auto-resolvable)
- 10 with all candidates from the same source file (intra-doc redundancy — shouldn't be a conflict)
- 32 mixing PRD with non-PRD docs (docKind weighting should mostly resolve these)
- 32 with differing `status` (deferred / out-of-scope claims shouldn't compete with shipped)

The v1 → v2 PRD relationship (`PRD_DATA_COMPLIANCE_V1.md` →
`backend_PRDv2.md`) wasn't detected by either chain detector — different
filename prefixes broke the deterministic detector, and the LLM detector
only sees the first 30 lines per doc, which isn't enough context to
link them.

The user is being asked to do work the engine should be doing.

## Goals

1. Cut the conflict list from ~46 to ~10–15 by auto-resolving trivially-decidable cases.
2. Catch the v1/v2 PRD case automatically when filenames don't reveal the chain.
3. Give the user a fast escape hatch when the engine still misses a chain.
4. Make the remaining real conflicts decidable in seconds instead of minutes.

## Workstreams

### 1. Auto-resolve rules in the merger

New rules applied before a conflict is surfaced to the user. Each rule
collapses or filters candidates; the conflict only opens if multiple
candidates survive.

| Rule | Effect | Estimated closures |
|---|---|---|
| **Identical content** — when all candidates' `content` is normalized-identical, pick any. Decision written as `{kind: 'pick', candidateIndex: 0, reason: 'identical'}`. | Auto-pick | ~25 |
| **Status auto-loses** — `status=deferred`, `status=out-of-scope`, `status=deprecated` candidates lose to any `status=shipped` candidate. | Filter | ~5 |
| **DocKind weighting (enforced as auto-pick when content disagrees)** — PRD beats README beats unknown beats task/notes. Already partial in the weighting; promote to a hard auto-resolve when the highest-docKind candidate has unique winning content. | Auto-pick | ~10 |
| **Subset/superset** — when candidate A's `content.fields` ⊂ candidate B's `content.fields` and no field disagrees, B wins (more specific). | Auto-pick | ~5 |
| **Same-file consolidation** — when all candidates come from one file, merge their `content` (union fields, latest constraints win) into a single claim and surface no conflict. | Consolidate | ~10 |

Implementation: extend `packages/spec-consolidator/src/merger.ts` with a
pre-conflict filter pass. Each rule logs its decision into the existing
`decisions.json` with a `reason` field the dashboard can show.

Estimated remaining real conflicts: ~10–15.

### 2. Conflict-triggered chain re-check

When the merger finds a conflict on a high-level cross-cutting subject
(`auth.scheme`, `errors.envelope`, `endpoints.pagination`, etc.) between
two PRD-kind docs, trigger a **focused LLM re-prompt**: pass both docs'
**full content** (not just preview) plus the conflict subject, ask "are
these versions of each other?"

If the LLM says yes, write a chain into `decisions.json` and re-run the
merge with the older doc's claims filtered. The cascading 8+ conflicts
caused by v1 vs v2 collapse to one chain decision.

Implementation: new `packages/spec-consolidator/src/chain-recheck.ts`,
called from the merger when it detects a "fundamental" conflict between
two PRDs. Reuses the existing chain-detection cache so a confirmed chain
sticks across re-runs.

### 3. Manual "Mark as superseded" action

Dashboard UI action on each conflict candidate: button labeled "Mark as
superseded by →" that opens a picker of the other candidates' source
files. Selecting one writes a manual chain into `decisions.json` and
re-merges. The cascading conflicts caused by the same v1/v2 split all
clear in one action.

Implementation:
- Dashboard: new action in `SpecConflictDetail.tsx`, calls a new
  server endpoint `POST /api/spec/chain/manual`.
- Server: writes the chain to `decisions.json`, re-runs the merge.
- Core: extend `decisions.json` schema with `manualChains: VersionChain[]`.
- Materializer: read `manualChains` after auto-detected chains; union
  them before the claim-filter step.

### 4. Conflict-detail UI improvements

Beyond what the dashboard already shows (file:line, docKind,
lastTouched, recommended badge, doc preview, structured content), add:

- **Side-by-side diff view** for two candidates. Highlight which fields
  differ. When all candidates are identical, show a single banner ("all
  identical — any pick is equivalent") instead of N copies of the same
  JSON.
- **Status badge** next to each candidate (shipped / deferred /
  out-of-scope).
- **Claim kind badge** next to each candidate (definition / constraint).
- **Why this is the recommendation** — one-line explanation: "newer +
  PRD docKind + status:shipped" so the user understands the engine's
  reasoning.
- **Downstream impact estimate** — when resolving a cross-cutting
  conflict (auth.scheme), surface "this affects N operation contracts"
  so the user knows the blast radius.

Implementation: extend `SpecConflictDetail.tsx`; the diff view is the
biggest piece (~80 LOC for a structured JSON diff component).

## Migration plan

1. **Auto-resolve rules in the merger** — implement and add unit tests
   against the Compliance scan-state.json (which is checked-in as a
   regression fixture). Confirm the conflict count drops from 46 →
   ~10–15 on Compliance.
2. **Manual "Mark as superseded"** — UI + server endpoint + decisions
   schema. Lowest-risk way to give users the escape hatch immediately.
3. **Conflict-triggered chain re-check** — LLM call wired in. Test
   against Compliance's PRDv1/PRDv2 case to confirm auto-detection.
4. **UI improvements** — diff view, status badges, recommendation
   reason, blast-radius estimate.

Order matters: rules first (cuts the volume), then escape hatch (gives
the user a tool), then auto-detection (closes the gap), then polish.

## Out of scope

- Bulk-resolve UI ("accept defaults for all remaining conflicts" —
  already exists as `truecourse spec resolve --all-defaults`).
- A "watch for new conflicts" mode that re-scans on doc changes —
  the existing `scan` is fast enough on incremental cache hits.
- Three-step+ chains (`v1 → v2 → v3`). Today's pairwise model already
  handles them as multiple pairs; collapsing into one decision is a
  future enhancement.

## Estimated effort

- Workstream 1 (auto-resolve rules): ~150 LOC + tests, ~half a day
- Workstream 2 (chain re-check): ~80 LOC + LLM prompt + cache wiring, ~half a day
- Workstream 3 (manual supersede): ~120 LOC across UI + server + core, ~half a day
- Workstream 4 (UI polish + diff view): ~200 LOC, ~1 day

Total: ~2.5 days for a substantial UX uplift on a real-project pain
point. Conflicts drop from 46 → ~10–15 + each remaining conflict
becomes a 10-second decision.

## Validation

Compliance scan is the regression fixture. After all four workstreams:

- Conflict count: 46 → ≤ 15
- v1 PRD claims filtered automatically by chain detection
- Each remaining conflict has a clear default with one-line reason and
  a diff view
- Manual supersede works on at least one of the remaining real
  conflicts
