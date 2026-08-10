/**
 * Negative fixture for code-quality/deterministic/expression-complexity.
 *
 * A single return that tangles arithmetic with boolean logic across many
 * operators. Unlike a flat membership test or an object/array literal, this
 * genuinely benefits from being broken into named intermediate variables, so
 * it must still be flagged.
 */

export function isOverloaded(load: number, errors: number, latency: number, quota: number): boolean {
  // VIOLATION: code-quality/deterministic/expression-complexity
  return load * 2 + errors > quota && latency - errors * 3 > quota && load + errors + latency > quota;
}
