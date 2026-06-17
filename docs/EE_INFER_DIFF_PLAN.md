# EE Infer — Baseline + PR Diff Plan

**Status:** **BUILT** — core diff (baseline-infer on the default-branch scan + PR
`(kind, identity)` diff → added/resolved comment + `inferResult` notification on
`added > 0`) **and** the auto-run setting (per-repo `autoInfer` toggle → infers on
each PR event via `runInferReport`). 153 github-app tests green.

**Follow-on:** the infer rework (`EE_INFER_PROMOTE_PLAN.md`) adds an Inferred tab +
spec-generating promote (OSS + EE). Infer **stays in OSS** (the EE-only/IP move was
considered then reverted). Whether the `autoInfer` toggle stays or is dropped for a
fixed always-on default is still open.

## Problem

The infer checkbox runs a full whole-repo inference at the PR head (`runInfer` →
`inferInProcess`) and dumps **every** undocumented decision (31 on the gate-test
repo), almost none related to the PR's actual change. The other two gate signals
are baseline + diff:

- **Verify (drift):** baseline drifts (default branch) vs head → added/resolved.
- **Code Quality:** `LATEST` (default branch) vs head → new/resolved.

Infer is the outlier — a discovery dump bolted into the PR. Goal: make it a **PR
delta** showing only what the PR newly leaves undocumented (and what it resolved),
consistent with the other two signals.

## Design

Mirror the verify gate: a **baseline inferred set on the default branch** (computed
on connect, refreshed on merge) + a **PR-time diff** of head-inferred vs
baseline-inferred, keyed by decision identity.

- **Baseline (default-branch scan).** `runBaseline` already clones the default
  branch and runs spec/contracts/verify/analyze on `tmp` keyed by `ref`. Add a
  best-effort infer step (same shape as the existing `analyze` block, same
  commit-skip): `inferInProcess(tmp, { ref })` → persists `contracts_inferred` at
  the default-branch commit + its `DecisionSummary[]`. "Infer on connect" falls
  out for free — connecting a repo runs `runBaseline`.
- **PR (head).** `runInfer` already infers head → `contracts_inferred` at head.
  Unchanged.
- **Diff.** At PR time read the baseline commit (`store.getBaseline().commitSha`)
  and its baseline decisions, then diff against the head decisions by
  `(kind, identity)`:
  - `added` = head decisions whose `(kind, identity)` ∉ baseline.
  - `resolved` = baseline `(kind, identity)` ∉ head.
  Identity is deterministic (`data-store.postgres`, `Entity Customer`,
  `Enum CustomerTier`) — the same identity-keyed diff the drift gate uses. We diff
  on identity, **not** the LLM `reason`.

## Key decision — where the baseline decisions live

The diff needs the baseline `DecisionSummary[]` available at PR time. Options:

- **(A, recommended)** Persist the baseline infer's `DecisionSummary[]` as a small
  JSON keyed by `(repoKey, commit)` — simplest home is alongside the
  `contracts_inferred` set (a sibling manifest / content row). Unambiguous; carries
  `kind/identity/path/line/reason` so **resolved** items render with full context.
- **(B)** Re-list the baseline `contracts_inferred` set's identities and diff those.
  No new storage, but recovering `(kind, identity)` from contract file paths is
  lossy and gives thin `resolved` rows.

Go with **(A)**.

## Touchpoints

- `ee/packages/github-app/src/baseline.ts` `runBaseline` — add the infer step after
  clone (best-effort + commit-skip), persist baseline `DecisionSummary[]`.
- `ee/packages/github-app/src/infer-scan.ts` `runInfer` — after inferring head, load
  the baseline decisions and return `{ added, resolved }` instead of the full set.
- `ee/packages/github-app/src/infer-offer.ts` `handleCommentEditedInfer` — branch on
  added/resolved counts (`done` when either > 0; `nochange` when both 0).
- `ee/packages/github-app/src/infer-comment.ts` — extend `InferCommentData` with
  `added`/`resolved`; `renderInferComment('done', …)` lists added decisions and
  summarizes the resolved count.
- Baseline store: a place for the `DecisionSummary[]` artifact (per option A).

## Edge cases

- **No baseline-inferred set yet** (repo connected before this ships, or the first
  scan failed) → fall back to today's full-set behavior and say so in the comment,
  so it degrades gracefully rather than showing an empty diff.
- **PR head == default-branch commit** → empty diff.
- **Merge** → the next default-branch scan re-infers; merged decisions drop out of
  future PRs' `added` automatically.

## Cost

Per-PR cost unchanged (one head infer). **+1 infer per default-branch advance**
(cached, commit-skipped — not per PR). Large noise reduction in the PR comment.

## Auto-run + result notification (follow-on)

Run infer automatically on the `pull_request` event (like verify/code-quality)
instead of waiting for the checkbox, gated by a per-workspace/repo setting that
defaults **off** — same pattern as the `codeAnalysisLlm` toggle (workspace setting
→ passed through the gate handler). Keep the checkbox as the manual trigger when
the setting is off. Requires the diff first — auto-running the full dump would be
noisy and expensive.

The result is never silent: it updates the PR comment **and** fires the existing
per-repo `inferResult` notification — RepoSettings **"Undocumented decisions" /
"Inference captured new decisions on a PR."** → `sendInferResult`. With the diff,
its trigger flips from `decisions.length > 0` to **`added.length > 0`**, which is
exactly "captured *new* decisions on a PR" (no notification when the PR introduced
nothing new). Currently email + the per-repo toggle; could also post to the in-app
notifications feed.

## Out of scope

- Inferring only the PR's changed files (rejected — misses cross-file evidence and
  never detects resolved decisions).
- Auto-promoting inferred decisions into the spec.
- A dashboard PR-delta view for infer (the Contracts tab already shows the full
  inferred set at head; a delta view can follow later).
