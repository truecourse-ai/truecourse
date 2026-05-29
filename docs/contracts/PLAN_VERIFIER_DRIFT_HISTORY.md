# Plan — verifier drift history (LATEST.json equivalent for drifts)

Status: DONE (2026-05-28). Implemented in `packages/core/src/lib/verify-store.ts` +
`types/verify-snapshot.ts`; `verifyInProcess` persists runs/LATEST/history,
`verifyDiffInProcess` + `truecourse verify --diff` compute the baseline diff.

Resolved open questions:
1. **Promoted** out of `.cache/` → `<repo>/.truecourse/verifier/` (committable `LATEST.json`).
2. **Stable identity:** drift ids ARE regenerated per run, so diffs key on the
   obligation `Type:identity / obligationKey` (the IL-DRIFT marker key) — not a
   filePath/line hash, so it's stable under line moves.
3. **Retention:** keep all runs (matches analyze).
4. **diff.json** is a separate run mode (`verify --diff`), mirroring `analyze --diff`.
5. **Dashboard:** Verify panel gained a "Diff vs baseline" view; no runs picker yet.
`readVerifyState` reads the new LATEST with a one-release fallback to the legacy
`.cache/verifier/verify-state.json`.

---

Original plan (captured 2026-05-24) follows.

## The gap

Today the verifier writes a single file and overwrites it every run:

- `<repo>/.truecourse/.cache/verifier/verify-state.json`
- Constant: `VERIFY_STATE_REL` in `packages/core/src/commands/spec-in-process.ts:647`
- Shape: `{ verifiedAt, contractsDir, codeDir, artifactCount, extractedOperationCount, drifts, resolverErrors, unresolvedRefs }`
- Written by `writeVerifyState()` (`spec-in-process.ts:666`), called from `verifyInProcess()` after `verify()` returns.

Consequences:
- No history. Every run loses the previous result.
- No baseline. Can't ask "did this branch *introduce* new drifts vs main?"
- No cross-run queries. Can't trend drift counts over time, can't see when a specific drift first appeared or got fixed.
- The file lives under `.cache/`, so it's gitignored — even today's single snapshot doesn't travel via git.

The analysis pipeline already solved the equivalent problem. We should mirror its layout for drifts.

## The analogy — how analyses persist (today)

From `packages/core/src/lib/analysis-store.ts` and CLAUDE.md:

```
<repo>/.truecourse/
  analyses/<iso>_<short-uuid>.json   per-analysis snapshots (gitignored)
  LATEST.json                        materialized current-state view (committable)
  history.json                       append-only summaries (gitignored)
  diff.json                          optional current diff (gitignored)
```

Properties worth copying:
- **Atomic writes** via `atomicWriteJson` (write-tmp + rename).
- **mtime-keyed in-memory cache** on `LATEST.json` so the dashboard's many reads are cheap.
- **LATEST.json is committable** — `git worktree add` and fresh clones inherit a baseline. Convention is "only commit after merging to main."
- **history.json is summaries only** — full snapshots stay in `analyses/`; history is fast to scan.

## Target layout for drifts

Sketch — to be finalized when we pick this up:

```
<repo>/.truecourse/verifier/
  runs/<iso>_<short-uuid>.json       full per-run verify-state snapshot (gitignored)
  LATEST.json                        materialized current verify-state, diff baseline (committable)
  history.json                       per-run summaries: { runId, verifiedAt, artifactCount, driftCount, by-severity } (gitignored)
  diff.json                          optional current-vs-baseline drift diff (gitignored)
```

Open: keep these under `.cache/` (transient, like today) or promote to `<repo>/.truecourse/verifier/` (peer to `contracts/` and `specs/`). The analysis store sits at `.truecourse/` root, not under `.cache/`, because `LATEST.json` is committable — same logic applies here, so promotion seems right. The current `.cache/verifier/verify-state.json` becomes legacy; either migrate on first read or just delete.

## What "drift diff" should mean

Per-run snapshot keeps each drift's `id` (UUIDs already exist on `ContractDrift`). Diff vs `LATEST.json` baseline produces:
- **added**: drift ids present in current run but not baseline
- **resolved**: drift ids in baseline but not current
- **unchanged**: drift ids present in both

Caveat: UUIDs are likely regenerated per run (need to confirm — if so, switch to a content hash over `{artifactRef.identity, obligationKey, filePath, lineStart}` so diffs are stable across runs).

## Surfaces that need updating

- `verifyInProcess()` — write the per-run snapshot, update `LATEST.json`, append to `history.json`, optionally compute `diff.json`.
- `readVerifyState()` — point at the new `LATEST.json` location; keep a fallback that reads the legacy path during one release.
- Dashboard `apps/dashboard/server/src/routes/verify.ts` + `apps/dashboard/client/src/hooks/useVerifyState.ts` — same path change; expose history endpoint if we want a runs list.
- `apps/dashboard/server/src/routes/spec.ts` — same path change.
- CLI: nothing if `verifyInProcess` handles it internally; otherwise a `truecourse drifts list` / `drifts diff` subcommand.

## Open questions to answer before building

1. Promote out of `.cache/` (committable `LATEST.json`) or keep transient? Analysis pattern says promote.
2. Drift identity for stable diffs — content hash vs `id`. Confirm whether `ContractDrift.id` is regenerated per run.
3. History retention — keep all `runs/*.json` forever, or rotate (last N, or last N days)?
4. Should `diff.json` be a separate run mode (`truecourse verify --diff`) or always computed?
5. Does the dashboard need a runs picker (à la analyses dropdown) or is "latest + diff vs baseline" enough?

## Out of scope for this plan

- Cross-repo / org-level drift trends.
- Drift triage / ack workflow (snoozing, ignoring known drifts) — separate plan if/when needed.
