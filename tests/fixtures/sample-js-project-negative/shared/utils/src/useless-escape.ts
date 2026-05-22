/**
 * Paraphrased true-bug for code-quality/deterministic/useless-escape.
 *
 * `\p` is not a recognized JavaScript string escape — the backslash is
 * silently dropped at parse time. Almost always a typo for an intended
 * literal character, or a misplaced regex shorthand.
 */

// VIOLATION: code-quality/deterministic/useless-escape
export const greeting = 'sto\p';
