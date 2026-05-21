/**
 * Positive fixture for style/deterministic/js-style-preference.
 *
 * `var` inside an ambient declaration (`declare global { var X }`,
 * `declare module '…' { var X }`, `declare var X`) is the only declaration
 * form TypeScript accepts for augmenting `globalThis` or a module's namespace
 * — `const` and `let` produce a compile error in that position. The rule must
 * not flag these as a style preference.
 */

declare global {

  var __memoCache: Map<string, unknown> | undefined;
}

declare module 'truecourse-fp-fixture-ambient' {

  var ambientCounter: number;
}

declare var globalRegistry: { count: number };

export function readCounter(): number {
  return globalRegistry.count;
}
