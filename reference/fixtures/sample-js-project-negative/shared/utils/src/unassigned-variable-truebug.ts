/**
 * Negative fixture for bugs/deterministic/unassigned-variable.
 *
 * The rule should still fire when a `let` is declared without an initializer
 * and never assigned anywhere within the function (including in nested
 * closures it could plausibly delegate to).
 */

export function computeDefaultTimeout(): number {
  // VIOLATION: bugs/deterministic/unassigned-variable
  let timeoutMs: number;
  return timeoutMs + 1000;
}
