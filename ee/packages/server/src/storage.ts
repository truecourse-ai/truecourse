/**
 * Install the hosted-edition storage adapters. This is where the open-core
 * seams (file/git by default in OSS) are swapped for the Postgres impls so the
 * whole pipeline — analyses, per-repo config, ui-state, the project registry,
 * specs, and the LLM-stage caches — reads and writes server-side instead of the
 * customer's `.truecourse/` tree.
 *
 * Called once at boot when `DATABASE_URL` is set (the shared `db`).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DbHandle } from '@truecourse/db';
import { log } from '@truecourse/core/lib/logger';
import { setAnalysisStore } from '@truecourse/core/lib/analysis-store';
import { setSpecStore } from '@truecourse/core/lib/spec-store';
import { setGuardStore } from '@truecourse/core/lib/guard-store';
import { setInferredActionStore } from '@truecourse/core/lib/inferred-action-store';
import { setRepoConfigStore } from '@truecourse/core/config/project-config';
import { setUiStateStore } from '@truecourse/core/config/ui-state';
import { setRegistryStore } from '@truecourse/core/config/registry';
import { setAnalyzeLock } from '@truecourse/core/lib/analyze-lock';
import { setKvCacheStore } from '@truecourse/llm';
import {
  PgAnalysisStore,
  PgSpecStore,
  PgGuardStore,
  PgInferredActionStore,
  PgRepoConfigStore,
  PgUiStateStore,
  GhReposRegistryStore,
  PgKvCacheStore,
  PgTraceStore,
  PgAnalyzeLock,
} from '@truecourse/ee-data-store';

/** What `installEeStores` hands back for the caller to wire (not a core seam). */
export interface EeStoreHandles {
  /** LLM trace sink — passed to the transport as its recorder + the traces routes. */
  traceStore: PgTraceStore;
}

/** Swap every core/llm storage seam for its Postgres/Blob hosted impl. */
export function installEeStores({ db, lockPool }: DbHandle): EeStoreHandles {
  // All hosted content lives in Postgres — bulky bodies (spec artifacts, trace
  // payloads) are content-addressed in the `content` table; metadata + manifests
  // are their own rows. No blob store.
  // Analyze ("Code Quality") snapshots — the EE baseline runs the OSS analyze pass
  // server-side and persists here (per-analysis + LATEST/diff + history as jsonb).
  setAnalysisStore(new PgAnalysisStore(db));
  setSpecStore(new PgSpecStore(db));
  // Guard run store + committable scenario corpus + dismissedClaims decisions.
  setGuardStore(new PgGuardStore(db));
  // The dismiss/promote overlay for inferred decisions (shared dashboard logic).
  setInferredActionStore(new PgInferredActionStore(db));
  setRepoConfigStore(new PgRepoConfigStore(db));
  setUiStateStore(new PgUiStateStore(db));
  // The "registry" is a derived view of the gate's gh_repos — no separate table,
  // so it can't drift or orphan (slug routing resolves only connected repos).
  setRegistryStore(new GhReposRegistryStore(db));
  // Content-addressed LLM-stage cache (global) → Postgres.
  setKvCacheStore(new PgKvCacheStore(db));
  // Cross-process analyze serialization → session-level `pg_advisory_lock` on a
  // DEDICATED pool (the file lockfile can't coordinate analyses on separate
  // clones; the dedicated pool keeps held locks from starving the store pool).
  setAnalyzeLock(new PgAnalyzeLock(lockPool));

  // LLM observability sink (metadata → Postgres, payloads → content). NOT a core
  // seam — it's handed to the transport as its recorder and to the traces routes,
  // so it's returned rather than installed globally.
  const traceStore = new PgTraceStore(db);

  log.info('[ee-server] hosted storage installed (Postgres)');
  return { traceStore };
}

// Prefixes our clone temp dirs use: the gate runners → `tc-gate-*`.
const TEMP_PREFIXES = ['tc-gate-'];
const STALE_MS = 60 * 60 * 1000; // 1 hour

/**
 * Remove leftover materialization/clone temp dirs from a previous run. A
 * crash between mkdtemp and cleanup would otherwise leak disk on a long-lived
 * worker; the materialize/clone paths name their temp dirs `tc-*`, and an
 * hour is far longer than any single gate run.
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
