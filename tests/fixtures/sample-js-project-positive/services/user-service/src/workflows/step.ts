/**
 * Workflow step lifecycle. A Step moves through a fixed set of states; once
 * it reaches a terminal state (`done` or `failed`) it must not transition
 * back into an active state.
 *
 * Every state-changing function below guards on the current status before
 * writing, so the state-machine plugin has nothing to flag.
 */

export type StepStatus = 'pending' | 'running' | 'done' | 'failed';

export interface Step {
  id: string;
  status: StepStatus;
}

export function createStep(id: string): Step {
  return { id, status: 'pending' };
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
