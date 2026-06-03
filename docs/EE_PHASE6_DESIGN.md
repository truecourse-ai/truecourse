# Phase 6 — Contracts/Specs server-side + commit-back removal (locked design)

Synthesized from a 3-proposal judge panel. This is the build spec for Phase 6 of
[`EE_STORAGE_PLAN.md`](EE_STORAGE_PLAN.md). OSS stays byte-for-byte; EE diverges
only at the seam. The IL packages (`contract-extractor`, `contract-verifier`,
`spec-consolidator`) are **unchanged (zero lines)** — the seam lives in `core`
(the only layer that imports them and is injectable by EE).

## Seams (core)

Two stores. **Contracts = directory-oriented** (the IL writers/readers are opaque
directory producers/consumers — `writeContracts` plans paths internally, `verify`
walks the tree; a file-level seam would force core to reimplement `pickFilePath`).
**Specs = JSON-document-oriented** (two small JSON files, inline jsonb — no blob).

```ts
// packages/core/src/lib/contract-store.ts
export interface RepoRef { repoKey: string; commitSha: string }   // repoKey = path (file) | repo id (EE)
export type ContractKind = 'contracts' | 'contracts_inferred';    // split lifecycles (locked)
export interface MaterializedDir { dir: string; cleanup(): Promise<void> }  // caller MUST cleanup in finally
export interface SaveContractsResult { manifest: Record<string,string>; fileCount: number; objectsWritten: number; manifestHash: string }
export interface ContractStore {
  saveContracts(ref, kind, sourceDir): Promise<SaveContractsResult>;
  loadContracts(ref, kind): Promise<MaterializedDir | null>;   // file impl → live repo dir, no-op cleanup
  hasContracts(ref, kind): Promise<boolean>;
  readonly materializesInPlace: boolean;   // true = load returns live repo tree (file); false = temp (EE)
}
// packages/core/src/lib/spec-store.ts
export type SpecArtifact = 'claims' | 'decisions';
export interface SpecStore {
  saveSpec(ref, artifact, json): Promise<void>;
  loadSpec<T>(ref, artifact): Promise<T | null>;
  readonly materializesInPlace: boolean;
}
```

Registry + delegators mirror `verify-store.ts` (`get/set/resetContractStore`,
`get/set/resetSpecStore`, const delegators). EE installs both in **Phase 8**:
`setContractStore(new PgBlobContractStore(db, blob))`, `setSpecStore(new PgSpecStore(db))`.

`repo-ref.ts`: `resolveCommitSha(repoRoot)` (HEAD via getGit, `''` if non-git);
`repoRef(repoRoot, override?)`. GitHub App passes `repoKey=repoFullName`,
`commitSha=headSha` explicitly (never derives from the shallow clone HEAD).

## File default (OSS) — true no-op pass-through

`FileContractStore.materializesInPlace = true`. `saveContracts` = no-op (the IL
already wrote `<repo>/.truecourse/contracts`; `sourceDir` IS that tree).
`loadContracts` returns `{ dir: <repo>/.truecourse/contracts[/_inferred], cleanup: noop }`
— **never deletes** (it's the user's repo). `FileSpecStore` reads/writes the raw
JSON at `.truecourse/specs/{claims,decisions}.json` verbatim.

Generation write-target fork owned by core via `stageContractWorkspace(ref, repoRoot, run)`:
OSS → `run(repoRoot)` (real repo, save no-ops); EE → temp root, materialize spec
inputs first (`loadSpec`), `run(<tmp>)`, `saveContracts(ref, kind, <tmp>/...)`, `rm -rf`.
The GitHub App runners skip this — they already own a throwaway clone dir.

## EE impl — content-addressed

Object key: `${repoPrefix(repoKey)}/${kind}/objects/${sha}` (sha = `sha256-`+hex),
immutable, deduped per `(repo, kind)`. **No objects table** — objects live only in
Blob (`exists()` is the index). Manifest = jsonb in the row: `{v:1, files:{relPath: sha}}`,
sorted → stable `manifestHash`.

```ts
// ee/packages/db/src/schema/contracts.ts
contract_sets: PK(repo_key, commit_sha, kind), { manifest jsonb, manifest_hash, file_count, created_at, updated_at }
  idx (repo_key, kind, created_at) + (repo_key, kind, manifest_hash)
spec_sets:     PK(repo_key, commit_sha, artifact), { payload jsonb, created_at, updated_at }
  idx (repo_key, artifact, created_at)
```
Opaque `repo_key text`, no FK (consistent with Phase 4/5). `kind`/`artifact` = plain text.

