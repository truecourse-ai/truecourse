/**
 * Negative fixture for code-quality/deterministic/restricted-types.
 *
 * A callback parameter typed as the bare `Function` wrapper instead of a
 * precise call signature — unsafe to invoke and exactly the loose typing
 * this rule is meant to catch.
 */

// VIOLATION: code-quality/deterministic/restricted-types
export function runLater(task: Function): void {
  setTimeout(() => task(), 0);
}
