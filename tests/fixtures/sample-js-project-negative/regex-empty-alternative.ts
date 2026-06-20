// A real empty alternative: the trailing `|` leaves a branch with nothing
// after it, so the pattern also matches the empty string — almost always a
// leftover from deleting the last option in the list.

// VIOLATION: code-quality/deterministic/regex-empty-alternative
export const danglingBranch = /red|green|/;
