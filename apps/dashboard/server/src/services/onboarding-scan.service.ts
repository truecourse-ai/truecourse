/**
 * The onboarding scan a connect fires: connecting a repository through the
 * GitHub App starts its spec scan on the cloned default branch. Guard setup /
 * generate / baseline are not on this branch yet, so the chain is exactly one
 * step today.
 *
 * BACKGROUND, IN THIS PROCESS. OSS has no job queue — hosted EE enqueues a
 * baseline job on link instead — so "background" here is a fire-and-forget
 * promise started after the connect response has already gone out. The scan is
 * therefore never inside the request: a slow scan cannot hold the response, and
 * a failed scan cannot change it.
 *
 * NO CONFIRMATION GATE. `curateInProcess`'s estimate hooks are deliberately not
 * passed: connecting a repository IS the request for onboarding, so the scan
 * runs without a second prompt. That spends whatever LLM transport the operator
 * configured, unattended — accepted for the preview, and the reason this entry
 * lives here rather than being folded into the manual Scan route, which keeps
 * its estimate gate.
 *
 * Progress reaches the client through the two channels the manual Scan already
 * uses, so no new plumbing exists for it: the socket spec tracker (`spec:progress`
 * in the repo's room) and the sessions store's own `run.json`, whose every write
 * the repo's runs watcher pushes out as `session:runs-changed`. `onRunStarted`
 * means the run record exists — and so is listable and tailable — from the first
 * moment.
 *
 * Nothing here ever throws or rejects: every failure lands in the run record
 * (`curateInProcess` finishes it `failed`), the server log, and a terminal
 * `spec:progress` error for any client watching the repo.
 *
 * CANCELLABLE. A scan started here — the onboarding one and the manual Scan
 * route alike, since both claim the same slot — runs under an `AbortSignal` we
 * keep, so {@link cancelSpecScan} can stop it and wait for it to settle. That
 * is what makes disconnecting a repository possible while its own onboarding
 * scan is still writing into it: the disconnect IS the answer to whether the
 * scan is still wanted. A scan another process owns has no such signal, and
 * still blocks the disconnect.
 */

import path from 'node:path';
import { log } from '@truecourse/core/lib/logger';
import { isGitRepo, NOT_A_GIT_REPO_MESSAGE } from '@truecourse/core/lib/git';
import { listSessionRuns } from '@truecourse/core/lib/sessions-store';
import { curateInProcess, CURATE_STEPS } from '@truecourse/core/commands/spec-in-process';
import { ensureLlmTransport } from './llm-transport.service.js';
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
 * scan or the manual Scan route, which share this guard. The store's own
 * `running` records cover a scan started by anything else (a CLI run, an
 * earlier server process); this map covers the window between "started" and
 * "the run record exists", which the store cannot see. (For the manual scan
 * that window includes the whole estimate-confirm wait.)
 *
 * It is also the CANCELLATION REGISTRY: a scan of ours can be stopped, which
 * is what lets a repository be disconnected while its onboarding scan is still
 * running instead of being held hostage by it.
 */
const inFlight = new Map<string, ScanClaim>();

/** How long a cancel waits for the scan to actually stop before giving up. */
const CANCEL_TIMEOUT_MS = 30_000;

/** Is a spec scan already running for this repo — here or anywhere else? */
export function isSpecScanRunning(repoPath: string): boolean {
  if (inFlight.has(path.resolve(repoPath))) return true;
  try {
    // listSessionRuns sweeps dead-pid runs as it reads, so `running` here means
    // a live process, not a corpse left by a crash.
    return listSessionRuns(repoPath, 'spec-scan').some((run) => run.status === 'running');
  } catch {
    return false; // no store yet (a fresh clone) — nothing is running
  }
}

/** Is the scan running for this repo OURS — i.e. one we can stop? */
export function ownsSpecScan(repoPath: string): boolean {
  return inFlight.has(path.resolve(repoPath));
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
export function beginSpecScan(repoPath: string): SpecScanClaim | null {
  if (isSpecScanRunning(repoPath)) return null;
  const key = path.resolve(repoPath);
  let settle!: () => void;
  const done = new Promise<void>((resolve) => (settle = resolve));
  const claim: ScanClaim = { controller: new AbortController(), done, settle };
  inFlight.set(key, claim);
  return {
    signal: claim.controller.signal,
    release: () => {
      // Drop the slot BEFORE waking anyone waiting on `done`, so a canceller
      // that resumes sees a free repo rather than its own scan still listed.
      if (inFlight.get(key) === claim) inFlight.delete(key);
      claim.settle();
    },
  };
}

/**
 * Stop the scan THIS process is running for `repoPath` and wait for it to
 * settle. `true` once the slot is free; `false` when we own no scan there (a
 * CLI run in the same tree is nobody's to abort) or when it did not stop
 * within `timeoutMs` — in both cases the caller must not touch the tree.
 */
export async function cancelSpecScan(
  repoPath: string,
  timeoutMs = CANCEL_TIMEOUT_MS,
): Promise<boolean> {
  const key = path.resolve(repoPath);
  const claim = inFlight.get(key);
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
  return stopped && !inFlight.has(key);
}

/**
 * Start the repo's spec scan in the background. Returns whether it started:
 * `false` means a scan for this repo is already running and this call was a
 * no-op. Never throws.
 */
export function startOnboardingScan(repoId: string, repoPath: string): boolean {
  try {
    const claim = beginSpecScan(repoPath);
    if (!claim) {
      log.info(`[onboarding] spec scan already running for ${repoId} — not starting a second`);
      return false;
    }
    void runScan(repoId, repoPath, claim.signal).finally(claim.release);
    return true;
  } catch (err) {
    log.error(`[onboarding] could not start the spec scan for ${repoId}: ${messageOf(err)}`);
    return false;
  }
}

/** The scan itself. Resolves in every case — failures are reported, not thrown. */
async function runScan(repoId: string, repoPath: string, signal: AbortSignal): Promise<void> {
  try {
    if (!(await isGitRepo(repoPath))) throw new Error(NOT_A_GIT_REPO_MESSAGE);
    // Refresh the saved LLM selection (a `stat` when unchanged). An unusable API
    // config — or none at all — fails HERE, before the run record exists, which
    // is why the failure is reported on the socket as well as the log.
    ensureLlmTransport();

    const tracker = createSocketSpecTracker(repoId, CURATE_STEPS.map((s) => ({ ...s })));
    await curateInProcess(repoPath, {
      tracker,
      source: 'dashboard',
      signal,
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
    const message = messageOf(err);
    log.error(`[onboarding] spec scan failed for ${repoId}: ${message}`);
    // The run record already carries the failure when one was created; this is
    // what a client sees when the scan died before there was a run to fail.
    safely(() => emitSpecProgress(repoId, { step: 'error', percent: 100, detail: message }));
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
