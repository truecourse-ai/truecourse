/**
 * Tiny glob matcher — handles the subset of `minimatch` syntax our contract DSL
 * uses today (`*`, `**`). Avoids pulling in the full `minimatch`
 * dependency just for a few patterns.
 *
 * Supported:
 *   `**`   — matches across path segment boundaries (any number, ≥0)
 *   `*`    — matches anything within a single path segment
 *   literal characters — exact match
 *
 * Not supported (not needed yet): `?`, `[abc]`, `{a,b}`. If the contract DSL ever
 * uses those, we can either extend this or drop in a real dependency.
 */
export function minimatch(input: string, pattern: string): boolean {
  // Convert glob to a regex.
  let re = '^';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*') {
      re += '.*';
      i++; // consume second `*`
    } else if (c === '*') {
      re += '[^/]*';
    } else if ('.+?^${}()|[]\\'.includes(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  re += '$';
  return new RegExp(re).test(input);
}
