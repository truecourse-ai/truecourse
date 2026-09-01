/**
 * The onboarding scan a connect fires, and the shared spec-scan pipeline the
 * manual Scan route reuses. Connecting a repository through the GitHub App
 * starts its spec scan; the scan clones the repo into an ephemeral per-run
 * work tree (see work-tree.service.ts), curates against that tree, persists
 * the corpus to the server-side spec store keyed by `(owner/repo, commit)`,
 * and deletes the clone — nothing durable ever lives in a working copy.
 *
 * BACKGROUND, IN THIS PROCESS. There is no job queue — "background" here is a
 * fire-and-forget promise started after the connect response has already gone
 * out. The scan is therefore never inside the request: a slow clone or scan
 * cannot hold the response, and a failed one cannot change it.
 *
 * NO CONFIRMATION GATE for the onboarding scan. `curateInProcess`'s estimate
 * hooks are deliberately not passed: connecting a repository IS the request
 * for onboarding, so the scan runs without a second prompt. That spends on the
 * workspace's own provider, unattended — accepted for the preview, and the
 * reason this entry lives here rather than being folded into the manual Scan
 * route, whose estimate gate is opt-out rather than absent.
 *
 * Progress reaches the client through the two channels the manual Scan already
 * uses, so no new plumbing exists for it: the socket spec tracker
 * (`spec:progress` in the repo's room) and the sessions store's own `run.json`
 * — keyed by the repo IDENTITY, not the throwaway clone, so the repo's runs
 * watcher sees every write and the transcripts outlive the clone.
 *
 * Nothing here ever throws or rejects: every failure lands in the run record
 * (`curateInProcess` finishes it `failed`), the server log, and a terminal
 * `spec:progress` error for any client watching the repo.
 *
 * CANCELLABLE. A scan started here — the onboarding one and the manual Scan
 * route alike, since both claim the same slot — runs under an `AbortSignal` we
 * keep, so {@link cancelSpecScan} can stop it and wait for it to settle. That
 * is what makes disconnecting a repository possible while its own onboarding
 * scan is still running: the disconnect IS the answer to whether the scan is
 * still wanted. The work tree is disposed on every exit, cancellation included.
 */

import type { RunError } from '@truecourse/agent-loop';
import { log } from '@truecourse/core/lib/logger';
import {
  createSessionRun,
  listSessionRuns,
  openSessionRun,
} from '@truecourse/core/lib/sessions-store';
import { resolveCommitSha } from '@truecourse/core/lib/repo-ref';
import { saveSpec, specsMaterializeInPlace } from '@truecourse/core/lib/spec-store';
import {
  curateInProcess,
  getDecisions,
  saveDecisions,
  CURATE_STEPS,
  type CurateInProcessOptions,
  type SpecCurateInProcessResult,
} from '@truecourse/core/commands/spec-in-process';
import { writeDecisions, resolveRepoIdentity } from '@truecourse/spec-consolidator';
import {
  LlmNotConfiguredError,
  LlmProbeFailedError,
  startWorkspaceLlm,
} from './workspace-llm.service.js';
import { acquireWorkTree } from './work-tree.service.js';
import {
  createSocketSpecTracker,
  emitSpecComplete,
  emitSpecProgress,
} from '../socket/handlers.js';

/** One claimed scan slot: how to stop the scan, and when it has really stopped. */
interface ScanClaim {
  controller: AbortController;
  /** Resolves when the scan has settled and released the slot. */
  done: Promise<void>;
  settle: () => void;
}

/**
 * Repos whose scan THIS PROCESS started and has not finished — the onboarding
 * scan or the manual Scan route, which share this guard. Keyed by the repo
 * identity (`owner/repo`). The store's own `running` records cover a scan
 * started by an earlier server process; this map covers the window between
 * "started" and "the run record exists", which the store cannot see. (For the
 * manual scan that window includes the whole estimate-confirm wait.)
 *
 * It is also the CANCELLATION REGISTRY: a scan of ours can be stopped, which
 * is what lets a repository be disconnected while its onboarding scan is still
 * running instead of being held hostage by it.
 */
const inFlight = new Map<string, ScanClaim>();

/** How long a cancel waits for the scan to actually stop before giving up. */
const CANCEL_TIMEOUT_MS = 30_000;

/** Is a spec scan already running for this repo — here or anywhere else? */
export function isSpecScanRunning(repoKey: string): boolean {
  if (inFlight.has(repoKey)) return true;
  try {
    // listSessionRuns sweeps dead-pid runs as it reads, so `running` here means
    // a live process, not a corpse left by a crash.
    return listSessionRuns(repoKey, 'spec-scan').some((run) => run.status === 'running');
  } catch {
    return false; // no store yet — nothing is running
  }
}

/** Is the scan running for this repo OURS — i.e. one we can stop? */
export function ownsSpecScan(repoKey: string): boolean {
  return inFlight.has(repoKey);
}

/** A claimed scan slot: the signal to run under, and the release that frees it. */
export interface SpecScanClaim {
  /** Pass to `curateInProcess` so a cancel reaches the sessions. */
  signal: AbortSignal;
  /** Call once the scan has settled, however it settled. */
  release: () => void;
}

/**
 * Claim the repo's one scan slot. Returns the claim, or `null` when a scan is
 * already running (here or anywhere else). Check-and-claim is synchronous, so
 * two concurrent requests cannot both get a slot.
 */
