# Drop markdown materialization — use claims JSON directly

Status: shipped (2026-05-23).

## Why

The current pipeline does:

```
source docs → claims (JSON) → markdown (Sonnet) → contract slices (re-parse) → contracts (Opus)
```

The middle Sonnet step (`section-render`) does only a stylistic JSON → prose conversion. The contract extractor then re-parses that prose back into structured form. We pay LLM cost and risk timeouts (4-min cap, hit by `_shared/data` on Compliance) to round-trip data we already have.

It also doesn't scale: imagine pointing TrueCourse at a Confluence-sized knowledge base. We'd be LLM-rewriting thousands of sections on every Apply. Cloning is not the right pattern.

## New flow

```
source docs → claims (JSON, persisted to disk) → contracts (Opus, per-claim) → verify
```

`claims.json` (or sharded `claims/<module>/<topic>.json`) becomes the artifact downstream stages consume. It's written deterministically — no LLM call, no timeout class.

## Code changes

### Remove

| Path | Purpose today |
|---|---|
| `packages/spec-consolidator/src/section-runner.ts` | Sonnet per-section render |
| `packages/spec-consolidator/src/materializer.ts` (most of it) | Writes `.md` files + module manifests |
| `wrapSectionRunner`, `spawnSectionRunner` plumbing in `orchestrator.ts` | Section runner factory + cache wrapper |
| `models.sectionRender` field + `spec.sectionRender` stage in `llm-models.ts` | Sonnet model config |
| `.truecourse/.cache/consolidator/sections/` cache | Cached section markdown |
| `onSectionsReady` / `onSectionStreamed` / `onSectionDone` hooks | Section progress UI |
| `APPLY_STEPS.materialize` tracker step | Section render progress |
| `applyInProcess`, `truecourse spec apply` CLI command | Apply flow |
| `applyResult` / `apply` from `SpecContext` | Apply state |
| `SpecApplyResultToaster`, `SpecApplyFailures` components | Apply UI surfaces |
| `.last-applied.json` marker + `/spec/staleness` endpoint logic | Apply freshness signal |
| `canonical-spec-reader.ts`, `slicer.ts` in `contract-extractor` | Markdown slicing for IL extraction |

### Add

- **`packages/spec-consolidator/src/claims-store.ts`** — read/write `claims.json` (single file initially; can shard later if diff noise becomes a problem).
- **`packages/contract-extractor/src/claims-reader.ts`** — replaces `canonical-spec-reader.ts`. Loads `claims.json`, groups by `(module, topic)` or per-subject, yields work units to the existing Opus runner.

### Modify

- **`packages/spec-consolidator/src/orchestrator.ts`** — at end of `consolidate()`, always write `claims.json` (scan mode included). Remove the `materialize` branch entirely.
- **`packages/core/src/commands/spec-in-process.ts`** — drop `applyInProcess`, `APPLY_STEPS`. `scanInProcess` now also writes `claims.json`.
- **`packages/contract-extractor/src/index.ts`** (`generateContracts`) — drive from `claims-reader` output, not from markdown slices. Per-claim Opus calls unchanged.
- **`apps/dashboard/server/src/routes/spec.ts`** — drop `/spec/apply`, `/spec/staleness`. The `/spec/scan` endpoint already produces everything the client needs.
- **`apps/dashboard/client/src/components/spec/SpecContext.tsx`** — drop `apply`, `applyResult`, `applying`, `applyMarker`. Strip the Apply-related state.

## CLI changes

| Command | Change |
|---|---|
| `spec scan` | Now also writes `claims.json`. Same surface. |
| `spec apply` | **Removed.** |
| `spec conflicts list/show/pick/custom/revoke` | None |
| `spec chains list/add/remove` | None |
| `spec docs skipped/include/uninclude` | None |
| `spec status` | Drop "fresh / stale" line. Show open + decided + skipped counts. |
| `contracts generate` | Reads `claims.json` instead of `.truecourse/specs/modules/`. |
| `contracts list/validate` | None |
| `verify` | None |
| `config llm show` | Drops `spec.sectionRender` row. |

