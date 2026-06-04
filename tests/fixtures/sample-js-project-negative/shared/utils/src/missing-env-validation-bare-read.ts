/**
 * Paraphrased true-bug for code-quality/deterministic/missing-env-validation.
 *
 * A plain unguarded `process.env.X` read in business code: no `if (!x) throw`,
 * no schema chain, no negation. At runtime `X` may be `undefined` and the
 * concatenation silently produces "<https://undefined>" instead of crashing
 * loudly — the exact bug the rule is meant to catch.
 */

export function buildApiUrl(): string {
  // VIOLATION: code-quality/deterministic/missing-env-validation
  return `https://${process.env.API_HOST}`;
}
