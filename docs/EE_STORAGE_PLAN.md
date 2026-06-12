# Hosted EE Storage — Postgres + Blob, repo read-only

> Scope: make the **enterprise (hosted)** edition store everything server-side.
> Today TrueCourse reads/writes per-repo state under `<repo>/.truecourse/` on the
> local filesystem and (for the GitHub App) commits generated contracts back into
> the customer's repo. For hosted EE that's wrong: containers are ephemeral,
> tenants must be isolated, and **we must never write to the customer's repo.**
> The **OSS / local edition is unchanged** — it keeps using files + git.

This is a design doc separate from [`docs/PLAN.md`](PLAN.md); it tracks the
storage migration only.

---

## Principles

1. **Repo is read-only.** We clone to read code. **Nothing is ever committed
   back** — no `git add`/`push` to customer branches. Every artifact we produce
   lives in *our* storage.
2. **Everything server-side for EE.** All per-repo state (analyses, drift,
   contracts, specs, config, ui-state, caches) is stored by the service, keyed by
   a logical repo identity — not a filesystem path or a git commit.
3. **Cloud-agnostic.** Storage backends sit behind interfaces. Blob storage
   supports **Azure (native, first-class), S3-compatible (AWS / MinIO / on-prem /
   R2…), Postgres, and filesystem** — selected by config.
4. **Azure-first.** The initial hosting target is Azure: Azure Database for
   PostgreSQL + Azure Blob Storage with **managed identity** (no stored keys).
5. **OSS untouched.** The default adapters are file + git, exactly as today. EE
   adapters (Postgres / Blob) are injected through the open-core seam; OSS never
   imports them.

---

## Current state (what's file-based today)

All in `packages/core`, all plain functions keyed by a `repoPath`, no adapter
seam:

| Concern | Module | Files under `.truecourse/` | Gitignored? |
|---|---|---|---|
| Analyses | `lib/analysis-store.ts` | `analyses/`, `LATEST.json`, `history.json`, `diff.json` | mixed¹ |
| Drift | `lib/verify-store.ts` | `verifier/{runs,LATEST,history,diff}` | mixed¹ |
| Per-repo config | `config/project-config.ts` | `config.json` | committable |
| UI state | `config/ui-state.ts` | `ui-state.json` | gitignored |
| Project registry | `config/registry.ts` | global `~/.truecourse/registry.json` | n/a |
| Concurrency lock | `lib/analysis-store.ts` | `.analyze.lock` (O_EXCL) | gitignored |
| **Specs** | `@truecourse/spec-consolidator`, `contract-extractor` | `specs/` (`claims.json`, `decisions.json`) | **committable** |
| **Contracts** | `@truecourse/contract-extractor` | `contracts/`, `contracts/_inferred/` | **committable** |
| **Caches** | spec-consolidator + contract-extractor | `.cache/` (relevance, chain-detection, conflict-*, blocks) | gitignored |

¹ `LATEST.json` / `verifier/LATEST.json` are committable (so a fresh clone
inherits a baseline via git); the rest is gitignored.

Existing EE Postgres tables (to be folded in): `gh_*` (gate),
`llm_provider_config`.

### Two fundamentally different data shapes
- **Source-of-truth artifacts** committed to git today: **contracts + specs**.
  The verify model is "head code vs head's own contracts," and the GitHub App
  commits them back to PRs. For hosted EE these move **server-side, keyed by
  (repo, commit)** — they are *not* committed.
- **Generated/ephemeral state**: analyses, drift, history, diff, ui-state,
  caches, latest baselines → server-side, our store.

---

## Locked decisions

