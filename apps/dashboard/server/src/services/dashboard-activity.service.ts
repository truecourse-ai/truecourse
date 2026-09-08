import type { SessionCommand } from '@truecourse/agent-loop';
import { createStoredSessionRun, type SessionRunStore } from '@truecourse/core/lib/sessions-store';
import type { JobContext } from '@truecourse/jobs';
import { mirrorTracker, type OnboardingJobPayload } from '../jobs/tasks/onboarding.js';
import type { StepTracker } from '@truecourse/core/progress';

/** The hosted job owns the run until its output has been saved. */
export async function dashboardActivity<P extends OnboardingJobPayload, T>(
  ctx: JobContext<P>,
  command: SessionCommand,
  steps: readonly { key: string; label: string }[],
  execute: (run: SessionRunStore, tracker: StepTracker) => Promise<T>,
): Promise<T> {
  const run = await createStoredSessionRun(ctx.payload.repoFullName, {
    command, gitRef: 'unknown', activityStream: true,
  });
  const tracker = mirrorTracker(ctx, [{ key: 'clone', label: 'Preparing repository' }, ...steps]);
  const untap = tracker.tap(progress => {
    if (progress.steps) run.setChecklist(progress.steps);
  });
  try {
    tracker.start('clone');
    const result = await execute(run, tracker);
    run.finish(ctx.signal?.aborted ? 'interrupted' : run.record().error ? 'failed' : 'completed');
    await run.flush?.();
    return result;
  } catch (error) {
    run.finish(ctx.signal?.aborted ? 'interrupted' : 'failed', {
      error: { message: error instanceof Error ? error.message : String(error) },
    });
    await run.flush?.();
    throw error;
  } finally { untap(); }
}
