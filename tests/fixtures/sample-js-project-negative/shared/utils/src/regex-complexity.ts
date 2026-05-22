/**
 * Paraphrased true-bug for code-quality/deterministic/regex-complexity.
 *
 * A long inline regex with many capture groups and lookaheads embedded in
 * an arbitrary application file — the rule should fire and ask for it to
 * be extracted to a documented named constant.
 */

export function looksLikeRoute(input: string): boolean {
  // VIOLATION: code-quality/deterministic/regex-complexity
  return /^(?=\/)(?!\/(?:api|admin))\/([a-z][\w-]*)(?:\/([a-z][\w-]*))?(?:\/([a-z][\w-]*))?$/i.test(input);
}
