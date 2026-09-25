/**
 * What the onboarding jobs (`repo.guard-setup` → `repo.guard-generate` →
 * `repo.guard-run`) share: the payload every one of them carries, and the
 * one tracker that drives both progress surfaces at once.
 *
 * A repository is onboarded by a chain of jobs, so each of them needs the same
 * four facts — which repo (by slug, for the socket room; by `owner/repo`, for
 * every store), whose workspace pays for it, and what asked for it.
 */

import { StepTracker } from '@truecourse/core/progress';
import { stepBridge, type JobContext, type JobOutcomeStatus, type JobPayload } from '@truecourse/jobs';
import { emitSpecProgress } from '../../socket/handlers.js';
import type { WorkTreeVia } from '../../services/work-tree.service.js';

/** What asked for this run: a connect, a user pressing the button, the chain, a push to the default branch, or a pull request. */
export type OnboardingJobSource = 'connect' | 'manual' | 'chain' | 'push' | 'pull-request';

/** What an enqueue is asked for — the payload minus the row the queue creates. */
export interface OnboardingJobRequest {
  /** Registry slug — the socket room every progress event goes to. */
  repoId: string;
  /** `owner/repo` — the identity every store, clone and run record keys by. */
  repoFullName: string;
  workspaceOrgId: string;
  source: OnboardingJobSource;
  /**
   * The commit the chain is pinned to: the tip setup cloned, carried into the
   * generate and the run it chains so all three work the same tree. Absent
   * means the default branch's tip when the job starts.
   */
  commitSha?: string;
  /**
   * The user id of the person whose request enqueued it. Unset when nobody
   * asked directly: a chain, a webhook, the scheduler.
   */
  requestedBy?: string;
  /**
   * The run record this job is carrying on. Declared by the BODY through
   * `ctx.resumeWith` the moment it opens one, so a paused row put back on the
   * queue writes into the conversation it stopped in rather than a second one
   * beside it. Never a caller's to set: a fresh request is a fresh run.
   */
  carryOnRunId?: string;
}

export type OnboardingJobPayload = OnboardingJobRequest & JobPayload;

/**
 * Where a job's work tree comes from: the commit its request pinned, or the
 * default branch's tip when it pinned none (a repository's own provider, as
 * every onboarding job clones).
 */
export function workTreeVia(payload: OnboardingJobRequest): WorkTreeVia | undefined {
  return payload.commitSha
    ? { workspaceOrgId: payload.workspaceOrgId, commitSha: payload.commitSha }
    : undefined;
}

/**
 * A chain ended: the settling job asked for no next link — the run always, a
 * setup or a generate that stopped short. (A link asked for but refused as
 * busy is not an end: the job that was busy ends the chain itself.)
 * `commitSha` is the chain's commit — the one the job was pinned to, else the
 * one it cloned — and null when it never got to clone. The mount uses it to
 * run the chain once more when the default branch moved on meanwhile.
 */
export type ChainEnd = (request: OnboardingJobRequest, commitSha: string | null) => Promise<void>;

/**
 * Whether a settled job's chain has ENDED and may be followed up: a job that
 * succeeded or failed. A cancelled one was stopped on purpose — a disconnect
 * is cancelling the chain, not asking for another — and a paused one is not
 * over: its resume carries the same chain on, and reports its end then.
 */
export const chainEnded = (outcome: JobOutcomeStatus): boolean =>
  outcome === 'succeeded' || outcome === 'failed';

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
    safely(() => emitSpecProgress(ctx.payload.workspaceOrgId, ctx.payload.repoId, payload));
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
    safely(() => emitSpecProgress(ctx.payload.workspaceOrgId, ctx.payload.repoId, payload));
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
