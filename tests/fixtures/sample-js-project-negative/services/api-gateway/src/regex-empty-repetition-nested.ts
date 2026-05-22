// True bug: `(a*)*` lets each outer iteration consume zero characters,
// causing catastrophic backtracking on a non-matching input.

// VIOLATION: code-quality/deterministic/regex-empty-repetition
export const NESTED_STAR = /^(a*)*$/;
