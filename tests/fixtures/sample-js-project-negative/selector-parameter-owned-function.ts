/**
 * Negative fixture for code-quality/deterministic/selector-parameter.
 *
 * A function the author owns that takes a boolean to switch behavior — the
 * real selector-parameter anti-pattern. It is a top-level declaration, not a
 * callback, so it must still be flagged.
 */

// VIOLATION: code-quality/deterministic/selector-parameter
export function renderReport(data: string, isVerbose: boolean): string {
  if (isVerbose) {
    return `verbose:${data}`;
  }
  return data;
}
