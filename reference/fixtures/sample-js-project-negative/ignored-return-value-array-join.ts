/**
 * Negative fixture for bugs/deterministic/ignored-return-value.
 *
 * `Array.prototype.join` returns the joined string and does not mutate the
 * array; discarding its result is the real bug this rule catches. The
 * socket.io carve-out is keyed to realtime-connection receivers, so a plain
 * array receiver must still be flagged.
 */

export function renderPath(parts: string[]): void {
  // VIOLATION: bugs/deterministic/ignored-return-value
  parts.join("/");
}
