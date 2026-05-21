// Fresh negative case: mixed anchoring across alternatives. `^foo|bar$`
// matches strings that *start with* "foo" OR strings that *end with* "bar",
// which is almost certainly not what the author intended. The fix is to
// wrap the alternation in a group.

// VIOLATION: code-quality/deterministic/regex-anchor-precedence
export const mixedAnchors = /^foo|bar$/;
