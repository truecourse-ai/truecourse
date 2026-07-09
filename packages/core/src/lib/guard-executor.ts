/**
 * The active `GuardExecutor` registry — the run-execution analogue of the
 * `GuardStore` seam. The OSS default runs guards in-process (`defaultGuardExecutor`
 * from `@truecourse/guard-runner`); the enterprise edition installs a hosted
 * executor via `setGuardExecutor` (build + run a per-commit checkout elsewhere).
 * Everything that executes guards — the `guard run` driver and generate-time birth
 * validation — resolves the executor through `getGuardExecutor()`.
 */

import { defaultGuardExecutor, type GuardExecutor } from '@truecourse/guard-runner';

let active: GuardExecutor = defaultGuardExecutor;

/** The active guard executor (in-process unless EE installed a hosted one). */
export function getGuardExecutor(): GuardExecutor {
  return active;
}
/** Install a guard executor (e.g. the enterprise hosted impl). */
export function setGuardExecutor(exec: GuardExecutor): void {
  active = exec;
}
/** Restore the in-process default (tests). */
export function resetGuardExecutor(): void {
  active = defaultGuardExecutor;
}

export { defaultGuardExecutor } from '@truecourse/guard-runner';
export type { GuardExecutor, GuardExecInput, GuardExecReport } from '@truecourse/guard-runner';
