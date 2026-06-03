/**
 * Real `no-void` bug — `void 1` used inside an expression as a confusing
 * stand-in for `undefined`. The value IS consumed (returned to the caller),
 * so this is not the harmless "mark as used" statement pattern.
 */

export function maybeIndex(value: number): number | undefined {
  // VIOLATION: code-quality/deterministic/no-void
  return value > 0 ? value : void 1;
}
