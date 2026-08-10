/**
 * Paraphrased true-bug for code-quality/deterministic/missing-boundary-types.
 *
 * A regular exported utility — no framework convention, no JSX. The
 * boundary genuinely needs an explicit return type so the public shape
 * is stable.
 */

// VIOLATION: code-quality/deterministic/missing-boundary-types
export function buildRecordLabel(prefix: string, id: number) {
  return `${prefix}-${id}`;
}
