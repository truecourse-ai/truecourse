/**
 * A genuine unhandled-promise bug: a Promise-returning call sits as
 * a statement with no `await`, `.catch()`, `void`, or eslint-disable
 * suppression. Any rejection from `flushQueue` would be silently lost.
 */

declare function flushQueue(): Promise<void>;

export function fireAndForget(): void {
  // VIOLATION: bugs/deterministic/unhandled-promise
  flushQueue();
}
