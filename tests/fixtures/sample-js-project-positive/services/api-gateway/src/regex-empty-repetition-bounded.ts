// Inner group `[-_][a-z0-9]+` cannot match the empty string — it requires
// at least one separator AND one alphanumeric. The outer `*` is safe; no
// catastrophic backtracking is possible.

export const URL_SLUG = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/u;
