// PREVIEW (UI mock, fake data): delete when the one-product dashboard lands. See docs/ONE_PRODUCT_PLAN.md §3.5.
// Copied from the agentic branch's apps/dashboard/client/src/lib/guard-tests.ts; delete with the preview.
/**
 * What the merged Flows surface needs from the TEST inventory (`/guard/scenarios`).
 *
 * There is no test list and no test row model any more: a flow and its test are
 * ONE entity, read on the flow. ONE fact is still only the inventory's, so this
 * module is the index over it: which spec SECTION a test binds to, the merged
 * detail's Spec footer row (a hand-written test's only spec pointer: it has no
 * milestones).
 */

import type { GuardScenarioRowData } from '@/preview/vendor/hooks/useGuardScenarios';

/** The spec section a test binds to, in the shape the scenario view reads it. */
export interface GuardTestBinds {
  doc: string;
  section: string;
  headingText?: string;
}

/** test id → the spec section it binds to. */
export function guardTestBinds(
  scenarios: readonly GuardScenarioRowData[],
): ReadonlyMap<string, GuardTestBinds> {
  return new Map(
    scenarios.map((s) => [
      s.id,
      { doc: s.doc, section: s.anchor, ...(s.headingText ? { headingText: s.headingText } : {}) },
    ]),
  );
}
