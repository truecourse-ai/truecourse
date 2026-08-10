/**
 * Paraphrased true-bug for code-quality/deterministic/undefined-passed-as-optional.
 *
 * A function with two leading required parameters and a trailing optional;
 * the caller passes `undefined` for the optional, which is redundant — the
 * call is equivalent to omitting the argument.
 */

function recordEvent(name: string, payload: Record<string, unknown>, traceId?: string): void {
  void name;
  void payload;
  void traceId;
}

// VIOLATION: code-quality/deterministic/undefined-passed-as-optional
recordEvent('signed', { id: 1 }, undefined);
