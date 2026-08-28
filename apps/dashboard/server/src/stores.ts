/**
 * Install the Postgres storage adapters. This is where core's storage seams
 * (file/git defaults, built for a persistent checkout) are swapped for the
 * `@truecourse/data-store` Postgres impls, so the whole pipeline — analyses,
 * per-repo config, ui-state, the project registry, specs, guard state, and the
 * LLM-stage caches — reads and writes the database instead of a repo's
 * `.truecourse/` tree. The working tree becomes an ephemeral per-run clone
 * (see services/run-clone.service.ts).
 *
 * Called once at boot, right after the migrations run. The CLI never calls
 * this — `truecourse analyze` in a local checkout keeps the file stores.
 */

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
import { setSessionsRootResolver } from '@truecourse/core/lib/sessions-store';
import { getGlobalDir } from '@truecourse/core/config/paths';
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
  PgAnalyzeLock,
} from '@truecourse/data-store';
import { repoDirName } from './services/run-clone.service.js';

/** Swap every core/llm storage seam for its Postgres impl. */
export function installDbStores({ db, lockPool }: DbHandle): void {
  setAnalysisStore(new PgAnalysisStore(db));
  setSpecStore(new PgSpecStore(db));
  // Guard run store + scenario corpus + dismissedClaims decisions.
  setGuardStore(new PgGuardStore(db));
  // The dismiss/promote overlay for inferred decisions.
  setInferredActionStore(new PgInferredActionStore(db));
  setRepoConfigStore(new PgRepoConfigStore(db));
  setUiStateStore(new PgUiStateStore(db));
  // The "registry" is a derived view of gh_repos — no separate table, so it
  // can't drift or orphan (slug routing resolves only connected repos).
  setRegistryStore(new GhReposRegistryStore(db));
  // Content-addressed LLM-stage cache → Postgres. This is what keeps re-runs
  // cheap now that every run's clone (and any file cache in it) is discarded.
  setKvCacheStore(new PgKvCacheStore(db));
  // Cross-process analyze serialization → session-level `pg_advisory_lock` on a
  // DEDICATED pool (a lockfile on a throwaway clone can't serialize two runs of
  // the same repo; the dedicated pool keeps held locks from starving the store
  // pool).
  setAnalyzeLock(new PgAnalyzeLock(lockPool));

  // Session transcripts are the one store still on disk (they are an append
  // stream the run watcher tails). Key them by repo IDENTITY under the global
  // dir so they survive the ephemeral clone; an absolute key is a real local
  // path (tests, file-mode tools sharing the process) and keeps the in-tree
  // default.
  setSessionsRootResolver((repoDirOrKey) =>
    path.isAbsolute(repoDirOrKey)
      ? path.join(repoDirOrKey, '.truecourse', 'sessions')
      : path.join(getGlobalDir(), 'sessions', repoDirName(repoDirOrKey)),
  );

  log.info('[Server] Postgres stores installed');
}
