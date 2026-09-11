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
import { loadSpecDoc, loadWorkspaceSpecDoc, setSpecStore } from '@truecourse/core/lib/spec-store';
import { isContextDocRef } from '@truecourse/core/lib/context-ref';
import { readContextDocByRef } from '@truecourse/core/lib/context-store';
import { setRepoDocReader, type RepoDocReader } from '@truecourse/core/lib/repo-doc-reader';
import { setGuardStore } from '@truecourse/core/lib/guard-store';
import { setGuardOverlayStore } from '@truecourse/core/lib/guard-overlays';
import { setContextStore } from '@truecourse/core/lib/context-store';
import { setInferredActionStore } from '@truecourse/core/lib/inferred-action-store';
import { setRepoConfigStore } from '@truecourse/core/config/project-config';
import { setUiStateStore } from '@truecourse/core/config/ui-state';
import { setRegistryStore } from '@truecourse/core/config/registry';
import { setAnalyzeLock } from '@truecourse/core/lib/analyze-lock';
import { setSessionsRootResolver, setSessionRunBackend } from '@truecourse/core/lib/sessions-store';
import { getGlobalDir } from '@truecourse/core/config/paths';
import { setKvCacheStore } from '@truecourse/llm';
import {
  PgSessionRunStore,
  PgAnalysisStore,
  PgSpecStore,
  PgContextStore,
  PgGuardStore,
  PgGuardOverlayStore,
  PgInferredActionStore,
  PgRepoConfigStore,
  PgUiStateStore,
  GhReposRegistryStore,
  PgKvCacheStore,
  PgLlmConfigStore,
  PgAnalyzeLock,
  purgeRepoData,
} from '@truecourse/data-store';
import { setShowResolvedStageModel, setShowStageUsage } from '@truecourse/core/commands/spec-in-process';
import { setWorkspaceLlmConfigStore } from './services/workspace-llm.service.js';
import { repoDirName } from './services/run-clone.service.js';
import { setRepoDataPurge } from './services/repo-removal.service.js';

export interface InstallDbStoresOptions {
  /** Master secret the workspace's provider key is encrypted with (32+ chars). */
  masterSecret: string;
}

/**
 * One document's body, however it is addressed.
 *
 * A `context/<sourceId>/<docPath>` ref is a WORKSPACE document — the workspace
 * corpus names it, and no repository holds it — so it is read from the context
 * store (the live body) and, when a source has stopped yielding it, from the
 * scan's own snapshot, which is what keeps a document readable after it is
 * gone. The workspace a ref belongs to is the one that has it: a ref names no
 * workspace of its own, and a reader that was handed a repository key is asking
 * on behalf of a repository whose workspace is resolved here.
 *
 * Every other ref is a repository document, read from the scan snapshot that
 * kept it (a pinned commit reads that commit's).
 */
export const readStoredRepoDoc: RepoDocReader = async (repoKey, docPath, opts) =>
  isContextDocRef(docPath)
    ? readWorkspaceDoc(repoKey, docPath)
    : loadSpecDoc(repoKey, docPath, opts?.commit);

/**
 * A workspace document, read through the workspace that reads `repoKey`. The
 * repo→workspace lookup is installed at boot with the GitHub link store; with
 * none installed (a test app, a server with no App configured) there is no
 * workspace to resolve and the ref answers absent.
 */
async function readWorkspaceDoc(repoKey: string, ref: string): Promise<string | null> {
  const org = await workspaceOfRepo(repoKey);
  if (!org) return null;
  return (await readContextDocByRef(org, ref)) ?? (await loadWorkspaceSpecDoc(org, ref));
}

/** How a repository key resolves to the workspace whose Context it reads. */
export type RepoWorkspaceLookup = (repoKey: string) => Promise<string | null>;

let repoWorkspace: RepoWorkspaceLookup | null = null;

/** Install the repo→workspace lookup (boot: the GitHub link store). */
export function setRepoWorkspaceLookup(lookup: RepoWorkspaceLookup | null): void {
  repoWorkspace = lookup;
}

async function workspaceOfRepo(repoKey: string): Promise<string | null> {
  if (!repoWorkspace) return null;
  try {
    return await repoWorkspace(repoKey);
  } catch (err) {
    log.warn(`[Server] could not resolve the workspace of ${repoKey}: ${(err as Error).message}`);
    return null;
  }
}

/** Swap every core/llm storage seam for its Postgres impl. */
export function installDbStores(
  { db, lockPool }: DbHandle,
  { masterSecret }: InstallDbStoresOptions,
): void {
  setAnalysisStore(new PgAnalysisStore(db));
  setSpecStore(new PgSpecStore(db));
  // The workspace's CONTEXT: its documentation sources, the documents they
  // yielded (bodies content-addressed under `context:ws:<org>`), the syncs and
  // the repositories that read them. Hosted only — a CLI checkout is one
  // repository with a tree of its own and reaches no workspace store.
  setContextStore(new PgContextStore(db));
  // A document body is read from the scan's snapshot, never from a tree: the
  // doc page, the coverage join and the spec reads all go through this seam,
  // and a connected repository has no working tree to read from. The commit
  // pins a snapshot (a PR view); without one the newest scan answers. A
  // `context/` ref is the workspace's and is read from the context store.
  setRepoDocReader(readStoredRepoDoc);
  // Guard run store + scenario corpus + dismissedClaims decisions.
  setGuardStore(new PgGuardStore(db));
  // The supplied-dependency overlays (registered API keys, base URLs, tokens):
  // one encrypted row per repo, decrypted only into a run's ephemeral clone.
  setGuardOverlayStore(new PgGuardOverlayStore(db, masterSecret));
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
  // The workspace's LLM provider, encrypted at rest. Not a core seam: nothing
  // in the pipeline reads a provider by itself — the routes load the asking
  // workspace's and thread it into the run.
  setWorkspaceLlmConfigStore(new PgLlmConfigStore(db, masterSecret));
  // Each workspace names ONE model, and its transport ignores the per-stage
  // hint, so the per-stage tiers the OSS progress lines show would be a lie.
  setShowResolvedStageModel(false);
  setShowStageUsage(false);

  // Cross-process analyze serialization → session-level `pg_advisory_lock` on a
  // DEDICATED pool (a lockfile on a throwaway clone can't serialize two runs of
  // the same repo; the dedicated pool keeps held locks from starving the store
  // pool).
  setAnalyzeLock(new PgAnalyzeLock(lockPool));

  // Stable identities for stream subscriptions, provider scratch paths, and
  // importing pre-migration file histories. New dashboard history uses Postgres.
  setSessionsRootResolver((repoDirOrKey) =>
    path.isAbsolute(repoDirOrKey)
      ? path.join(repoDirOrKey, '.truecourse', 'sessions')
      : path.join(getGlobalDir(), 'sessions', repoDirName(repoDirOrKey)),
  );

  setSessionRunBackend(new PgSessionRunStore(db, lockPool));

  // Disconnecting a repo purges its per-repo rows (they key on the bare repo
  // key with no workspace column — left behind, the next workspace to connect
  // the same owner/repo would inherit them).
  setRepoDataPurge((repoKey) => purgeRepoData(db, repoKey));

  log.info('[Server] Postgres stores installed');
}