**save**: assert commitSha≠''; walk `.tc` rel paths (kind=contracts EXCLUDES `_inferred/`;
kind=contracts_inferred walks only `_inferred`); per file: hash → `assertSafeRel` →
`blob.exists`? skip : `put`; upsert manifest row LAST (objects-first so a crash never
leaves a dangling manifest). **load/materialize**: read row → mkdtemp → per (rel,sha):
`safeJoin(dir, rel)` → `blob.get` (throw IntegrityError if missing) → write; return
`{dir, cleanup: rm -rf}`; on ANY partial failure `rm -rf` then rethrow (`ok` flag).
verify with includeInferred overlays `contracts_inferred` into `dir/_inferred/`.

**Path safety (mandatory both ends)**: `safeJoin` normalizes `\`→`/`, rejects
null/absolute/drive/`..`, resolves + `startsWith(root+sep)`. Save-side `assertSafeRel` too.

`PgSpecStore`: upsert/select `spec_sets` payload jsonb; `materializesInPlace=false`; no blob.

## GC (deferred mark-sweep, never inline ref-count)

`contract-gc.ts`, scheduled, per `(repoKey, kind)`: (1) retention deletes old rows
(keep last N + baseline + gh-referenced commits) — out of Phase 6 required scope;
(2) mark = union object shas across live manifests; (3) sweep = `blob.list(prefix)`,
delete sha ∉ live AND older than grace window (24h, closes save/GC race без lock).
**Prereq**: add `BlobStore.list(prefix)` to the interface + 4 adapters.

## Core rewiring (`spec-in-process.ts`)

Every `<repo>/.truecourse/{contracts,specs}` assumption goes through the seam; OSS
resolves to the same path with no-op save/cleanup → unchanged. All 4 commands wrap
the IL call in `try/finally { await cleanup() }`.
- generate: `stageContractWorkspace` → `generateContracts({repoRoot: writeRoot})` → `saveContracts(ref,'contracts',...)`.
- infer: `loadContracts(ref,'contracts')` → `infer` → `writeInferred(dir,...)` → `saveContracts(ref,'contracts_inferred', dir/_inferred)`.
- verify/verifyDiff: `mat = options.contractsDir ? {dir,noop} : loadContracts(ref,'contracts')`; `null` → same "Contracts directory not found" error; `verify({contractsDir: mat.dir, codeDir})`; finally cleanup. Add `VerifyInProcessOptions.ref?`.
- Recorded `contractsDir` in EE snapshots = logical descriptor `contracts@<sha>`, not the temp path. OSS keeps literal path.
- scan: after `consolidate` → `saveSpec(ref,'claims'|'decisions', ...)`. Decisions-mutation helpers go async via SpecStore in EE, stay sync IL file IO in OSS; `consolidate` stays sync (core materializes decisions.json into temp BEFORE calling it).

## GitHub App (commit-back removal)

- `spec-scan.ts`/`infer-scan.ts`: DELETE `COMMIT_PATHS`, `git add/commit/push`, fork-push guards. Add `headSha` to request (thread `pr.headSha` from offer handlers). Ingest the clone: `saveSpec(ref,'claims'|'decisions')` + `saveContracts(ref,'contracts'|'contracts_inferred', tmp/...)`. Result drops `changedFiles`; `commitSha`=headSha.
- `gate-runner.ts`: `driftsForCommit(repoFullName, sha, checkoutDir, deps)` — (1) `hasContracts`? verify; (2) cold → `runSpecScan` into store → verify; (3) genuinely no spec → `null` (neutral `no-contracts`). Generation THROW propagates → handler's error-Check (NOT neutral). Wrap cold regen in existing `gateInFlight` guard. `verifyForRef(ref, checkoutDir)` = `verifyInProcess` with `ref` (contracts from store) + `codeDir=checkoutDir`. Base side + `baseline.ts` save under `(repoFullName, commitSha)`.
- Comments link to dashboard (`/repos/{repoFullName}/contracts?commit={headSha}`), not "committed N files".
- `gate.ts` (`decideGate`) unchanged: `headDrifts===null` already → `no-contracts`.

## Top risks
1. **decisions-mutation async ripple** — OSS sync IL / EE async SpecStore boundary; `consolidate` cannot import core.
2. **gate sourcing** — `null` must mean no-spec, never gen-failed; exact warm/cold/null order; throw propagates to error-Check.
3. **temp-dir leak** — try/finally every command; load self-deletes on partial failure; file cleanup is a guaranteed no-op (deleting it would wipe the user's repo).
4. **manifest path traversal** — `safeJoin` + `assertSafeRel` both ends (arbitrary-write primitive on a multi-tenant host).
5. **OSS drift / object-write races** — golden parity test; content-addressed puts are idempotent (no lock).

## Checklist (smallest-safe-step first; each build+test-able)
1. core `repo-ref.ts` (resolveCommitSha/repoRef).
2. core `contract-store.ts` (interfaces + FileContractStore no-op + registry/delegators).
3. core `spec-store.ts` (FileSpecStore raw-json + registry/delegators).
4. core `contract-workspace.ts` (stageContractWorkspace; OSS branch only exercisable now).
5. core rewire `spec-in-process.ts` (thread ref+seam through generate/verify/verifyDiff/infer/scan; `VerifyInProcessOptions.ref?`; decisions helpers async-capable; logical contractsDir descriptor). **Run full verify/infer/scan suites — OSS parity gate.**
6. ee-db `schema/contracts.ts` + register + migration.
7. ee-storage add `BlobStore.list(prefix)` to interface + 4 adapters.
8. ee-data-store `keys.ts(+contractObjectKey)`, `contract-store.ts` (PgBlobContractStore), `spec-store.ts` (PgSpecStore) + helpers (safeJoin/assertSafeRel/sha256/mapLimit). Tests: round-trip, dedup, path-safety, no-leak.
9. ee-data-store `contract-gc.ts` mark-sweep. Test.
10. ee-github-app thread `headSha` (request types + offer handlers).
11. ee-github-app rewrite `spec-scan.ts`+`infer-scan.ts` (delete commit-back, ingest via save). Test.
12. ee-github-app `gate-runner.ts`+`verifyForRef` (driftsForCommit warm/cold/null; base regen; baseline saves). Test.
13. ee-github-app comment builders → dashboard links.
14. **Phase 8 hand-off**: `setContractStore`/`setSpecStore` install, GC schedule, temp-dir startup sweeper.

## Deviations from this spec (as built)

- **Dropped `stageContractWorkspace`.** In EE the "repo" is always a throwaway
  clone, so generation can write in-place to it and then ingest — there is no
  "don't touch the repo" case in any Phase-6 flow. So generate/scan/infer write
  in-place as today and **ingest via the seam gated on an explicit `options.ref`**
  (the GitHub App passes `{repoFullName, headSha}`); OSS omits `ref` → no ingest,
  byte-identical. This also removed the spec-input re-materialization dance.
- **Ingest gate is `options.ref`, not `!materializeInPlace()`.** Deriving the ref
  from the clone path would key sets under a garbage identity in the EE process;
  requiring an explicit ref makes the GitHub App the single caller that persists.
- **Gate cold path generates on the gate's own checkout** (no second clone): the
  runner already has the code checked out, so `driftsForCommit` runs
  `scanPipeline.scan/generate` on `tmp` and persists under `(repo, sha)`.
  `driftsForCommit` is exported for direct testing.
- **Decisions-mutation async ripple DEFERRED to Phase 8.** The interactive
  decision-mutation helpers stay sync (OSS file IO); the gate/scan flow persists
  the consolidated `claims`/`decisions` via `saveSpec` in `scanInProcess`, which
  is all the gate needs. The dashboard spec-edit routes go async in Phase 8.
- **Dashboard deep-link is text-only for now.** Comments truthfully say contracts
  are stored in TrueCourse + the commit, but the clickable URL needs `appUrl`
  threaded into the comment builders — a Phase-8 wiring polish.
- **Fork PRs still skipped** (the offer fork-guard kept). Server-side fork
  support needs a PR-ref clone strategy — a separate enhancement, not part of
  "remove commit-back".
- **Root `package.json`** gained `@truecourse/core` (workspace:*) as a devDep so
  root-level test files resolve the new `@truecourse/core/lib/contract-store`
  bare specifier and share its singleton with the GitHub App.

## Adversarial review (5 findings, all fixed)

A 5-dimension judge panel + adversarial verification confirmed 5 real issues:
1. **HIGH — `defaultVerify` swallowed ALL verify failures to `null`** (gate-runner).
   A GC'd/missing object or verifier crash, *after* `hasContracts` proved the set
   exists, collapsed to neutral `no-contracts` → gate silently stops blocking
   (invariant #3). Fixed: only the literal "Contracts directory not found" is
   neutral; every other throw propagates → error Check. Regression test added.
2. **HIGH — `runBaseline` swallowed gen/verify failure into a neutral baseline**,
   stickily disabling the gate for all PRs against that default-branch commit.
   Fixed: failures propagate (caller logs; prior baseline left intact → gate
   self-heals via live base recompute); `null` baseline only on genuine no-spec.
3. **(= #1)** second reviewer confirmed the same `defaultVerify` conflation.
4. **MEDIUM — `objectsWritten` over-counted** when two `.tc` in one corpus share
   content (check-then-act race in `mapLimit`). Fixed: `saveContracts` now
   dedupes by sha within the save (phase 1 hash+manifest, phase 2 put unique
   shas) → one put + accurate count per unique content. Test added.
5. **LOW — stale "commit back" docstrings** in spec-offer/infer-offer headers.
   Fixed to "persist server-side."

Post-fix: build 17/17, suite 4366 passing (only the 3 pre-existing analyzer
failures), import-boundary green.
