/**
 * Paraphrased true-bug for bugs/deterministic/restrict-template-expressions.
 *
 * An anonymous-object value interpolated directly into a template literal
 * stringifies to "[object Object]" — almost never the intent and a common
 * source of cryptic log lines.
 */

export function describePayload(): string {
  const payload = { id: 1, label: 'demo' };
  // VIOLATION: bugs/deterministic/restrict-template-expressions
  return `payload: ${payload}`;
}
