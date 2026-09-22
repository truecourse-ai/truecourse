import type { SessionCommand } from '@truecourse/agent-loop';
import {
  createStoredSessionRun,
  resumeStoredSessionRun,
  SessionRunNotFoundError,
  type CreateSessionRunOptions,
  type SessionRunStore,
} from '@truecourse/core/lib/sessions-store';
import { log } from '@truecourse/core/lib/logger';
import { isCreditsExhausted } from '@truecourse/core/lib/credits-store';
import type { JobContext } from '@truecourse/jobs';
import { mirrorTracker, type OnboardingJobPayload } from '../jobs/tasks/onboarding.js';
import type { StepTracker } from '@truecourse/core/progress';

/** What the run record needs to know about the money: whether it ran out. */
export interface CreditsGate {
  /** Throws `CreditsExhaustedError` when the run could no longer pay. */
  assertCredits(): void;
}

/**
 * The hosted job owns the run until its output has been saved.
 *
 * A run that could no longer pay ends `paused`, not `failed`: the gate is asked
 * on BOTH paths, because an engine that lost every call to an empty balance
 * reports that as its own kind of failure and it is the balance that is the
 * truth of it. Its live sessions park with their journals intact, so what it
 * reached is what a resume starts from.
 *
 * And a resume carries THAT RUN on: the payload of a revived job names the
 * record it paused in, so the work lands in the conversation it stopped in
 * rather than a second one beside it. A run the store no longer holds (a
 * repository disconnected and reconnected under the same name) opens a fresh
 * one instead of failing a job over its own history.
 */
export async function dashboardActivity<P extends OnboardingJobPayload, T>(
  ctx: JobContext<P>,
  command: SessionCommand,
  steps: readonly { key: string; label: string }[],
  execute: (run: SessionRunStore, tracker: StepTracker) => Promise<T>,
  credits?: CreditsGate,
  opts: { pullRequest?: CreateSessionRunOptions['pullRequest'] } = {},
): Promise<T> {
  const run = await carryOn(ctx, command, opts.pullRequest);
  const tracker = mirrorTracker(ctx, [{ key: 'clone', label: 'Preparing repository' }, ...steps]);
  const untap = tracker.tap(progress => {
    if (progress.steps) run.setChecklist(progress.steps);
  });
  try {
    tracker.start('clone');
    const result = await execute(run, tracker);
    credits?.assertCredits();
    run.finish(ctx.signal?.aborted ? 'interrupted' : run.record().error ? 'failed' : 'completed');
    await run.flush?.();
    return result;
  } catch (thrown) {
    const error = reasonFor(thrown, credits);
    const paused = isCreditsExhausted(error);
    const message = error instanceof Error ? error.message : String(error);
    run.finish(paused ? 'paused' : ctx.signal?.aborted ? 'interrupted' : 'failed', {
      error: { message, ...(paused ? { kind: 'credits' } : {}) },
    });
    await run.flush?.();
    throw error;
  } finally { untap(); }
}

/** The run this job writes into: the one it is carrying on, else a new one. */
async function carryOn<P extends OnboardingJobPayload>(
  ctx: JobContext<P>,
  command: SessionCommand,
  pullRequest?: CreateSessionRunOptions['pullRequest'],
): Promise<SessionRunStore> {
  const repoKey = ctx.payload.repoFullName;
  const carryOnRunId = ctx.payload.carryOnRunId;
  if (carryOnRunId) {
    try {
      return await resumeStoredSessionRun(repoKey, command, carryOnRunId);
    } catch (err) {
      if (!(err instanceof SessionRunNotFoundError)) throw err;
      log.warn(`[jobs] ${repoKey} has no ${command} run ${carryOnRunId} to carry on — opening a new one`);
    }
  }
  return createStoredSessionRun(repoKey, {
    command,
    gitRef: 'unknown',
    ...(pullRequest ? { pullRequest } : {}),
  });
}

/** An empty balance is what stopped the run, whatever the engine called it. */
function reasonFor(thrown: unknown, credits: CreditsGate | undefined): unknown {
  if (!credits) return thrown;
  try {
    credits.assertCredits();
    return thrown;
  } catch (exhausted) {
    return exhausted;
  }
}
