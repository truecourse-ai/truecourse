/**
 * The onboarding scan a connect fires: connecting a repository by URL starts
 * its spec scan on the cloned default branch. Guard setup / generate / baseline are not on this
 * branch yet, so the chain is exactly one step today.
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

/**
 * Repos whose scan THIS PROCESS started and has not finished — the onboarding
 * scan or the manual Scan route, which share this guard. The store's own
 * `running` records cover a scan started by anything else (a CLI run, an
 * earlier server process); this set covers the window between "started" and
 * "the run record exists", which the store cannot see. (For the manual scan
 * that window includes the whole estimate-confirm wait.)
 */
const inFlight = new Set<string>();

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

/**
 * Claim the repo's one scan slot. Returns the release function, or `null`
 * when a scan is already running (here or anywhere else). Check-and-claim is
 * synchronous, so two concurrent requests cannot both get a slot.
 */
export function beginSpecScan(repoPath: string): (() => void) | null {
  if (isSpecScanRunning(repoPath)) return null;
  const key = path.resolve(repoPath);
  inFlight.add(key);
  return () => inFlight.delete(key);
}

/**
 * Start the repo's spec scan in the background. Returns whether it started:
 * `false` means a scan for this repo is already running and this call was a
 * no-op. Never throws.
 */
export function startOnboardingScan(repoId: string, repoPath: string): boolean {
  try {
    const release = beginSpecScan(repoPath);
    if (!release) {
      log.info(`[onboarding] spec scan already running for ${repoId} — not starting a second`);
      return false;
    }
    void runScan(repoId, repoPath).finally(release);
    return true;
  } catch (err) {
    log.error(`[onboarding] could not start the spec scan for ${repoId}: ${messageOf(err)}`);
    return false;
  }
}

/** The scan itself. Resolves in every case — failures are reported, not thrown. */
async function runScan(repoId: string, repoPath: string): Promise<void> {
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
      onRunStarted: (info) =>
        log.info(`[onboarding] spec scan ${info.runId} started for ${repoId}`),
    });
    log.info(`[onboarding] spec scan finished for ${repoId}`);
    safely(() => emitSpecComplete(repoId, 'scan'));
  } catch (err) {
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
