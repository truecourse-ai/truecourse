/**
 * Install the hosted-edition storage adapters. This is where the open-core
 * seams (file/git by default) are swapped for the Postgres impls so the whole
 * pipeline — the project registry, specs, guard state and the LLM-stage caches
 * — reads and writes server-side instead of the customer's `.truecourse/` tree.
 *
 * Called once at boot when `DATABASE_URL` is set (the shared `db`).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DbHandle } from '@truecourse/db';
import { log } from '@truecourse/core/lib/logger';
import { setSpecStore } from '@truecourse/core/lib/spec-store';
import { setGuardStore } from '@truecourse/core/lib/guard-store';
import { setRegistryStore } from '@truecourse/core/config/registry';
import { setKvCacheStore } from '@truecourse/llm';
import {
  PgSpecStore,
  PgGuardStore,
  GhReposRegistryStore,
  PgKvCacheStore,
} from '@truecourse/ee-data-store';

/** Swap every core/llm storage seam for its Postgres hosted impl. */
export function installEeStores({ db }: DbHandle): void {
  // All hosted content lives in Postgres — bulky bodies (spec artifacts) are
  // content-addressed in the `content` table; metadata + manifests are their
  // own rows. No blob store.
  setSpecStore(new PgSpecStore(db));
  // Guard run store + committable scenario corpus + dismissedClaims decisions.
  setGuardStore(new PgGuardStore(db));
  // The "registry" is a derived view of the gate's gh_repos — no separate table,
  // so it can't drift or orphan (slug routing resolves only connected repos).
  setRegistryStore(new GhReposRegistryStore(db));
  // Content-addressed LLM-stage cache (global) → Postgres.
  setKvCacheStore(new PgKvCacheStore(db));

  log.info('[ee-server] hosted storage installed (Postgres)');
}

// Prefix every materialize/clone temp dir uses (`tc-gate-*`, `tc-guard-*`,
// `tc-ws-*`, ...). Matching the shared `tc-` stem keeps the sweep covering new
// runners automatically — the guard-side prefixes were silently missed when
// this listed `tc-gate-` alone.
const TEMP_PREFIXES = ['tc-'];
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
