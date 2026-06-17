# Infer — Inferred Tab + Promotion Plan

**STATUS: COMPLETE** — list + Dismiss + Promote in **both OSS and EE**, identical
behavior via a shared core seam, differing only in file-vs-Postgres transport (see
**Part E — Shared-seam refactor**). Promotions/dismissals persist and survive
re-infer / re-baseline in both editions. No remaining OSS gap. Infer stays in OSS.

## Decisions (locked)

1. **Infer stays in OSS** (reverted the earlier IP/EE-only call). The engine is NOT
   moved; the CLI `infer` command and the dashboard inferred display stay. No
   Part A. ~~Infer is hosted-only…~~
2. **Promote = generate the spec** (document) then regenerate the contract, so we
   never create an enforced rule with no written spec. (Quick "enforce only" is
   dropped.)
3. **No auto-infer toggle — DONE.** The `autoInfer` setting is removed (migration
   0005 reverted, store/API/UI stripped); `handlePullRequestInferOffer` now runs
   inference unconditionally on every PR event. The `error` state keeps its retry
   checkbox, so `handleCommentEditedInfer` stays as the manual retry path. 151
   github-app tests green.
4. A dedicated **Inferred** tab replaces the `_inferred/` group in the Contracts
   tab — now **OSS + EE** (infer is in both). Base = promotable; PR = awareness-only.

---

## Part A — ~~Move infer out of OSS~~ (DROPPED)

Reverted — infer stays in OSS. No engine move, no surface removal. The scoping is
kept below for reference only, in case the IP call is ever revisited.

<details><summary>Scoping (for reference; not actioned)</summary>

The `contract-verifier/src/infer/` subtree is infer-only but depends on
contract-verifier internals (`parser/resolver/extractor/types`), so a move would
need those exposed publicly; `inferInProcess` (spec-in-process.ts:1805) is a thin
orchestration over the infer subtree + already-exported core utilities and extracts
cleanly. OSS surfaces that a move would have removed: CLI `infer` command +
`contracts list --inferred`, and the dashboard `contracts_inferred` union.
</details>

---

## Part B — Auto-infer setting removed (DONE)

The per-repo `autoInfer` toggle is gone: migration 0005 reverted (schema + sql +
snapshot + journal), `RepoLinkRecord`/`GithubRepoSummary` field dropped, connect
PATCH/serialize + RepoSettings "Inference" section removed.
`handlePullRequestInferOffer` runs `runInferReport` unconditionally on every PR
event (no checkbox offer). The `error` comment still shows a retry checkbox, handled
by `handleCommentEditedInfer`.

---

## Part C — Inferred tab

### Done (list, EE-first)

- `apps/dashboard/client/src/ee/InferredPanel.tsx` — grouped-by-kind list; each row:
  identity, location, reason. Read-only for now.
- `inferred` tab registered in `navigation/registry.ts` (verification section,
  `requiredCapability: 'github-gate'`) + `EE_REPO_TAB_ORDER` + `RepoPage` render.
- EE route `GET /api/ee/github/repos/:owner/:repo/inferred` (connect.ts) → the gate
  **baseline's** stored `inferredDecisions` (the same set the PR diff uses). Shared
  types `InferredDecisionView` / `GithubInferredResponse`.
- **Data source decision:** read the gate baseline's structured summaries (already
  persisted for the diff) — no new persistence, no `.tc` parsing. This is why it's
  **EE-only for now**: that structured set only exists in the gate store.

### Persistent overlay + Dismiss — DONE (survives re-baseline)

The proper foundation is built — no workaround:
- New **`gh_inferred_actions`** table (migration `0005_inferred_actions`): one row per
  decision, `(repo_full_name, kind, identity)` PK, `status` = `dismissed | promoted`.
- `GateStore`: `setInferredAction` / `removeInferredAction` / `listInferredActions`
  (pg + file impls).
- `baseline.ts` applies the overlay after inference via
  `applyInferredActions(decisions, actions)` (`infer-actions.ts`), so a dismissed (or
  promoted) decision **stays gone across re-baselines** that re-infer from scratch.
- `POST …/inferred/dismiss` records a persistent `dismissed` action **and** drops it
  from the current baseline for an immediate effect; the `InferredPanel` row has a
  **Dismiss** button.
- Tests: `applyInferredActions` unit (4) + pg-store overlay round-trip (upsert +
  remove). 156 github-app tests green.

### Pending

- **Promote** — Part D; writes a `promoted` action to the same overlay + the spec
  regeneration (see finding below).
