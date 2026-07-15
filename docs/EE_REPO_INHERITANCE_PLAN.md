# EE repo inheritance — repos fold workspace Knowledge into their spec/guard

Status: **PLANNED — awaiting review.** The guard-era successor to the retired
contracts-era "effective merge" (workspace ∪ repo, repo wins), which was removed
wholesale in the v0.7.0 verify/contracts retirement. Builds on the pushed
Knowledge work (PR #743 branch): the stored-document model makes inheritance a
materialization problem, not a connector problem.

## Requirements (user-stated, 2026-07-14)

- A hosted repo has its own spec docs AND inherits the workspace Knowledge.
- Repo↔workspace conflicts surface and are user-resolvable.
- Workspace-inherited docs render with a **workspace** badge in repo views.
- Repo guard scenarios are generated from **workspace + repo specs together**.

## Design — inherit at the SPEC level, before curate

1. **Materialize the workspace layer into the repo scan.** In the hosted scan
   pipelines (baseline scan + PR spec-regen, in `ee-github-app` — read
   `runBaseline` and the head-regen pipeline for where the cloned tree is
   curated), after clone and before curate: write every workspace ledger doc's
   STORED body (`PgKnowledgeStore.getDocBody` — no connector I/O) into the
   checkout at its exact `knowledge/<kind>/<id>.md` path. Transient — never
   committed to the repo. Inject via a core seam installed by ee-server (the
   `setSpecConflictsResolvedHook` pattern) so OSS local scans are inert.
   - Cache economics: same docPath + same content ⇒ the repo's curate HITS the
     relevance/area-tag/extraction caches the workspace already paid for —
     inheriting 10k docs adds ~0 LLM to a repo scan.
2. **Decisions merge — repo wins.** Materialize a MERGED decisions file into
   the scratch tree: workspace decisions (artifact `'decisions'`) as the base,
   the repo's own committed `specs/decisions.json` overlaid, repo entry winning
   per identity (same keying `buildCorpusConflicts` uses). Workspace-resolved
   conflicts (e.g. ADR-003 vs KAN-5) therefore arrive pre-resolved; the repo
   only surfaces conflicts it newly creates (repo doc vs workspace doc) or
   chooses to re-litigate. The merge is a pure function in core (unit-tested);
   the repo's decision WRITES keep writing only the repo file — repo verdicts
   on cross-layer conflicts live at repo scope, which IS the repo-wins rule.
3. **Conflicts come free.** With both layers in one curate, repo↔workspace
   disputes are ordinary within-area overlaps in the repo corpus, resolved in
   the repo Spec tab with the existing verdict UI. The repo-parity rule already
   in place (last conflict resolved → re-scan → generate) completes the loop.
4. **Badges + titles.** The repo corpus GET (OSS route, hosted-gated on
   `eeUser.organizationId`, inert in OSS): docs whose ref starts `knowledge/`
   get `layer: 'workspace'` plus the ledger title/url enrichment (reuse
   `titlesByDocPath`). `SpecCorpusView` renders the existing badge affordance
   (HoverPopover) for `layer === 'workspace'`; optional field ⇒ OSS unchanged.
5. **Scenarios from the union.** No new work: repo guard generate already runs
   over the repo's curated corpus — which now contains both layers. Generation
   stays blocked on open conflicts, including cross-layer ones.
6. **The ripple.** When workspace processing settles WITH corpus changes,
   enqueue baseline re-scans for the org's connected repos
   (`enqueueBaseline({ force: true, quiet: true })` per repo — the quiet flag
   exists precisely to avoid an N-repo toast storm; single-flight losses
   coalesce via the existing pending-baseline buffer). Wire it in the
   `knowledge.sync` settle hook beside the guard chain, ordered AFTER the
   workspace guard chain decision (both are best-effort, independent).
   Skip the ripple when the settling process changed nothing (compare the
   corpus content sha before/after).

## Files

- `ee/packages/github-app` scan pipelines — the materialization step (docs +
  merged decisions) via the new core seam; `ee/packages/server/src/index.ts`
  installs it.
- core: the seam (`packages/core/src/lib/…`, mirroring existing hook modules)
  + the pure decisions-merge helper (+ tests).
- `apps/dashboard/server` repo corpus route — `layer` + title/url enrichment
  (hosted-gated); `SpecCorpusView` — workspace badge render.
- `ee/packages/server/src/jobs/` — the ripple in the knowledge.sync settle
  path.
- Tests: materialization (docs + merged decisions land in the tree, transient),
  decisions merge precedence (repo wins per identity; workspace resolutions
  carry through), repo corpus GET layer/title fields (+ OSS inertness), badge
  render, ripple enqueue (changed vs unchanged corpus; coalesce on loss),
  cache-hit assertion (workspace-seeded cache → repo scan makes no LLM call
  for an unchanged workspace doc).

## Workspace scenarios are RETIRED by this plan (decided 2026-07-14)

Scenarios only mean something where they can run — a repo, via its recipe and
driver. With repos generating from the union, workspace-level scenarios are
redundant (and were never drivable — the CLI-only generate produced zero
scenarios from an HTTP-world spec, structurally). The workspace level keeps
ONLY specs + conflict resolution. Remove, in the SAME effort as inheritance
(never before): the `knowledge.guard` job (constants/worker/JobsApi/chain),
`generateWorkspaceGuardInProcess` + `estimateWorkspaceGuard` +
`readWorkspaceGuardCoverage/Scenario` (core), the workspace guard routes +
`guard.ts` doc fetch (ee-server), the `ws:<org>` scenario storage convention,
the Knowledge page Scenarios tab (page becomes Spec + Sources), and their
tests. The `knowledge.sync` settle hook chains the REPO ripple (this plan's
item 6) where it chained workspace generation; the workspace blocked-on-
conflicts logic survives as Spec-tab state only.

## Explicitly out / unchanged

Scenario-level set merging (rejected: workspace scenarios aren't repo-drivable;
spec-level folding generates repo-appropriate scenarios instead), per-repo
opt-out or module scoping (later), OSS local behavior, the workspace Knowledge
page and its flows.

## Decided (2026-07-14, user-confirmed)

- **Ripple: CONFLICT-FREE settles only.** A process that leaves open conflicts
  does NOT ripple — repos stay on the last clean spec until the workspace
  resolves its conflicts (no inherited-open-conflict storms across N repos).
  Same `openConflicts === 0` gate the decision-write rule uses.
- **Repo overrides are NOT surfaced at workspace scope.** The Knowledge page
  shows workspace-level state only; each repo shows its own decisions. (Not
  just deferred — the layering intent is that each scope displays its own.)
- **The workspace layer is folded EVERYWHERE a repo's spec is consumed** —
  the default-branch baseline scan AND the PR-head spec-regen alike (base and
  head must see the same spec world; current workspace snapshot at scan time).

## Small independent follow-ups (not part of this plan; do separately)

- **Progress-popup resurrection race**: job step details publish fire-and-
  forget, so a stale "running" event arriving after the terminal event re-adds
  the job in `JobsContext.tsx` (~line 99: unconditional re-add on active
  status). Fix: remember recently-settled job ids client-side, ignore late
  active-status events for them. ~5 lines + a test.
- **Decision-write coalesce replay**: `enqueueWorkspaceProcess`
  (spec-routes.ts) silently drops the transition-to-zero re-process when a
  `knowledge.sync` job is already running (single-flight loss) — the running
  job read decisions pre-verdict, so the corpus stays stale with no recovery.
  Fix: mirror the `pending-baseline` coalesce (one pending row per org, replay
  on settle, boot drain); when a replay fires, the settling job must SKIP its
  chains (the replayed run's own settle chains). After THIS plan lands, "its
  chains" means the repo ripple.
