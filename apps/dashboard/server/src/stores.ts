/**
 * Install the storage. Every one of core's store seams is filled here with its
 * `@truecourse/data-store` Postgres implementation, so the whole pipeline — the
 * repository registry, the specs, the workspace's context, the guard state, the
 * session runs and the LLM-stage caches — reads and writes the database. A run's
 * working tree is an ephemeral clone (see services/run-clone.service.ts) and
 * holds nothing durable.
 *
 * Called once at boot, right after the migrations run. Nothing is installed by
 * default, so a process that never ran this reads nothing rather than inventing
 * an empty store.
 */

import type { DbHandle } from '@truecourse/db';
import { log } from '@truecourse/core/lib/logger';
import { loadSpecDoc, loadWorkspaceSpecDoc, setSpecStore } from '@truecourse/core/lib/spec-store';
import { isContextDocRef } from '@truecourse/core/lib/context-ref';
import { readContextDocByRef } from '@truecourse/core/lib/context-store';
import { setRepoDocReader, type RepoDocReader } from '@truecourse/core/lib/repo-doc-reader';
import { setGuardStore } from '@truecourse/core/lib/guard-store';
import { setGuardOverlayStore } from '@truecourse/core/lib/guard-overlays';
import { setContextStore } from '@truecourse/core/lib/context-store';
import { setRegistryStore } from '@truecourse/core/config/registry';
import { setSessionRunBackend } from '@truecourse/core/lib/sessions-store';
import { setKvCacheStore } from '@truecourse/llm';
import {
  PgSessionRunStore,
  PgSpecStore,
  PgContextStore,
  PgGuardStore,
  PgGuardOverlayStore,
  RepositoriesRegistryStore,
  PgKvCacheStore,
  PgLlmConfigStore,
  purgeRepoData,
} from '@truecourse/data-store';
import { setShowResolvedStageModel, setShowStageUsage } from '@truecourse/core/commands/spec-in-process';
import { setWorkspaceLlmConfigStore } from './services/workspace-llm.service.js';
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

let sessionRuns: PgSessionRunStore | null = null;

/**
 * THE BOOT SWEEP over the runs: every run a dead process left `running` is
 * settled `interrupted`, its live sessions parked. The jobs queue settles its
 * own abandoned rows with the SAME word (`interruptOrphaned`), so a restart
 * reads as one event on both halves rather than a job that failed beside a run
 * that was interrupted.
 */
export async function reconcileStoredRuns(): Promise<void> {
  if (!sessionRuns) throw new Error('No session run store installed (boot did not run installDbStores).');
  await sessionRuns.reconcileAll();
}

/**
 * Every committed run-record write, whichever process made it. The server
 * relays these onto the workspace's live stream (`services/run-events.service`),
 * which is how a run with no repository room reaches the page watching it.
 */
export function subscribeSessionRunWrites(
  notify: (repoKey: string, runId: string) => void,
): () => void {
  if (!sessionRuns) throw new Error('No session run store installed (boot did not run installDbStores).');
  return sessionRuns.subscribeRuns(notify);
}

/** How a repository key resolves to the workspace whose Context it reads. */
export type RepoWorkspaceLookup = (repoKey: string) => Promise<string | null>;

let repoWorkspace: RepoWorkspaceLookup | null = null;

/** Install the repo→workspace lookup (boot: the GitHub link store). */
export function setRepoWorkspaceLookup(lookup: RepoWorkspaceLookup | null): void {
  repoWorkspace = lookup;
}

export async function workspaceOfRepo(repoKey: string): Promise<string | null> {
  if (!repoWorkspace) return null;
  try {
    return await repoWorkspace(repoKey);
  } catch (err) {
    log.warn(`[Server] could not resolve the workspace of ${repoKey}: ${(err as Error).message}`);
    return null;
  }
}

/** Fill every store seam with its Postgres implementation. */
export function installDbStores(
  { db, lockPool }: DbHandle,
  { masterSecret }: InstallDbStoresOptions,
): void {
  setSpecStore(new PgSpecStore(db));
  // The workspace's CONTEXT: its documentation sources, the documents they
  // yielded (bodies content-addressed under `context:ws:<org>`), the syncs and
  // the repositories that read them.
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
  // The "registry" is a derived view of the connected repositories — no
  // separate table, so it can't drift or orphan (slug routing resolves only
  // connected repos).
  setRegistryStore(new RepositoriesRegistryStore(db));
  // The content-addressed LLM-stage cache. This is what keeps re-runs cheap now
  // that every run's working tree is discarded when it settles.
  setKvCacheStore(new PgKvCacheStore(db));
  // The workspace's LLM provider, encrypted at rest. Not a core seam: nothing
  // in the pipeline reads a provider by itself — the routes load the asking
  // workspace's and thread it into the run.
  setWorkspaceLlmConfigStore(new PgLlmConfigStore(db, masterSecret));
  // Each workspace names ONE model, and its transport ignores the per-stage
  // hint, so rendering the per-stage tiers would be a lie.
  setShowResolvedStageModel(false);
  setShowStageUsage(false);

  sessionRuns = new PgSessionRunStore(db, lockPool);
  setSessionRunBackend(sessionRuns);

  // Disconnecting a repo purges its per-repo rows (they key on the bare repo
  // key with no workspace column — left behind, the next workspace to connect
  // the same owner/repo would inherit them).
  setRepoDataPurge((repoKey) => purgeRepoData(db, repoKey));

  log.info('[Server] Postgres stores installed');
}