export function beginSpecScan(repoKey: string): SpecScanClaim | null {
  if (isSpecScanRunning(repoKey)) return null;
  let settle!: () => void;
  const done = new Promise<void>((resolve) => (settle = resolve));
  const claim: ScanClaim = { controller: new AbortController(), done, settle };
  inFlight.set(repoKey, claim);
  return {
    signal: claim.controller.signal,
    release: () => {
      // Drop the slot BEFORE waking anyone waiting on `done`, so a canceller
      // that resumes sees a free repo rather than its own scan still listed.
      if (inFlight.get(repoKey) === claim) inFlight.delete(repoKey);
      claim.settle();
    },
  };
}

/**
 * Stop the scan THIS process is running for `repoKey` and wait for it to
 * settle. `true` once the slot is free; `false` when we own no scan there or
 * when it did not stop within `timeoutMs`.
 */
export async function cancelSpecScan(
  repoKey: string,
  timeoutMs = CANCEL_TIMEOUT_MS,
): Promise<boolean> {
  const claim = inFlight.get(repoKey);
  if (!claim) return false;
  claim.controller.abort();
  let timer: NodeJS.Timeout | undefined;
  const stopped = await Promise.race([
    claim.done.then(() => true),
    new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    }),
  ]);
  if (timer) clearTimeout(timer);
  return stopped && !inFlight.has(repoKey);
}

/**
 * What a caller threads into the shared pipeline: the estimate/progress hooks,
 * and the session driver built from the asking workspace's provider config —
 * the run's credentials travel with it, never through a process-wide default.
 */
export type StoredSpecScanOptions = Pick<
  CurateInProcessOptions,
  | 'tracker'
  | 'signal'
  | 'source'
  | 'onLlmEstimate'
  | 'onEstimatePhase'
  | 'onRunStarted'
  | 'driver'
>;

/**
 * The whole spec scan of a connected repository: acquire an ephemeral work
 * tree, curate against it, persist the corpus server-side under the tree's
 * commit, dispose the tree. The caller owns the scan slot and the provider
 * check; this owns everything between clone and store.
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
 * Start the repo's spec scan in the background. Returns whether it started:
 * `false` means a scan for this repo is already running and this call was a
 * no-op. Never throws.
 */
export function startOnboardingScan(repoId: string, repoKey: string, orgId: string): boolean {
  try {
    const claim = beginSpecScan(repoKey);
    if (!claim) {
      log.info(`[onboarding] spec scan already running for ${repoId} — not starting a second`);
      return false;
    }
    void runScan(repoId, repoKey, orgId, claim.signal).finally(claim.release);
    return true;
  } catch (err) {
    log.error(`[onboarding] could not start the spec scan for ${repoId}: ${messageOf(err)}`);
    return false;
  }
}

/** The scan itself. Resolves in every case — failures are reported, not thrown. */
async function runScan(
  repoId: string,
  repoKey: string,
  orgId: string,
  signal: AbortSignal,
): Promise<void> {
  try {
    // The workspace's provider, loaded and proved BEFORE the clone exists. A
    // workspace with no provider configured simply has no scan: there is
    // nothing to start it with, so nothing is started and nothing is recorded
    // as failed — the client learns it from GET /api/llm/config.
    const llm = await startWorkspaceLlm(orgId);

    const tracker = createSocketSpecTracker(repoId, CURATE_STEPS.map((s) => ({ ...s })));
    await runStoredSpecScan(repoKey, {
      tracker,
      source: 'dashboard',
      signal,
      driver: llm.driver(),
      onRunStarted: (info) =>
        log.info(`[onboarding] spec scan ${info.runId} started for ${repoId}`),
    });
    log.info(`[onboarding] spec scan finished for ${repoId}`);
    safely(() => emitSpecComplete(repoId, 'scan'));
  } catch (err) {
    // A cancelled scan is not a failure to report: the repository it was
    // scanning is being disconnected, and there is nobody left to tell.
    if (signal.aborted) {
      log.info(`[onboarding] spec scan cancelled for ${repoId}`);
      return;
    }
    if (err instanceof LlmNotConfiguredError) {
      log.info(`[onboarding] no LLM provider configured for ${repoId} — no scan started`);
      return;
    }
    const message = messageOf(err);
    log.error(`[onboarding] spec scan failed for ${repoId}: ${message}`);
    // A probe failure died before there was a run to fail — create one, so the
    // repository shows a failed scan instead of no scan at all. Everything else
    // already carries its reason (runStoredSpecScan stamped it).
    if (err instanceof LlmProbeFailedError) {
      recordFailedScanRun(repoKey, { message, kind: 'llm-probe' });
    }
    // The run record carries the failure; this is what a client watching the
    // repo sees while it is still on the page.
    safely(() => emitSpecProgress(repoId, { step: 'error', percent: 100, detail: message }));
  }
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
    log.warn(`[onboarding] could not record the failed scan for ${repoKey}: ${messageOf(err)}`);
  }
}

/** Stamp the reason onto a run that already exists (and already finished). */
function stampRunError(repoKey: string, runId: string, error: RunError): void {
  try {
    openSessionRun(repoKey, 'spec-scan', runId).setError(error);
  } catch (err) {
    log.warn(`[onboarding] could not stamp the scan failure for ${repoKey}: ${messageOf(err)}`);
  }
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** Socket emits are best-effort: a server with no io yet must not break a scan. */
function safely(emit: () => void): void {
  try {
    emit();
  } catch {
    /* no socket server — the log already has it */
  }
}
