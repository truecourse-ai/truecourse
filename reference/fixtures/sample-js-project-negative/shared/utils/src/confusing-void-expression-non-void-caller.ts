/**
 * Paraphrased true-bug for code-quality/deterministic/confusing-void-expression.
 *
 * The arrow's return type is `Promise<unknown>` (not void), so returning
 * a void-typed value silently coerces to `undefined`. The call site
 * looks like it's forwarding a real value when it isn't — the case the
 * rule is meant to catch.
 */

function notifyAuditLog(): void {
  // pretend to enqueue an audit-log event
}

// VIOLATION: code-quality/deterministic/confusing-void-expression
export const submitTask = async (): Promise<unknown> => {
  const result = notifyAuditLog();
  return result;
};
