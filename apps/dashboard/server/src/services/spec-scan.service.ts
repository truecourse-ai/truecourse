/**
 * The spec-scan pipeline every caller runs: clone the repo into an ephemeral
 * per-run work tree (see work-tree.service.ts), curate against that tree,
 * persist the corpus to the server-side spec store keyed by
 * `(owner/repo, commit)`, and delete the clone — nothing durable ever lives in
 * a working copy.
 *
 * WHO CALLS IT. The `repo.scan` background job, and nothing else: a connect and
 * the Scan button both enqueue that job, so a scan is never inside the request
 * that asked for it and the queue's single-flight key is what keeps two of them
 * apart. Cancellation is the job's too — the `AbortSignal` threaded in here is
 * the one the harness trips when a repository is disconnected mid-scan.
 *
 * Progress reaches the client through the two channels the manual Scan already
 * used, so no new plumbing exists for it: the socket spec tracker
 * (`spec:progress` in the repo's room) and the sessions store's own `run.json`
 * — keyed by the repo IDENTITY, not the throwaway clone, so the repo's runs
 * watcher sees every write and the transcripts outlive the clone.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { RunError } from '@truecourse/agent-loop';
import type { CuratedCorpus } from '@truecourse/spec-consolidator';
import { log } from '@truecourse/core/lib/logger';
import { createSessionRun, openSessionRun } from '@truecourse/core/lib/sessions-store';
import { resolveCommitSha } from '@truecourse/core/lib/repo-ref';
import { saveSpec, saveSpecDocs, specsMaterializeInPlace } from '@truecourse/core/lib/spec-store';
import {
  curateInProcess,
  getDecisions,
  saveDecisions,
  type CurateInProcessOptions,
  type SpecCurateInProcessResult,
} from '@truecourse/core/commands/spec-in-process';
import { writeDecisions, resolveRepoIdentity } from '@truecourse/spec-consolidator';
import { acquireWorkTree } from './work-tree.service.js';

/**
 * What a caller threads into the shared pipeline: the progress tracker, the
 * cancellation signal, and the session driver built from the asking
 * workspace's provider — the run's credentials travel with it, never through a
 * process-wide default.
 */
export type StoredSpecScanOptions = Pick<
  CurateInProcessOptions,
  'tracker' | 'signal' | 'source' | 'onRunStarted' | 'driver' | 'transportMode'
>;

/**
 * The whole spec scan of a connected repository: acquire an ephemeral work
 * tree, curate against it, persist the corpus server-side under the tree's
 * commit, dispose the tree. The caller owns the provider check; this owns
 * everything between clone and store.
 *
 * Whatever goes wrong in here lands ON THE RUN RECORD before it is rethrown —
 * Activity shows runs, not this process's log, so a run that died with no
 * reason on it is a run nobody can explain.
 */
export async function runStoredSpecScan(
  repoKey: string,
  options: StoredSpecScanOptions = {},
): Promise<SpecCurateInProcessResult> {
  // The run curate creates, so a failure can be explained on it.
  let runId: string | null = null;
  const tree = await acquireWorkTree(repoKey);
  try {
    // The user's resolutions (relations / manual areas / includes) live in the
    // server store keyed by repoKey — NOT in this fresh clone. Load them and
    // fold them into curate, else a re-scan re-detects already-resolved
    // conflicts. Empty on the first (connect) scan.
    const decisions = await getDecisions(repoKey);
    // Persist them into the clone too, so a follow-on generate over this same
    // tree reads them from `decisions.json`. Transient: the clone is discarded.
    writeDecisions(tree.dir, decisions);
    // State who this repo IS to the relevance classifier — the tree is a clone
    // in a scratch-named temp dir, so resolving identity from it would offer
    // that scratch name as the product's identity.
    const repoIdentity = resolveRepoIdentity({ repoFullName: repoKey });
    const result = await curateInProcess(tree.dir, {
      // Fresh shallow checkout → skipGit (doc dating falls back to file mtime).
      skipGit: true,
      decisions,
      repoIdentity,
      sessionsKey: repoKey,
      ...options,
      onRunStarted: (info) => {
        runId = info.runId;
        options.onRunStarted?.(info);
      },
    });
    // The run wrote `corpus.json` into the (throwaway) tree; persist it under
    // the tree's commit so it outlives the clone. An in-place store already IS
    // the tree — nothing separate to persist.
    if (!specsMaterializeInPlace()) {
      const commitSha = await resolveCommitSha(tree.dir);
      await saveSpec({ repoKey, commitSha }, 'corpus', result.curate.corpus);
      // And the documents themselves, as the scan read them: the corpus names
      // them by path, and the clone that holds those paths is about to go.
      // Without this a hosted repository has a corpus and no way to open a
      // document in it.
      await saveSpecDocs({ repoKey, commitSha }, snapshotDocs(tree.dir, result.curate.corpus));
      // Same for the decisions the run produced: the scan folds auto scope
      // verdicts, standing instructions and auto-applied conflict resolutions
      // into the document it started from, then writes it into the clone —
      // which is about to be disposed. Without this, every re-scan re-pays the
      // scope orchestrator and auto-resolved conflicts reopen.
      await saveDecisions(repoKey, result.curate.decisions);
    }
    return result;
  } catch (err) {
    // A cancelled scan is not a failed one — it stopped because the caller said
    // so, and the record already says `interrupted`.
    if (runId && !options.signal?.aborted) {
      stampRunError(repoKey, runId, { message: messageOf(err) });
    }
    throw err;
  } finally {
    tree.dispose();
  }
}

/**
 * The kept documents' bodies, read out of the scan's tree by the refs the
 * corpus carries — repository docs and llms.txt source pages alike, since a
 * source ref is the snapshot's own repo-relative path. A ref that does not
 * resolve to a file inside the tree is skipped: the corpus still names it, and
 * a reader answers absent rather than the job failing over one document.
 */
export function snapshotDocs(treeDir: string, corpus: CuratedCorpus): Record<string, string> {
  const root = path.resolve(treeDir);
  const files: Record<string, string> = {};
  for (const doc of corpus.docs) {
    const full = path.resolve(root, doc.ref);
    if (full === root || !full.startsWith(root + path.sep)) continue;
    try {
      if (fs.statSync(full).isFile()) files[doc.ref] = fs.readFileSync(full, 'utf-8');
    } catch {
      /* not in the tree */
    }
  }
  return files;
}

/**
 * A spec-scan run that exists only to carry its own failure — the pre-flight
 * died before `curateInProcess` could create one. Best-effort: a store that
 * cannot be written must not turn one failure into two.
 */
export function recordFailedScanRun(repoKey: string, error: RunError): void {
  try {
    createSessionRun(repoKey, { command: 'spec-scan', gitRef: 'unknown' }).finish('failed', {
      error,
    });
  } catch (err) {
    log.warn(`[spec-scan] could not record the failed scan for ${repoKey}: ${messageOf(err)}`);
  }
}

/** Stamp the reason onto a run that already exists (and already finished). */
export function stampRunError(repoKey: string, runId: string, error: RunError): void {
  try {
    openSessionRun(repoKey, 'spec-scan', runId).setError(error);
  } catch (err) {
    log.warn(`[spec-scan] could not stamp the scan failure for ${repoKey}: ${messageOf(err)}`);
  }
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));
