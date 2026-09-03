/**
 * What the onboarding jobs (`repo.scan` → `repo.guard-setup` →
 * `repo.guard-generate`) share: the payload every one of them carries, and the
 * one tracker that drives both progress surfaces at once.
 *
 * A repository is onboarded by a chain of jobs, so each of them needs the same
 * four facts — which repo (by slug, for the socket room; by `owner/repo`, for
 * every store), whose workspace pays for it, and what asked for it.
 */

import { StepTracker } from '@truecourse/core/progress';
import { stepBridge, type JobContext, type JobPayload } from '@truecourse/jobs';
import { emitSpecProgress } from '../../socket/handlers.js';

/** What asked for this run: a connect, a user pressing the button, or the chain. */
export type OnboardingJobSource = 'connect' | 'manual' | 'chain';

/** What an enqueue is asked for — the payload minus the row the queue creates. */
export interface OnboardingJobRequest {
  /** Registry slug — the socket room every progress event goes to. */
  repoId: string;
  /** `owner/repo` — the identity every store, clone and run record keys by. */
  repoFullName: string;
  workspaceOrgId: string;
  source: OnboardingJobSource;
}

export type OnboardingJobPayload = OnboardingJobRequest & JobPayload;

/**
 * The ONE `StepTracker` a pipeline gets. Its phases become the inline detail of
 * the job's `stepKey` step (which goes active on the first one, so a job step
 * is never detailed while still pending), and the same payload goes to the
 * repo's socket room, where the in-page progress popup renders it.
 */
export function pipelineTracker<P extends OnboardingJobPayload>(
  ctx: JobContext<P>,
  stepKey: string,
  stepDefs: readonly { key: string; label: string }[],
): StepTracker {
  const tracker = stepBridge(ctx.tracker, stepKey, stepDefs);
  let started = false;
  tracker.tap((payload) => {
    if (!started) {
      started = true;
      void ctx.phase(stepKey);
    }
    safely(() => emitSpecProgress(ctx.payload.repoId, payload));
  });
  return tracker;
}

/**
 * The tracker for a pipeline whose phases ARE the job's steps: each transition
 * advances the job checklist itself (rather than detailing one step of it), and
 * the same payload goes to the repo's socket room.
 */
export function mirrorTracker<P extends OnboardingJobPayload>(
  ctx: JobContext<P>,
  stepDefs: readonly { key: string; label: string }[],
): StepTracker {
  let active = '';
  return new StepTracker((payload) => {
    const step = payload.steps?.find((s) => s.status === 'active');
    if (step) {
      if (step.key === active) {
        if (step.detail) void ctx.detail(step.key, step.detail);
      } else {
        active = step.key;
        void ctx.phase(step.key, step.detail);
      }
    }
    safely(() => emitSpecProgress(ctx.payload.repoId, payload));
  }, stepDefs.map((s) => ({ ...s })));
}

/** Socket emits are best-effort: a server with no io must not fail a job. */
export function safely(emit: () => void): void {
  try {
    emit();
  } catch {
    /* no socket server — the run record and the job row already have it */
  }
}

/** The first line of a multi-line reason, for a notification body. */
export function firstLine(text: string | undefined): string {
  return text?.split('\n')[0]?.trim() ?? '';
}
