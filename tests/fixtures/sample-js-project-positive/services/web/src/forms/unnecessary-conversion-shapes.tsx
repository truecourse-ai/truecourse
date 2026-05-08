/**
 * unnecessary-type-conversion shape that should NOT fire:
 *
 * `Boolean(a || b)` where the `||` may produce a non-boolean
 * (e.g., `Team | false`). The `Boolean(...)` wrapper normalizes
 * the result to a true boolean for use in JSX-conditional
 * rendering or strict-equality contexts.
 */

declare const isOwner: boolean;
declare const team: { id: string } | false;

export function canEdit(): boolean {
  return Boolean(isOwner || team);
}
