// Negative cases that the rule must still catch after the iteration-callback
// and identifier-boundary fixes.

// Standalone function (NOT an Array.prototype iteration callback) with a
// truly-unused trailing positional parameter. The rule must still flag this.
// VIOLATION: code-quality/deterministic/unused-function-parameter
export function buildSlug(prefix: string, index: number): string {
  return `slug-${prefix}`;
}

// Function with a `$`-prefixed parameter that is genuinely unused. After the
// identifier-boundary fix the rule must still flag this case.
// VIOLATION: code-quality/deterministic/unused-function-parameter
export function formatTotalLabel($amount: number, suffix: string): string {
  return `total ${suffix}`;
}