## Dashboard UI changes

### Removed
- **Apply button** + its toast + the failures panel.
- **`Apply failures` strip** at the top of the spec view.
- **"Rendering canonical spec — N/N"** progress step.
- **Mode switch** between "conflict view" and "canonical view" — both visible at once now.

### Modified
- **`SpecPanel`** sidebar grows a permanent "Canonical spec" section under "Open conflicts":
  ```
  ┌─ Open conflicts (N) ─────  ← click to resolve in right pane
  │  • auth scheme
  │  • compliance.signature_detections
  └─ Canonical spec ─────────  ← always visible
     └─ _shared
        ├─ data         [120 claims]
        ├─ overview     [3 claims]
     └─ infractions
        ├─ endpoints    [8 claims]
        ├─ data         [21 claims]
     └─ …
  ```
- **`SpecCanonicalPanel`** now renders the selected `(module, topic)` from claims JSON. Two view modes inside the panel:
  - **Markdown view** (default): deterministic client-side render per claim kind (endpoints → headings + lists; entities → field tables; etc.). Same shape today's `.md` had, no LLM.
  - **Structured view**: a table per claim with subject, content JSON, provenance link to source doc.
- **`Generate contracts` button** becomes the primary downstream action — single click after picks are resolved.
- **Progress popup** for scan: `discover → extract → merge → explain → resolve` (5 steps, no materialize).

### Kept
- Skipped docs panel
- Resolver suggestion badge (violet) on the recommended candidate
- HoverPopover-based tooltips
- All conflict-resolution affordances (Pick / Mark superseded / Write custom)

## Caches

- `blocks/` — keep, still hot path.
- `sections/` — delete (no longer used).
- `relevance.json`, `chain-detection.json`, `chain-recheck.json`, `conflict-explanations.json`, `conflict-resolutions.json` — keep.

## Tests

- Rewrite `tests/spec-consolidator/fixture-integration.test.ts` assertions that check `.md` output — assert on `claims.json` shape instead.
- Rewrite `tests/contract-extractor/*` that mock canonical spec reading — point at claims JSON fixture.
- Drop tests that assert on apply markers / staleness.
- Drop `tests/spec-consolidator/orchestrator.test.ts` materialize cases (apply mode tests).

## Migration

- On first scan after the upgrade, write `claims.json`. Existing `.truecourse/specs/modules/*.md` directory becomes vestigial.
- Provide one-time prune: `truecourse spec prune-legacy` or just document `rm -rf .truecourse/specs/modules/` in release notes.
- `decisions.json` schema unchanged — user picks survive.

## Out of scope

- Multi-source ingestion (Confluence / Notion connectors). This plan unblocks it but doesn't implement it.
- Live diff of canonical view when picks change. The render is fast enough that recomputing on every pick is fine.
- Versioning `claims.json` (e.g. semantic diff between Apply runs) — could come later if useful.

## Scope estimate

- Net code: **~−400 LOC** (delete section-runner + materializer + apply pipeline + apply UI) **+~200 LOC** (claims-store, claims-reader, structured canonical viewer). Net deletion.
- Tests: ~50 lines of fixture rewrites.
- Docs: README + STATUS in `PLAN.md`.
- Total: half-day to a day of focused work.

## Success criteria

After this lands:

1. No Sonnet calls in the pipeline. `truecourse config llm show` shows zero `spec.sectionRender` row.
2. `truecourse spec scan` writes `claims.json` and a fresh `claims.json` exists on every run.
3. `truecourse contracts generate` works with no `.md` files on disk.
4. Dashboard's spec tab shows conflicts AND canonical-spec browser at the same time.
5. The `_shared/data` timeout class is gone — no LLM call processes that volume.
6. Pointing TrueCourse at a 1000-doc repo doesn't make Apply / scan dramatically slower than today.
