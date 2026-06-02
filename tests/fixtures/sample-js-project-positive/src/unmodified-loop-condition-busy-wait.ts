/**
 * Positive fixture for bugs/deterministic/unmodified-loop-condition.
 *
 * `Date.now()` in the condition advances on every iteration — the loop
 * terminates as soon as the clock crosses the deadline. The local `start`
 * and `delayMs` bindings are intentionally never assigned inside the
 * loop body; the moving state is the side-effect-free call.
 *
 * Same shape applies to `performance.now()` deadline loops and
 * `queue.length`-style helpers that return ever-changing values.
 */

export function spin(delayMs: number): void {
  const start = Date.now();
  while (Date.now() - start < delayMs) {
    // Intentional busy-wait — used by tests that measure event-loop lag.
  }
}
