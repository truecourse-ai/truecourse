import type { SessionCommand } from '@truecourse/agent-loop';
import { createStoredSessionRun, type SessionRunStore } from '@truecourse/core/lib/sessions-store';
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
 */
export async function dashboardActivity<P extends OnboardingJobPayload, T>(
  ctx: JobContext<P>,
  command: SessionCommand,
  steps: readonly { key: string; label: string }[],
  execute: (run: SessionRunStore, tracker: StepTracker) => Promise<T>,
  credits?: CreditsGate,
): Promise<T> {
  const run = await createStoredSessionRun(ctx.payload.repoFullName, {
    command, gitRef: 'unknown',
  });
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
