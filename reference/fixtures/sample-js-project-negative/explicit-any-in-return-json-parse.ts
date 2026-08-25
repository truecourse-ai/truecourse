/**
 * Negative fixture for code-quality/deterministic/explicit-any-in-return.
 *
 * A plain helper that declares an `: any` return type instead of `unknown`
 * or a concrete type — the loose typing this rule is meant to catch. It is a
 * free function, not a visitor-interface method, so the carve-out must not
 * apply.
 */

// VIOLATION: code-quality/deterministic/explicit-any-in-return
export function parseConfig(text: string): any {
  return JSON.parse(text);
}
