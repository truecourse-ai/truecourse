/**
 * Dense single-line template with a nested template inside a conditional
 * substitution — extracting the inner expression to a variable would make
 * the code easier to scan.
 */

export function formatTaskRunId(suffix: string, attempt?: number): string {
  // VIOLATION: code-quality/deterministic/nested-template-literal
  return `task-run-${suffix}${attempt && attempt > 1 ? `-att${attempt}` : ''}`;
}
