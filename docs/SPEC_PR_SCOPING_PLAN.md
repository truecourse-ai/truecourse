# EE Spec PR-Scoping Plan

STATUS: BUILT (2026-07-02). All phases landed; affected test projects green (the full-suite C#/Roslyn failures are the machine's missing .NET SDK, unrelated). Uncommitted.

Fixes SPEC_CONTRACT_VERIFY.md §12.3: in EE, a PR's spec must be scoped to that PR — not leak
into the base repo view or other PRs. Conflict resolutions made in a PR's context are PR-scoped
and promote into the repo's decisions on merge. On merge, main's contract regeneration anchors to
the merged PR's reviewed contracts so "what you reviewed is what lands."

OSS is untouched throughout: its file stores have no commit dimension, every change below is
behind an optional parameter or an EE-only seam, and OSS behavior must be verified unchanged.

---

## Current behavior (verified, file:line)

**Corpus reads ignore the commit.**
- `GET /api/repos/:id/spec/corpus` (`apps/dashboard/server/src/routes/spec.ts:82` → `corpusPayload`
  `:64` → `getCorpus` `packages/core/src/commands/spec-in-process.ts:1799`) reads through
  `loadLatestSpec` → `PgSpecStore.loadLatest` (`ee/packages/data-store/src/spec-store.ts:87`):
  newest `spec_sets` row by `createdAt`, **no commit filter**. A PR-head gate scan (saved at the PR
  head SHA by `ee/packages/github-app/src/spec-scan.ts:71-73`) becomes what everyone sees.
- A per-commit `loadSpec(ref, artifact)` already exists (`spec-store.ts:65`, core delegator
  `packages/core/src/lib/spec-store.ts:142`) — the route just doesn't use it.
- `spec_sets` PK is `(repoKey, commitSha, artifact)` (`ee/packages/db/src/schema/contracts.ts:48-61`).
- Same leak in the workspace repo overview: `ee/packages/github-app/src/connect.ts:135-136`
  (`getCorpus` + `latestSpecCommit`).
- The client already has the scoping pattern: `?pr=N` → `refForTabs = activePrRun?.headSha`
  (`apps/dashboard/client/src/components/pages/RepoPage.tsx:206-212`), threaded into
  `useContractsTree(repoId, refForTabs)` (`:361`) and `useVerifyState(repoId, refForTabs, pr)`
  (`:373`). The Spec tab is the exception: `useSpecCorpus(repoId, enabled)` (`:1172`), no ref
  (`SpecCorpusView.tsx:109-164`, `api.ts:1042`).
- The baseline-anchor helper that deliberately avoids `loadLatest` already exists:
  `apps/dashboard/server/src/routes/diff-base.ts` (derives the baseline commit via the verify
  store's `isBaseline` filter).

**Doc reads are baseline-pinned.**
- `readRepoDoc` seam: `packages/core/src/lib/repo-doc-reader.ts:39`. EE impl
  `ee/packages/github-app/src/repo-doc.ts:16-39` fetches at `baseline?.commitSha ?? defaultBranch`
  — never the viewed commit. Callers: the Spec doc-viewer route (`spec.ts:135,152` — its `ref`
  query param is the **doc path**, not a git ref) and `buildStoredDocSource`
  (`spec-in-process.ts:1812-1841`, the EE re-curate doc source).

**Decisions are one repo-global row.**
- `decisions` table: `scope text PRIMARY KEY, payload jsonb, updated_at`
  (`ee/packages/db/src/schema/decisions.ts:12-16`). `PgSpecStore` routes the `decisions` artifact
  to `saveDecisions(ref.repoKey, …)` / `loadDecisions(ref.repoKey)` — the sentinel commit
  `DECISIONS_REF = '_repo'` (`spec-in-process.ts:1769-1785`) is discarded (`spec-store.ts:44-52,
  69-70, 166-181`).
- All six mutation routes are in `apps/dashboard/server/src/routes/spec.ts` (relations POST/DELETE
  `:194-245`, includes `:304-338`, excludes `:342-376`), no PR parameter, shared by both editions
  (EE never re-registers them; it only swaps stores — `ee/packages/server/src/index.ts:86,142`).
- EE decision edit → `recurateAndRegenIfResolved` (`spec.ts:186-192`) → `recurateStoredCorpus`
  (`spec-in-process.ts:1855-1870`), which **saves the corpus at `latestSpecCommit(repoKey)`**
  (`:1867`) — possibly a PR's commit (another leak facet). If `openConflicts === 0` →
  `enqueueContractsRefresh` (`spec.ts:169-177`, background task `{type:'repo.contracts'}`) →
  `onContractsRegenerated` (`ee/packages/server/src/jobs/index.ts:205-231`): forced re-baseline of
  the existing baseline commit + `reverifyOpenPrs`.
- Both the baseline scan and every PR-head scan fold the same row:
  `ee/packages/github-app/src/spec-scan.ts:68` `getDecisions(ref.repoKey)` →
  `curateInProcess(repoRoot, { skipGit: true, tracker, decisions })` (`:71`). Callers:
  `baseline.ts:127` (baseline) and `gate-runner.ts:187` inside `driftsForCommit` (PR head).

**Merge is anonymous.**
- `pull_request.closed` is unhandled: `GATE_ACTIONS = ['opened','synchronize','reopened']`
  (`gate-handler.ts:54`), `PR_OFFER_ACTIONS` likewise (`pr-events.ts:10`); a `closed` payload
  reaches `onPullRequest` (`index.ts:126-142`) and both handlers early-return.
- Merge = default-branch push (`webhook.ts:169-188`) → `enqueueBaseline(commitSha: payload.after)`
  (`index.ts:108-123`, single-flight key per-repo `jobs/index.ts:184-197`) → `runBaseline`
  (`baseline.ts:84-221`) re-scans/regenerates from scratch, anchored only to the OLD baseline
  (`anchorRef = existing ? {repoKey, commitSha: existing.commitSha} : undefined`, `baseline.ts:136-137`).
- Anchoring machinery (reuse, don't rebuild): `materializeAnchorContracts`
  (`spec-scan.ts:80, 95-108`) writes a stored commit's `.tc` into `<clone>/.truecourse/contracts/`
  before generation; core `buildPriorContracts` (`spec-in-process.ts:715-747`) picks them up;
  per-area spec-hash diff `classifyAreas` (`packages/contract-extractor/src/manifest.ts:65-95`)
  drives the manifest no-op (`corpus-generate.ts:236`).
- No link from merge commit → merged PR exists; `PushPayload` (`webhook.ts:39-44`) has no
  `commits[]`; octokit wrapper (`octokit.ts`) has no `listPullRequestsAssociatedWithCommit`.
  No contract-set copy API exists (none needed — see Phase 3).

---

## Pinned interfaces (agents B and C build against these; agent A implements them)

- **Decisions overlay scope**: reuse the `decisions` table. Repo row scope = `repoKey`
  (unchanged). PR overlay row scope = `` `${repoKey}#pr/${prNumber}` ``. Core addresses the
  overlay through the existing spec-store seam with sentinel commit `` `_pr/${prNumber}` ``
  (alongside `'_repo'`); `PgSpecStore` maps `_pr/N` → scope `${repoKey}#pr/N`. The OSS file store
  throws on a PR-scoped decisions ref (OSS never passes one).
- **Core decisions API** (in `packages/core`, exported from the spec command surface):
  - `getDecisions(repoKey, opts?: { pr?: number })` — effective decisions; with `pr`, returns
    repo ∪ overlay merged (overlay wins).
  - `mergeDecisions(base, overlay): DecisionsFile` — pure. Relations: overlay relation on the
    same doc pair (order-insensitive, same scope) replaces the base one. `manualIncludes` /
    `manualExcludes`: union by path; on include/exclude conflict for the same path, the overlay's
    verb wins (remove the path from the other list). `manualAreas`: overlay wins per doc.
  - `promoteDecisionsOverlay(repoKey, pr): Promise<boolean>` — load overlay; if absent → false
    (idempotent no-op). Else merge into the repo row, save, delete the overlay row, return true.
  - `discardDecisionsOverlay(repoKey, pr)` — delete the overlay row.
  - Existing mutation helpers (`addRelation`, `removeRelation`, `addManualInclude`,
    `removeManualInclude`, `addManualExclude`, `removeManualExclude`,
    `spec-in-process.ts:1981-2043`) gain `opts?: { pr?: number }` → read-modify-write the overlay
    row instead of the repo row.
  - Data-store: `PgSpecStore` needs a decisions **delete** (doesn't exist today) — add
    `deleteDecisions(scope)` routed through the seam.
- **Corpus route**: `GET /:id/spec/corpus?ref=<commitSha>`.
  - With `ref`: `loadSpec({repoKey, commitSha: ref}, 'corpus')`; if no row, fall back to the
    baseline corpus. Response gains `corpusCommit?: string` (the commit whose corpus was actually
    returned) so the client can label a fallback.
  - Without `ref`, EE: load at the **baseline commit** (reuse the `diff-base.ts` anchor helper),
    never `loadLatest`. Without `ref`, OSS: unchanged file read.
- **Doc route**: `GET /:id/spec/doc?ref=<docPath>&commit=<sha>` — new optional `commit` param
  (NOT `ref`, which is already the doc path). Seam becomes
  `readRepoDoc(repoKey, docPath, opts?: { commit?: string })`; the EE reader fetches at
  `opts.commit ?? baseline ?? defaultBranch`; OSS ignores it.
- **Mutation routes**: all six accept optional query param `?pr=<number>`. With `pr` (EE only):
  write the overlay, re-curate the **PR head** corpus in-process, save it at the PR head commit,
  return the fresh corpus (same `SpecCorpusResponse` + `corpusCommit`). Repo-scope behavior
  (no `pr`) unchanged, except the save-target fix below.
- **PR re-curate** (core): `recuratePrCorpus(repoKey, prHeadSha, prNumber)` — doc universe from
  the corpus at `prHeadSha` (falling back to the baseline corpus when the PR never scanned specs),
  doc bodies read at the PR head via the extended `readRepoDoc`, decisions =
  `getDecisions(repoKey, { pr })`, result saved at `prHeadSha`. Mirrors `recurateStoredCorpus`
  (`skipGit`, `skipCorpusWrite`, `buildStoredDocSource`).
- **Repo-scope re-curate save-target fix**: `recurateStoredCorpus` saves at the **baseline
  commit**, not `latestSpecCommit` (`spec-in-process.ts:1867`).
- **Targeted PR re-gate**: background task `{ type: 'pr.regate', repoKey, prNumber }` through the
  existing `getBackgroundTaskRunner()` seam (extend the core task-type union). When a PR-scoped
  edit brings that PR's conflicts to zero, the route enqueues it (instead of
  `enqueueContractsRefresh`, which stays repo-scope-only). The EE jobs layer handles it by
  force-re-gating that single PR (agent B).
- **Scan pipeline**: `scanPipeline.scan(dir, ref, tracker?, opts?: { pr?: number })` — with `pr`,
  folds `getDecisions(repoKey, { pr })` (agent B wires the github-app side; the merged-decisions
  loader comes from agent A).

---

## Phase 1 + 2 — core, data-store, routes (agent A)

1. `PgSpecStore`: decisions scope routing for the `_pr/N` sentinel; `deleteDecisions`; keep
   `loadLatest` for other callers but stop using it for the Spec tab (see routes). File:
   `ee/packages/data-store/src/spec-store.ts` (+ seam types in
   `packages/core/src/lib/spec-store.ts`).
2. Core decisions API + `mergeDecisions` + promote/discard + `pr` opts on mutation helpers +
   `recuratePrCorpus` + `recurateStoredCorpus` save-at-baseline fix
   (`packages/core/src/commands/spec-in-process.ts`).
3. `readRepoDoc` seam `commit` option (`packages/core/src/lib/repo-doc-reader.ts`); EE reader
   change is a one-line ref selection (`ee/packages/github-app/src/repo-doc.ts:25-26`) — A may
   touch this one github-app file (B is told hands-off on it).
4. Routes (`apps/dashboard/server/src/routes/spec.ts`): corpus `?ref` + baseline default +
   fallback + `corpusCommit`; doc `&commit`; six mutations `?pr` → overlay + `recuratePrCorpus` +
   conflict-free → enqueue `pr.regate`; repo-scope path unchanged. `connect.ts:135-136` overview
   fix belongs to agent B (github-app package) — A only exposes what it needs.
5. Tests: `mergeDecisions` semantics; promote idempotency; overlay scope save/load/delete;
   corpus route ref/baseline/fallback; mutation routes with `pr`; save-at-baseline fix. Follow
   existing test locations (`tests/server/…` for routes/core; EE data-store tests where the
   existing ones live).

## Phase 3 — github-app merge flow (agent B, after A)

1. `pull_request.closed` handling (`index.ts` onPullRequest): merged → `promoteDecisionsOverlay`
   (idempotent); unmerged → `discardDecisionsOverlay`. Best-effort cleanup of the PR-scoped code
   quality diff (`${repoFullName}::pr/${prNumber}`, `gate-runner.ts:292`).
2. Octokit: add `listPrsForCommit` (GitHub "list pull requests associated with a commit").
3. `runBaseline`: after clone, resolve the merged PR for `commitSha` (closed-event race-proofing):
   if a merged PR is found → `promoteDecisionsOverlay` BEFORE the spec scan, and
   `anchorRef = { repoKey, commitSha: <PR head SHA> }` when `hasContracts` at that head — falling
   back to the existing-baseline anchor. Works for merge and squash commits.
4. Manifest carry-over: ensure the stored contract set includes `contracts/manifest.json` (the
   area→specHash record) and that `materializeAnchorContracts` materializes it, so the
   merge-commit generate is a true `classifyAreas` no-op for unchanged areas and `saveContracts`
   then persists the reviewed tree under the merge commit. VERIFY FIRST: `saveContracts` walks
   `.tc` only today (`ee/packages/data-store/src/contract-store.ts:41-97`) and check whether
   `listContractFiles`/`loadContracts` filter to `.tc` — extend whichever end is needed without
   breaking existing sets (missing manifest in an old set = no no-op, just cache hits; must not
   error).
5. PR-head scan folds the overlay: `spec-scan.ts` scan gains `opts.pr`; `gate-runner.ts` passes
   the PR number for the head side only (base/baseline stay repo-only).
6. `pr.regate` task handler in `ee/packages/server/src/jobs/`: force-re-gate one PR (targeted
   variant of `reverifyOpenPrs`, reusing its synthesized-event + `force` mechanism).
7. `connect.ts:135-136` overview: conflict count from the baseline-commit corpus, not latest.
8. Tests: closed/merged promotion + discard; baseline PR-resolution + anchor selection (merged PR
   found / not found / no contracts at head); event-order race (push-before-closed); scan overlay
   folding head-vs-base; manifest round-trip through save/materialize; `pr.regate` handler.

## Phase 4 — client (agent C, after A, parallel with B)

1. `api.ts`: `getSpecCorpus(repoId, ref?)`, `getSpecDoc(repoId, docRef, commit?)`, `pr` param on
   the six mutation calls.
2. `useSpecCorpus(repoId, enabled, ref?)` re-fetching on ref change (`SpecCorpusView.tsx:109-164`),
   threading into fetch/refetch/apply; `RepoPage.tsx:1172` passes `refForTabs` (the exact
   `useContractsTree`/`useVerifyState` pattern at `:361`/`:373`).
3. PR view: mutation calls pass the PR number; doc viewer passes `refForTabs` as `commit`; when
   the response's `corpusCommit` ≠ the requested ref, show a subtle "showing base spec — this PR
   changed no docs" note (reuse existing muted-note styling; no new component).
4. OSS behavior byte-identical (no ref ever passed outside a PR view; Scan button gating
   unchanged at `RepoPage.tsx:1180`).
5. Tests: hook-level (vitest jsdom project) for ref threading and PR-scoped mutation params,
   following the existing dashboard client test setup.

## Phase 5 — verification + docs (main session, after B and C)

1. Full `pnpm test` (output to a file, read once).
2. Integration scenario (test or scripted assertion at the store level): PR scans a new spec doc →
   repo view (baseline) and a second PR's view unchanged; PR-scoped conflict resolution → other
   scopes unaffected; merge → decisions promoted, baseline anchored to the PR head, contracts at
   the merge commit byte-identical to the reviewed set when docs match.
3. Update `docs/SPEC_CONTRACT_VERIFY.md` body sections (§1.4, §2.3.2, §2.7, §3.10.2, §11.3, §11.5,
   §11.8) to the new behavior; shrink §12.3 to the remaining spec-diff-view gap; drop the §12.16
   Spec-tab row.

---

## Edge cases (decided)

- PR view with no gate run yet (`refForTabs` undefined) → Spec tab behaves like the repo view
  (baseline corpus), consistent with Contracts/Verify.
- Code-only PR (no corpus at head): corpus route falls back to baseline + `corpusCommit` label;
  a PR-scoped decision edit still writes the overlay and re-curates at the PR head using the
  baseline corpus as the doc universe.
- Unmerged-closed PR: overlay discarded; nothing promoted.
- Promotion is idempotent and may run twice (closed handler + baseline) — second run is a no-op.
- Two PRs' overlays are independent rows; promotion on the repo row is read-modify-write,
  last-writer-wins (same as today's repo-scope writes).
- Old contract sets without a stored manifest: anchor still works (extract-cache hits), just no
  hard no-op — never an error.

## Ground rules for implementation agents

- Never commit; leave all changes in the working tree. Never start/stop dev servers.
- No workarounds — root-cause fixes only. Production quality; no stubs or TODOs.
- Tests: green is done. Run targeted vitest per package while iterating; save full-run output to
  a file and read it (don't re-run with grep variations).
- Match surrounding code style; minimal comments; no plan/phase references in code comments.
