/**
 * What the merged Flows surface needs from the TEST inventory (`/guard/scenarios`).
 *
 * There is no test list and no test row model any more: a flow and its test are
 * ONE entity, read on the flow. ONE fact is still only the inventory's, so this
 * module is the index over it: which DOCUMENT a test binds to, the merged
 * detail's Spec footer row (a hand-written test's only spec pointer: it has no
 * milestones).
 */

import type { GuardScenarioRowData } from '@/hooks/useGuardScenarios';

/** The document a test binds to, in the shape the scenario view reads it. */
export interface GuardTestBinds {
  doc: string;
}

/** test id → the document it binds to. */
export function guardTestBinds(
  scenarios: readonly GuardScenarioRowData[],
): ReadonlyMap<string, GuardTestBinds> {
  return new Map(scenarios.map((s) => [s.id, { doc: s.doc }]));
}
