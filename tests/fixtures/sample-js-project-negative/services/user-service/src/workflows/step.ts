/**
 * Workflow step lifecycle. A Step moves through a fixed set of states; once
 * it reaches a terminal state (`done` or `failed`) it must not transition
 * back into an active state.
 *
 * The `recoverExpired` worker below has a real bug — it resets a step to
 * `running` without checking the current status, so a step that finished
 * (`done`) or hard-failed (`failed`) gets dragged back into the active
 * pool. This is the state-machine plugin's headline catch.
 */

export type StepStatus = 'pending' | 'running' | 'waiting_retry' | 'done' | 'failed';

export interface Step {
  id: string;
  status: StepStatus;
  attempts: number;
  expiresAt: Date | null;
}

export function createStep(id: string): Step {
  return {
    id,
    status: 'pending',
    attempts: 0,
    expiresAt: null,
  };
}

export function startStep(step: Step): void {
  if (step.status === 'pending') {
    step.status = 'running';
  }
}

export function completeStep(step: Step): void {
  if (step.status === 'running') {
    step.status = 'done';
  }
}

export function failStep(step: Step): void {
  if (step.status === 'running' || step.status === 'waiting_retry') {
    step.status = 'failed';
  }
}

export function scheduleRetry(step: Step): void {
  if (step.status === 'running') {
    step.status = 'waiting_retry';
  }
}

export function resumeAfterRetry(step: Step): void {
  if (step.status === 'waiting_retry') {
    step.status = 'running';
  }
}

/**
 * Lease-recovery worker. When the worker that owns a step crashes, the
 * lease expires and another worker takes over. The recovery path resets
 * the step so it gets picked up by the next scan.
 *
 * BUG: this write is unguarded. A step that already reached `done` or
 * `failed` (both terminal) will be regressed back into `running` here,
 * which silently re-runs already-completed work and corrupts the audit
 * trail.
 */
export function recoverExpired(step: Step): void {
  // INVARIANT-DRIFT: state-machine — Step.status
  step.status = 'running';
}