- **PR mode** (`prNumber != null`) awareness header (actions hidden).
- **OSS dashboard parity — DONE (read-only).** `inferInProcess` persists the
  structured summaries to the **spec store** as a new `inferredDecisions` artifact
  (file under `specs/` in OSS, Postgres in EE). New `GET /api/repos/:id/inferred`
  (analyses.ts) reads `loadLatestSpec(repo.path, 'inferredDecisions')`. The
  `InferredPanel` is edition-aware: EE → the gate route (overlay-filtered) +
  Promote/Dismiss; OSS → the local route, **read-only**. The `inferred` tab is
  un-gated (shows in both editions). 162 github-app + 614 other tests green.
  - Follow-up: **OSS actions** (dismiss/promote locally) need a core (file) actions
    overlay — the EE overlay lives in the gate store. Read-only is the first cut.

---

## Part D — Promote = generate spec (B)

### Finding (spec store investigation)

The hosted "spec" is not free prose we can append to — it's the **consolidated**
`claims.json` (machine JSON) that the scan pipeline GENERATES from source docs
(repo markdown / synced Confluence). So:

- We can't just "write a paragraph into the spec." Promote means **adding a claim**
  (synthesized from the decision — which is already structured: kind/identity/values
  + reason) to the canonical set, then regenerating the authored contract.
- **The persistence trap:** `claims.json` is regenerated from source docs on every
  scan/re-baseline, so an injected claim is overwritten and lost — exactly the same
  re-consolidation problem dismiss has. Promotion must live in a **persistent
  per-repo overlay** of promoted decisions that the consolidation merges in (like a
  small authored-decisions ledger), so it survives re-scan, then regenerate.

So Promote ≈ persistent promoted-decisions overlay → the baseline re-applies it into
the authored set each run → the gate enforces it. NOT a one-shot file move.

### Chosen model

The **baseline** is the natural merge point (it already re-infers + regenerates each
run). Promote records a `promoted` action in the overlay (`gh_inferred_actions`,
built); the baseline, after inference, **re-renders** each promoted decision's `.tc`
and writes it into the authored `contracts` set. `applyInferredActions` already drops
promoted (and dismissed) from the inferred summary. Survives re-baseline because the
overlay persists and the baseline re-applies. Base-only (PR ref rejected).

### Foundation — DONE (single-file contract primitive)

`ContractStore.putContractFile(ref, kind, relPath, content)` /
`deleteContractFile(ref, kind, relPath)` — write/remove ONE `.tc` in a set without
re-snapshotting. **Pg**: read-modify-write the manifest row, content rows shared
(content-addressed, no copy). **File**: write / `rm` the file. Exported wrappers in
core; tested (`tests/ee-data-store/contract-store.test.ts`, 19 green).

### Promote — DONE

- **`contractPath` plumbing:** `inferInProcess` now returns `decisionPaths`
  (`renderDecision(d).relPath` per decision, = the `contracts_inferred` set key);
  the infer pipeline maps it into the decision summary (`DecisionSummary` /
  `InferredDecisionSummary` gained `contractPath`). So every inferred decision knows
  where its `.tc` lives — no `.tc` parsing, no full-decision storage.
- **`POST …/inferred/promote { kind, identity }`** (connect.ts): looks up the
  decision's `contractPath` on the baseline → reads its `.tc` from
  `contracts_inferred` → `putContractFile(ref, 'contracts', ...)` (now authored +
  enforced) → records a `promoted` overlay action → drops it from the baseline set.
  Base-only; 404 if absent, 409 if the `.tc` is unavailable, 403 cross-org.
- **Baseline re-apply** (`baseline.ts`): after a re-baseline regenerates `contracts`
  from the spec (dropping promoted artifacts), each `promoted` decision's `.tc` is
  re-read from the fresh `contracts_inferred` and re-written into `contracts` — so a
  promotion survives `main` pushes. `applyInferredActions` drops promoted + dismissed
  from the visible set.
- **Client:** the `InferredPanel` Promote button is enabled and wired (optimistic
  removal), alongside Dismiss.
- **Tests:** contract-store `putContractFile`/`deleteContractFile` round-trip;
  promote/dismiss route tests (writes authored, records action, drops from set, 404 /
  409 / 403). **162 github-app tests green.**

---

## Part E — Shared-seam refactor (DONE)

