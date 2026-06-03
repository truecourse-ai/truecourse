/**
 * Install the hosted-edition storage adapters. This is where the open-core
 * seams (file/git by default in OSS) are swapped for the Postgres + Blob impls
 * so the whole pipeline — analyses, drift, per-repo config, ui-state, the
 * project registry, contracts, specs, and the LLM-stage caches — reads and
 * writes server-side instead of the customer's `.truecourse/` tree.
 *
 * Called once at boot when `DATABASE_URL` is set (the shared `ee-db`). The blob
 * backend is selected from `BLOB_STORE` (azure | s3 | postgres | fs).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { EeDbHandle } from '@truecourse/ee-db';
import { log } from '@truecourse/core/lib/logger';
import { setAnalysisStore } from '@truecourse/core/lib/analysis-store';
import { setVerifyStore } from '@truecourse/core/lib/verify-store';
import { setContractStore } from '@truecourse/core/lib/contract-store';
import { setSpecStore } from '@truecourse/core/lib/spec-store';
import { setRepoConfigStore } from '@truecourse/core/config/project-config';
import { setUiStateStore } from '@truecourse/core/config/ui-state';
import { setRegistryStore } from '@truecourse/core/config/registry';
import { setAnalyzeLock } from '@truecourse/core/lib/analyze-lock';
import { setKvCacheStore } from '@truecourse/llm';
import { loadBlobStoreConfig, selectBlobStore } from '@truecourse/ee-storage';
import {
  PgBlobAnalysisStore,
  PgBlobVerifyStore,
  PgBlobContractStore,
  PgSpecStore,
  PgRepoConfigStore,
  PgUiStateStore,
  PgRegistryStore,
  PgKvCacheStore,
  PgAnalyzeLock,
} from '@truecourse/ee-data-store';

/** Swap every core/llm storage seam for its Postgres/Blob hosted impl. */
export function installEeStores({ db, lockPool }: EeDbHandle): void {
  const blobConfig = loadBlobStoreConfig();
  const blob = selectBlobStore(blobConfig, db);

  // Bulky snapshots/corpora/objects → BlobStore; metadata + manifests → Postgres.
  setAnalysisStore(new PgBlobAnalysisStore(db, blob));
  setVerifyStore(new PgBlobVerifyStore(db, blob));
  setContractStore(new PgBlobContractStore(db, blob));
  // Small/queryable records → inline Postgres.
  setSpecStore(new PgSpecStore(db));
  setRepoConfigStore(new PgRepoConfigStore(db));
  setUiStateStore(new PgUiStateStore(db));
  setRegistryStore(new PgRegistryStore(db));
  // Content-addressed LLM-stage cache (global) → Postgres.
  setKvCacheStore(new PgKvCacheStore(db));
  // Cross-process analyze serialization → session-level `pg_advisory_lock` on a
  // DEDICATED pool (the file lockfile can't coordinate analyses on separate
  // clones; the dedicated pool keeps held locks from starving the store pool).
  setAnalyzeLock(new PgAnalyzeLock(lockPool));

  log.info(`[ee-server] hosted storage installed (blob=${blobConfig.kind})`);
}

// Prefixes our materialize/clone temp dirs use: loadContracts → `tc-<kind>-`
// (contracts / contracts_inferred); the gate runners → `tc-gate-*`.
const TEMP_PREFIXES = ['tc-contracts-', 'tc-contracts_inferred-', 'tc-gate-'];
const STALE_MS = 60 * 60 * 1000; // 1 hour

/**
 * Remove leftover materialization/clone temp dirs from a previous run. A
 * crash between mkdtemp and cleanup would otherwise leak disk on a long-lived
 * worker; the materialize/clone paths name their temp dirs `tc-*`, and an
 * hour is far longer than any single verify/generate.
 */
export function sweepStaleTempDirs(now = Date.now(), dir = os.tmpdir()): number {
  let removed = 0;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (!TEMP_PREFIXES.some((p) => e.name.startsWith(p))) continue;
    const full = path.join(dir, e.name);
    try {
      if (now - fs.statSync(full).mtimeMs < STALE_MS) continue;
      fs.rmSync(full, { recursive: true, force: true });
      removed += 1;
    } catch {
      // best-effort
    }
  }
  if (removed > 0) log.info(`[ee-server] swept ${removed} stale temp dir(s)`);
  return removed;
}
