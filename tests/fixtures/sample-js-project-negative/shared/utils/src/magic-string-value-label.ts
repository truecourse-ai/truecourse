/**
 * A genuine magic-string / duplicate-string bug: the same multi-word
 * user-facing status label appears in three return positions. The
 * string is a domain phrase, not a property key or schema token, so
 * extracting it to a named constant is the appropriate fix.
 */

// VIOLATION: code-quality/deterministic/magic-string
// VIOLATION: code-quality/deterministic/duplicate-string
export function pickStatusLabel(status: number): string {
  if (status === 0) return 'Pending external verification step';
  if (status === 1) return 'Pending external verification step';
  return 'Pending external verification step';
}