Parts C/D landed EE-first: the overlay lived in the gate store (`gh_inferred_actions`
via `GateStore`), dismiss/promote were gate routes, and the baseline read inferred
decisions from `gh_baselines.inferred_decisions`. OSS read the spec store read-only.
That was a fork. This refactor collapses it onto the open-core pattern (shared logic +
one storage seam), so OSS and EE run the **same** code paths and differ only in
transport (file vs Postgres):

- **`packages/core/src/lib/inferred-action-store.ts`** — new `InferredActionStore`
  seam: the dismissed/promoted overlay. `FileInferredActionStore` default
  (`<repoKey>/.truecourse/specs/inferred-actions.json`); `PgInferredActionStore`
  (ee-data-store, backed by the existing `gh_inferred_actions` table keyed by
  `repoFullName = repoKey`) injected by `installEeStores` via `setInferredActionStore`.
- **`packages/core/src/lib/inferred-decisions.ts`** — the shared logic, edition-agnostic:
  `applyInferredActions`, `readInferredDecisions(repoKey)`,
  `readInferredDecisionsAt(ref)`, `dismissInferredDecision`, `promoteInferredDecision`
  (reads the `_inferred/` `.tc` → `putContractFile(..,'contracts',..)` → records
  `promoted`; `ok|not-found|unavailable`), and `reapplyPromoted(ref, decisions)`.
- **`inferInProcess`** persists the structured summaries to the spec store
  (`inferredDecisions`) and calls `reapplyPromoted` — so a promotion survives a fresh
  re-infer in **both** editions (no longer only the gate baseline).
- **One shared route** `/api/repos/:id/inferred[/dismiss|/promote]` (analyses.ts),
  used by OSS and EE alike; the `InferredPanel` always shows Promote/Dismiss. The
  EE-only gate routes, `gh_baselines.inferred_decisions` (migration
  `0006_drop_baseline_inferred`), and `infer-actions.ts` were removed.
- **The gate** (`infer-offer.ts`) reads the baseline's inferred set from the spec store
  at the baseline commit via `readInferredDecisionsAt`, filters head + baseline through
  the overlay, then `diffDecisions`.
- **Tests:** `tests/core/inferred-decisions.test.ts` (file transport round-trip),
  `tests/ee-data-store` `PgInferredActionStore`, `tests/dashboard-server/inferred-routes.test.ts`
  (6 — route shape + 400/404/409), github-app suite updated. Full suite green (only the
  3 pre-existing analyzer architecture-layer failures remain).

## Part F — Contracts surfacing, dismissed view, inferred badge (DONE)

- **Contracts tab excludes inferred.** `effectiveContractFiles` returns only the
  AUTHORED set (∪ workspace) — undocumented decisions live on the Inferred tab and
  appear in Contracts ONLY once promoted. (`contracts_inferred` no longer unioned.)
- **`inferred` badge.** A promoted contract is tagged with an amber `inferred` badge
  in the Contracts tree, via `promotedContractPaths(repoKey)` (core) → the contracts
  route marks matching authored paths → `ContractsPanel`.
- **Dismissed view + restore.** `readDismissedDecisions` / `undismissInferredDecision`
  (core) → `GET …/inferred/dismissed` + `POST …/inferred/restore` → the Inferred
  sidebar's collapsible **"Dismissed (N)"** section with a per-row **Restore** button.

## Part G — Promote = generate a documented Spec entry (DEFERRED, future)

Today Promote is **contract-only**: it writes the inferred `.tc` into the authored
`contracts` set (enforced) + records a persistent `promoted` overlay marker. It does
NOT add anything to the **Spec** (consolidated claims). The original Part D intent
("Promote = generate spec, then regenerate the contract") is **deferred**.

To build it: the spec/claims are regenerated from source docs every scan, so an
injected claim is overwritten (the "persistence trap"). Need a **persistent
promoted-decisions overlay merged at spec consolidation** (an authored-decisions
ledger), so a promoted decision shows in the Spec tab durably and its contract is
generated FROM that spec. The `promoted` overlay (`InferredActionStore`) already
exists as the foundation; this work wires it into the consolidation pipeline.

## Phases

(Part A dropped. Part B — auto-infer toggle — is an independent decision.)

1. **C** — Inferred tab + list/dismiss (OSS + EE), + the contract-store
   `promoteContract`/`dismissContract` helper (both backends).
2. **D** — promote = spec-gen + regenerate.

## Verification

- After C/D: list renders; promote writes the spec + regenerates the contract +
  drops from inferred; the promoted decision no longer appears in the next infer
  diff (it's authored); PR ref can't promote.

## Out of scope

- "Queue promotion on merge" for PR-side decisions.
- Bulk promote/dismiss.
