/**
 * Paraphrased true-bug for code-quality/deterministic/regex-complexity.
 *
 * An anonymous regex inline at a call site, with deep nested groups
 * and multiple lookaheads. It has no name to document intent, and
 * its structure is hard to read at a glance. The rule should fire and
 * ask the author to either extract it to a documented constant or
 * simplify it.
 */

export function shouldDispatchAsApiCall(path: string): boolean {
  // VIOLATION: code-quality/deterministic/regex-complexity
  return /^(?=\/v\d+)(?!\/v\d+\/(?:internal|admin))\/v\d+\/((?:[a-z]+\/?)+)(?:\?[a-z]+=(?:[a-z0-9-]+|true|false))?$/i.test(
    path,
  );
}