1. **Unified `@truecourse/ee-db`.** One Postgres schema, **one migrations
   history, one `migrate()` at boot, one connection pool** — with per-feature
   `schema.ts` files for code-level separation. Fold the existing
   `ee/packages/github-app/drizzle` and `ee/packages/server/drizzle` into it.
   This removes the current two-folder problem (two migrators sharing the default
   `drizzle.__drizzle_migrations` ledger → a fresh-DB deploy can silently skip a
   package's migrations because Drizzle advances a single timestamp watermark).
2. **Neutral repo identity.** A `repos` table — `repo_id` PK, `workspace_org_id`,
   nullable `repo_full_name` (GitHub) / source handle — is the key everything FKs
   to. `gh_repos`' identity role and the global `registry.json` collapse into it.
   Core stores take this identity, not a `repoPath`.
3. **Repo read-only.** Remove the GitHub App's commit-back; store generated
   contracts/specs server-side; the PR comment links to them (viewable in the
   dashboard) instead of pushing a git diff.
4. **Adapter seam in core.** Each store becomes an interface; today's file/git
   functions are the default impl (OSS). EE injects Postgres + Blob impls,
   selected by `DATABASE_URL` / `BLOB_STORE`.
5. **Blob storage = `BlobStore` interface**, adapters from day one:
   `azure` (native, managed identity), `s3` (S3 protocol — AWS/MinIO/R2/on-prem),
   `postgres` (`bytea`), `fs` (local/OSS). Cloud-agnostic; Azure-first.
6. **Two backends by data shape.** Relational metadata → Postgres. Bulky content
   (contract corpora, spec snapshots, large analysis snapshots, caches) →
   `BlobStore`, content-addressed.
7. **Caches are load-bearing.** Without committed contracts, every verify needs
   them generated; the content-addressed cache is what makes unchanged code cheap.

---

## Storage model

### Postgres (`ee-db`) — relational metadata

Core / shared tables unprefixed; `gh_` = GitHub gate; `llm_` = LLM.

| Table | Key | Replaces / holds |
|---|---|---|
| `repos` | `repo_id` PK; unique `(workspace_org_id, repo_full_name)` | neutral identity + `default_branch`, `last_analyzed_at`; subsumes `gh_repos` identity + `registry.json` |
| `analyses` | `analysis_id` PK, `repo_id` FK | analysis index (blob ref → snapshot) |
| `analysis_latest` | `repo_id` PK | current snapshot + diff (refs to blobs) |
| `analysis_history` | `repo_id` FK, `analysis_id` | `history.json` rows |
| `verify_runs` | `run_id` PK, `repo_id` FK | drift run index (blob ref) |
| `verify_latest` | `repo_id` PK | current verify snapshot + diff (refs) |
| `verify_history` | `repo_id` FK, `run_id` | `verifier/history.json` rows |
| `repo_config` | `repo_id` PK | `config.json` |
| `repo_ui_state` | `repo_id` PK | `ui-state.json` |
| `contract_sets` | `(repo_id, commit_sha)` | index of a generated contract corpus (blob ref + content hash) |
| `spec_sets` | `(repo_id, commit_sha)` | index of a generated spec snapshot (blob ref + content hash) |
| `extraction_cache` | `(repo_id, cache_name, cache_key)` | the `.cache/` LLM-stage caches (small values inline; large → blob ref) |
| `gh_installations` | as-is | GitHub installations |
| `gh_repo_settings` | `repo_id` PK | renamed from `gh_repos`: gate config (`installation_id`, `blocking`, `enabled`, `notify_emails`) |
| `gh_baselines` | `repo_id` | gate baseline drift (`GateDrift[]`) — kept separate from `verify_latest` (different shape) for now |
| `gh_runs` | `id` PK, `repo_id` FK | per-PR gate run summaries |
| `llm_provider_config` | as-is | LLM provider (encrypted key) |

Large snapshots/corpora are stored as **blob refs**, not inline `jsonb`, so the
DB stays lean (the blob lives in `BlobStore`). Small records stay inline.

### `BlobStore` — bulky content (content-addressed)

```
interface BlobStore {
  put(key: string, bytes: Buffer, contentType?: string): Promise<void>
  get(key: string): Promise<Buffer | null>
  delete(key: string): Promise<void>
  exists(key: string): Promise<boolean>
}
```

Keys: `<workspace>/<repo_id>/<kind>/<contentHashOrCommit>`. Adapters
(`BLOB_STORE`):

| value | impl | for |
|---|---|---|
| `azure` | `@azure/storage-blob` + `@azure/identity` (managed identity / conn string) | **Azure hosting (default)** |
| `s3` | `@aws-sdk/client-s3` (configurable endpoint) | AWS, MinIO/on-prem, R2, B2… |
| `postgres` | `bytea` / large object | minimal Postgres-only deploy |
| `fs` | filesystem | local / OSS |

---

## Architecture & seams

- **Core (OSS)** defines the interfaces and the **file/git default impls**:
  `AnalysisStore`, `VerifyStore`, `RepoConfigStore`, `UiStateStore`,
  `RegistryStore`, `ContractStore`, `SpecStore`, `ExtractionCache`, `BlobStore`,
  and an `AnalyzeLock` (file O_EXCL default). A `selectStores(config)` returns the
  file impls when no `DATABASE_URL`.
- **EE** provides Postgres + Blob impls (in `ee-db` / a new `ee/packages/storage`)
  and injects them via the existing plugin seam (like `setLlmTransport` /
  `GateStore`). OSS never imports them → enforced by the import-boundary test
  (extend it for `@azure/*`, `@aws-sdk/*`).
- **Repo identity threading.** Replace the `repoPath: string` parameter through
  the stores with a `RepoRef` (workspace + repo_id). The file adapter maps a
  `RepoRef` back to a path (current behaviour); the EE adapter maps it to rows.
  This is the largest refactor (touches core pipeline, CLI, dashboard server).
- **Lock.** `.analyze.lock` (single host) → `pg_advisory_lock` keyed by repo_id
  for the EE adapter.

---

## Build phases

1. **`ee-db` consolidation. ✅ DONE.** New `@truecourse/ee-db`: one schema
   (per-feature files `schema/{github,llm}.ts`), one migration
   (`drizzle/0000_*.sql`, all 5 tables), one `createEeDb` (pool + migrate).
   `PostgresGateStore` + `LlmConfigStore` rewired onto the shared db;
   `ee-server` creates one ee-db and hands it to both. The two separate drizzle
   folders + per-package pools/migrate are gone → **watermark bug eliminated.**
   *(Deferred to Phase 2: the `repos` identity table + re-keying `gh_*` to
   `repo_id` — coupled to the `RepoRef` work.)* Build 15/15; suite 4321/4324
   (only the 3 pre-existing analyzer failures).
2. **Core adapter seam.** Define the store interfaces + file default impls;
   introduce `RepoRef` and thread it (replace `repoPath`). OSS stays green.

   **Execution notes (scouted — do this as a dedicated, careful pass):**
   - **The seam interface MUST be async.** A Postgres impl can't be sync, and the
     "materialise Postgres → temp `.truecourse/` → run" alternative is ruled out
     because it breaks multi-container hosting (a write on container A isn't seen
     by container B's temp fs) — the very reason we're leaving the filesystem.
   - **Shape (validated to compile):** `interface AnalysisStore` with async
     methods mirroring the current functions; `class FileAnalysisStore` wrapping
     today's sync `fs` logic (keeps the LATEST mtime cache); a module-level
     `get/setAnalysisStore` registry; the public functions become async
     delegators of the same name. Path helpers (`latestPath`, …) stay sync,
     file-only. Same pattern for `verify-store`, then config/ui-state.
   - **Do it store-by-store, each to green** (analysis-store first, then
     verify-store) — the whole build only goes green once *all* consumers of a
     store are converted, so you can't partially checkpoint within one store.
   - **Call sites (analysis-store):** `commands/{analyze-core,analyze-in-process,
     analyze-persist}.ts`, `services/{flow,violation-query,analytics}.ts`,
     and dashboard routes `routes/{analyses,files,graph,violations,verify}.ts`,
     plus CLI `commands/{hooks,drifts}.ts`. ~14 files; the conversion cascades
     (functions that call the store become async → their callers need `await`).
   - **GOTCHA — the compiler is necessary but NOT sufficient.** `tsc` flags every
     missed `await` on a **read** (a `Promise` used as a value), but a missed
     `await` on a **void-returning write** (`writeLatest`, `appendHistory`,
     `writeAnalysis`, `delete*`, `writeDiff`) is NOT a type error — it silently
     becomes a fire-and-forget write. After the tsc-guided pass, **grep every
     write call and verify each has `await`**, then run the full suite.
   - **SECOND GOTCHA (found the hard way).** A missed `await` on a **read** is
     ALSO invisible to tsc when the Promise flows into an `any`-typed sink —
     classically `res.json(readX(...))` or `const x = readX(...); if (!x) {...};
     res.json(x)`. `res.json` takes `any`, so the Promise serialises to `{}` and
     `if (!promise)` is dead code. Neither tsc nor the write-grep catches it.
     **After conversion, grep `res.json(`/`res.send(` for inline async reads AND
     scan for `if (!x)` truthiness checks on un-awaited reads.** (This bit the
     verify routes — they weren't in the analysis-store consumer set.)

   **STATUS — ✅ analysis-store + verify-store async seams DONE.** Both stores now
   `AnalysisStore`/`VerifyStore` interfaces + `File*Store` default + `get/set`
   registry + async delegators; all ~17 consumer files across core / dashboard /
   ee-server / CLI converted (reads tsc-guided, writes + `res.json` reads
   hand-audited), all test files converted. Build 15/15; suite 4321/4324 (only the
   3 pre-existing analyzer failures); exhaustive write-await audit clean.
   *Still in Phase 2 scope but DEFERRED: config/ui-state/registry seams move to
   Phase 5; the `repos` identity table + `repoPath → RepoRef` rename fold into
   Phase 4 (when the EE Postgres adapter actually needs the identity).*
3. **`BlobStore`** interface + 4 adapters (azure/s3/postgres/fs) in EE; config +
   managed-identity auth. **✅ DONE.** New `@truecourse/ee-storage`: `BlobStore`
   (put/get/delete/exists) + `FsBlobStore`, `PostgresBlobStore` (ee-db `blobs`
   bytea table, migration 0001), `S3BlobStore` (`@aws-sdk/client-s3`, endpoint-
   configurable → AWS/MinIO/R2), `AzureBlobStore` (`@azure/storage-blob` +
   `@azure/identity` managed identity). `selectBlobStore(config, db?)` +
   `loadBlobStoreConfig()` (env, default postgres). Arch-boundary test extended
   (OSS may not import `@azure/*`/`@aws-sdk/*`). Tests: fs + postgres round-trips
   (binary-safe) + selection (13 green). `.env.example` updated. NOT yet wired
   into a consumer — Phase 4 uses it.
4. **Analysis + drift → Postgres + Blob.** The big data path: `analysis-store` /
   `verify-store` EE adapters (metadata rows + blob snapshots), advisory lock.
   **✅ DONE.** New `@truecourse/ee-data-store` (`PgBlobAnalysisStore`,
   `PgBlobVerifyStore`) implementing core's `AnalysisStore`/`VerifyStore`:
   snapshots (`latest`/`diff`/per-analysis/per-run) → `BlobStore` at
   `<repo>/…` keys (`keys.ts`, repo-key percent-encoded into one segment so it
   can't escape its prefix); the queryable bits → ee-db. New tables in ee-db
   (migration `0002`, keyed by opaque `repo_key` text — no `repos` table yet):
   `analyses` + `verify_runs` (the listing/find index, PK `(repo_key,filename)`)
   and `analysis_history` + `verify_history` (append-only, `bigserial` id =
   insertion order, `entry` jsonb). `appendHistory` is now a single INSERT (the
   file impl's read-modify-write of one JSON file was the race we removed);
   `deleteVerifyRun` re-materializes LATEST to the newest remaining run, mirroring
   the file impl. core now exports `./lib/verify-store`. Tests: pglite + a real
   `FsBlobStore`, full-interface round-trips incl. per-repo scoping, newest-id
   resolution, and the three `deleteVerifyRun` LATEST cases (10 green). NOT yet
   wired into ee-server (Phase 8). *Advisory lock is NOT in the store interface —
   the `.analyze.lock` (O_EXCL) seam is separate; its `pg_advisory_lock`
   equivalent folds into Phase 8 wiring.*
5. **Config / ui-state / registry → Postgres. ✅ DONE.** Converted core's
   `config/project-config.ts`, `config/ui-state.ts`, and `config/registry.ts`
   into async seams (interface + `File*Store` default + `get/set/reset` registry
   + async delegators), same pattern as the analyze/verify stores. `RegistryStore`
   puts its *whole* public API on the interface (not just read/write) because the
   file impl is filesystem-coupled (`path.resolve`, `ensureRepoTruecourseDir`, a
   `.truecourse/`-exists liveness check) and the EE impl must replace that with
   row ops. Signatures kept as `string` keys (no `RepoRef` rename) — purely
   sync→async. Converted every consumer to `await`: core (`analyze-core`,
   `analyze-persist`, `rules`/`violation-query` services, `current-project`),
   the CLI (`add`, `analyze`, `dashboard`, `helpers.requireRegisteredRepo`,
   `rules`, `hooks`, `list`), all ~10 dashboard route files (`resolveProjectForRequest`
   ×56, plus `repos`/`graph`/`violations`/`analyses`/`analytics.service`),
   `middleware/project.ts`, and ee-server `workspace.ts`; plus the test helper
   `tests/helpers/test-db.ts` and the direct-call tests. New ee-db tables
   (migration `0003`): `repo_config` + `repo_ui_state` (inline `jsonb`, PK
   `repo_key`) and `registry` (PK `slug`, unique `path`, `created_at` for
   insertion order; `last_opened`/`last_analyzed` are **text** not `timestamptz`
   so the exact ISO string round-trips like the file impl — a `timestamptz`
   reformats `…T…Z` → `… …+00`). EE adapters in `@truecourse/ee-data-store`
   (`PgRepoConfigStore`, `PgUiStateStore`, `PgRegistryStore`): the registry
   adapter drops the filesystem behaviour (no `.truecourse/` dir; `pruneStaleProjects`
   is a no-op returning all rows; `registerProject` does no fs side effects) and
   reuses core's exported `slugify`. Tests: pglite round-trips for all three (18
   green). Full suite 4349/4352 (only the 3 pre-existing analyzer failures);
   import-boundary green. NOT yet wired into ee-server (Phase 8).
6. **Contracts / specs server-side + remove commit-back. ✅ DONE.** Full design
   + build in [`EE_PHASE6_DESIGN.md`](EE_PHASE6_DESIGN.md). Core `ContractStore`
   (directory-oriented, content-addressed in EE) + `SpecStore` (JSON) seams with
   no-op file defaults — `verifyInProcess` sources contracts via `loadContracts`,
   generate/scan/infer ingest only when an explicit `ref` is passed (OSS
   byte-identical; 46-test parity gate green). EE: `@truecourse/ee-data-store`
   `PgBlobContractStore` (one immutable blob per unique `.tc`, deduped across
   commits, intra-save dedup; manifest jsonb) + `PgSpecStore`; `contract_sets` /
   `spec_sets` (migration 0004); `safeJoin`/`assertSafeRel` path guards;
   `BlobStore.list` added for GC; `contract-gc.ts` mark-sweep. GitHub App:
   commit-back REMOVED — `spec-scan`/`infer-scan` persist server-side (no
   `git push`); the gate's `driftsForCommit` sources warm-from-store /
   cold-generate-on-checkout / null-neutral, with gen/verify FAILURES propagating
   to the error Check (never silently neutral); comments/emails link to the
   dashboard. 5-dimension adversarial review → 5 findings fixed (2 HIGH gate
   neutral-vs-failure conflations, 1 MEDIUM dedup count, 1 LOW docs). Suite
   4366 passing (only the 3 pre-existing analyzer failures); build 17/17. NOT yet
   wired into ee-server (Phase 8: `setContractStore`/`setSpecStore` install, GC
   schedule, temp-dir startup sweeper). Deferred within Phase 6: decisions-mutation
   async (dashboard spec-edit routes), dashboard-link hyperlink (needs `appUrl`
   threading), server-side fork-PR support.
7. **Caches → `extraction_cache`** (load-bearing; content-addressed). **✅ DONE.**
   The LLM-stage caches (per-slice extraction results, per-block extractions)
   moved behind a `KvCacheStore` seam in `@truecourse/llm` (both IL packages —
   `contract-extractor`, `spec-consolidator` — depend on it directly; the seam
   can't live in core, which they don't import). `FileKvCacheStore` default
   writes the exact same `.truecourse/.cache/<extractor/slices|consolidator/blocks>/<id>.json`
   files (OSS byte-identical; IL integration tests confirm). `readSliceEntry`/
   `writeSliceEntry`/`readBlockCache`/`writeBlockCache` went async + delegate
   (prompt-fingerprint self-invalidation preserved in the entry value); the two
   call sites (`generateContracts` slice loop, the block runner) were awaited.
   manifest/gc/scan-state stay file-based (harmless no-ops on the discarded EE
   clone). EE adapter `PgKvCacheStore` + `extraction_cache` (migration 0005):
   keyed **globally** by `(cache_name, cache_key)` (ignores the clone path) —
   deviates from the planned `(repo_id, …)` because the keys are content hashes
   and the deploy is single-tenant self-hosted, so a global table MAXIMIZES hits
   (identical spec content across the enterprise's repos → one entry, one LLM
   call) and serving a hit is safe (the value is the extraction of the very
   content the key hashes). Tests: file-impl scope isolation + Pg global keying/
   upsert/namespacing (12 green). Focused adversarial review: clean across OSS
   parity, invalidation, async ripple, EE correctness, boundaries. Suite 4368
   passing (only the 3 pre-existing analyzer failures); build 17/17. NOT yet
   wired into ee-server (Phase 8: `setKvCacheStore` install). scan-state EE
   storage deferred to Phase 8 (dashboard spec-UI wiring; it's "safe to delete"
   derived data, not load-bearing).
8. **Wiring + env + migrations + tests + adversarial review. ✅ DONE.**
   `ee/packages/server/src/storage.ts` `installEeStores(db)` swaps ALL EIGHT
   seams to their Pg/Blob impls in one place (analysis, verify, contract → Blob;
   spec, repo-config, ui-state, registry, kv-cache → inline Postgres), selecting
   the blob backend via `selectBlobStore(loadBlobStoreConfig(), db)`
   (`BLOB_STORE`, default postgres). Wired into `ee-server`'s `register()` after
   `createEeDb`, gated on `DATABASE_URL` — OSS never reaches it. Added a
   `sweepStaleTempDirs()` boot mop-up for leaked `tc-*` materialize/clone temp
   dirs (>1h). `.env.example` `DATABASE_URL` doc broadened (now switches EVERY
   store server-side + stops the commit-back); migrations auto-apply at boot.
   Tests: instanceof all 8 installed + a round-trip through Postgres + reset +
   the sweeper (4 green). Focused adversarial review: clean across install
   completeness (all 8, none orphaned; `setLlmTransport` correctly excluded —
   no Pg adapter), OSS-untouched gating, install order (no boot-time read races),
   blob selection, repo-key consistency across siblings, sweeper safety. Build
   17/17; suite 4372 passing (only the 3 pre-existing analyzer failures);
   import-boundary green.

## Follow-ups — hosted-dashboard data flow (✅ BUILT after the 8 phases)

The dashboard/GitHub-App consumers that still read/wrote the filesystem, plus the
"how does hosted EE get populated + triggered" gap, were then built:

- **Contracts browser → store.** `ContractStore` gained `listContractFiles` /
  `readContractFile` (file impl walks `.truecourse/contracts[/_inferred]` with a
  traversal guard; EE reads the LATEST stored set's manifest + blob). The
  dashboard `/contracts/{tree,file}` routes use the seam (authored + `_inferred/`
  merged). 3 tests (file + EE, traversal-safe).
- **Decision edits → store.** The 6 decision-mutation helpers
  (`upsertDecision`/`revokeDecision`/`addManual*`/`removeManual*`) went async and
  route through `SpecStore` (OSS = the IL file; EE = `spec_sets` per-repo
  "current" decisions under a `_repo` sentinel commit). Every dashboard + CLI
  caller awaited.
- **scan-state → store.** `SpecArtifact` gained `scanState` (file impl maps it to
  its existing `.cache/consolidator/scan-state.json`); `scanInProcess` ingests it
  under `ref`; the dashboard reads via `loadLatestSpec` (fails closed on a
  malformed payload).
- **PR comment dashboard links.** `appUrl` threaded into the scan/infer "done"
  comments; the link resolves the repo's ACTUAL registered slug
  (`getProjectByPath`) — not a recomputed `slugify` (collision-unsafe).
- **gh_repos + push→analyze.** `analyze-core` gained a `codeDir` override (code/
  git/lock/violation-pipeline use `codeDir`; storage keys off `project.path`), so
  the hosted edition analyzes a clone while storing under the repo identity.
  `runRepoAnalyze` (clone default branch → `registerProject(repoFullName,
  repoFullName)` → `analyzeInProcess({codeDir})`) is wired into `onBaseline`
  (merge to default), and `connect.ts` registers a linked repo immediately — so
  connected GitHub repos surface in the dashboard and analyze on merge. The
  `codeDir` code-vs-storage split is test-pinned.

Adversarial review of the batch: #1/#2/#3/#6 clean; one real #4 slug-collision
bug + one #3 validation nit, both fixed. Suite 4379 passing (only the 3
pre-existing analyzer failures); build 17/17.

### Follow-ups round 2 (✅ BUILT)

- **`pg_advisory_lock` analyze lock.** The `.analyze.lock` (O_EXCL fail-fast)
  became the `AnalyzeLock` seam (`packages/core/src/lib/analyze-lock.ts`; the
  default file impl moved out of `atomic-write.ts`, which re-exports for
  back-compat). The lock now keys off the STORAGE identity (`project.path`), not
  the clone dir — so in EE two analyses of the same repo serialize across
  separate clones (`acquire`/`release` are async; OSS still fail-fasts, EE
  WAITS). `acquireAnalyzeLock`/`releaseAnalyzeLock` in `analyze-core` are
  awaited. EE injects `PgAnalyzeLock` (`pg_advisory_lock(hashtext($1))` held on a
  dedicated pooled connection per key, unlocked + released on the SAME
  connection). **Deviations from review:** (a) the lock runs on its OWN pool
  (`EeDbHandle.lockPool`, `max:20`, `connectionTimeoutMillis`) — sharing the
  store pool would let held locks starve the store queries running inside those
  same analyses (deadlock); (b) a re-entrant `acquire` of a held key throws
  (a second session would self-deadlock); (c) an unlock-query failure destroys
  the connection (`release(err)`) rather than return a suspect one.
- **Gate neutral + email on unresolved spec conflicts (#1, option a).** Kept the
  existing high-confidence auto-resolve; added NO new auto-resolution. When a
  PR head's scan leaves open conflicts (auto-defaulted), the gate must not trust
  the guessed spec: `SpecScanPipeline.scan` now returns `{openConflicts}`,
  `driftsForCommit` surfaces it (fresh on the cold path, **recovered from the
  persisted `scanState` on the warm path** so a cached conflicted spec can't
  silently re-trust), `runGateVerify` reports `headConflicts`, and `decideGate`
  short-circuits to neutral `unresolved-conflicts` (before the no-contracts /
  no-baseline checks). The gate handler then posts a "resolve in dashboard"
  comment + Check and emails `sendConflictsNeedResolution` to the notify list
  (deduped by the recorded head sha; never alongside a failure email). The
  scan-offer "done" comment also flags leftover conflicts. Base-side conflicts
  are ignored by design (the head's spec is the PR's doing).

Round-2 adversarial review: 1 HIGH (pool deadlock) + 1 MEDIUM (warm-path conflict
signal dropped) + 2 LOW, all fixed (above). Suite green except the 3 pre-existing
analyzer layer-classification failures; build 17/17.

### Still deferred (genuinely downstream / out of this scope)
- Fork-PR support (skipped by request).
- Feeding the user's *edited* decisions back into the gate's cold-generation
  (the gate cold-gen still uses auto-resolve; conflicts now pause the gate and
  ask a human, but resolved decisions aren't yet re-fed into regeneration).

---

## Env vars (EE)

- `DATABASE_URL` — Postgres (Azure Database for PostgreSQL; Entra token auth ok).
- `BLOB_STORE` — `azure | s3 | postgres | fs`.
- **Azure:** `AZURE_STORAGE_ACCOUNT` (+ container), managed identity by default;
  optional `AZURE_STORAGE_CONNECTION_STRING`.
- **S3:** `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`,
  `S3_SECRET_ACCESS_KEY` (MinIO/on-prem use the endpoint override).
- `TRUECOURSE_SECRET_KEY` — **required** (like `DATABASE_URL`): the AES key for
  the encrypted LLM-provider store. Missing/weak → boot fails (no CLI/.env
  provider fallback; the provider is set in-app via the Models page).
- (existing) `GITHUB_APP_*`.

---

## Open questions / risks

- **Verify semantics.** "Head vs head's contracts" is preserved by *generating +
  storing* head's contracts server-side per commit (instead of reading committed
  files). Confirm this matches the intended product behaviour for spec-changing
  PRs.
- **Cost.** No committed contracts ⇒ the cache is the only thing preventing
  re-LLM on every run. Cache correctness/keying is now critical.
- **The `repoPath → RepoRef` refactor** touches many call sites across core, CLI,
  and the dashboard server — the riskiest part.
- **Data migration** of existing local `.truecourse/` data into Postgres/Blob is
  out of scope for v1 (fresh hosted deploys); revisit if needed.

## Out of scope
- OSS / local edition — stays file + git, unchanged.
- Logs — remain stdout/stderr (not data; not stored in Postgres/Blob).
