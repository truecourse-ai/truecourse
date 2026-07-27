/**
 * The Tests tab's row model — every committed test as ONE entity row.
 *
 * A test is the unit the user judges: it has a surface, a status, a title, and
 * the flow it belongs to. The status is the last run's outcome when a run covered
 * the test, else the status the generate COMMITTED it with — guard commits tests
 * that failed their first execution, so a fresh clone lists its red tests as red
 * ({@link guardTestStatusView}).
 *
 * Pure/client-only: the inventory read (`/guard/scenarios`) and the run join the
 * hook already performs carry everything.
 */

import { GUARD_COVERAGE_STATUS_PRECEDENCE, guardDriver } from '@truecourse/shared';
import type { GuardDriverId } from '@truecourse/shared';
import {
  GUARD_FLOW_STATUS_ORDER,
  guardTestStatusView,
  type GuardTestStatusView,
} from '@/lib/guard-flow-status';
import type { GuardScenarioRowData } from '@/hooks/useGuardScenarios';

/** One row of the Tests inventory. */
export interface GuardTestRow {
  /** The test id — its tab key and `?gtest=` address. */
  id: string;
  title: string;
  /** Repo-relative spec doc it binds to. */
  doc: string;
  anchor: string;
  /** The bound section's human heading, when the server joined one. */
  headingText?: string;
  surface?: GuardDriverId;
  /** The flow it realizes (a Manual pseudo-flow for hand-written work). */
  flowId: string;
  /** The flow's title when the corpus names it, else the test's own title. */
  flowTitle: string;
  /** True when no manifest flow authored it. */
  handWritten: boolean;
  status: GuardTestStatusView;
}

/**
 * The lead line of a row and of the test detail's header: the surface it runs on
 * and the fact that it is a TEST — "CLI test", "API test". A hand-written test
 * with no recorded driver is simply "Test".
 */
export function guardTestLabel(surface: GuardDriverId | undefined): string {
  const label = surface ? guardDriver(surface)?.label ?? surface : null;
  return label ? `${label} test` : 'Test';
}

/** Severity-led sort key — the plain status first (failing → blocked → not
 *  generated → passing), the shared worst-first precedence inside a group, then
 *  the title, so the list order never depends on read order. */
function severityKey(row: GuardTestRow): [number, number, string] {
  const rank = GUARD_COVERAGE_STATUS_PRECEDENCE.indexOf(row.status.status);
  return [
    GUARD_FLOW_STATUS_ORDER.indexOf(row.status.plain),
    rank === -1 ? GUARD_COVERAGE_STATUS_PRECEDENCE.length : rank,
    row.title,
  ];
}

/** Every committed test as a row, severity-led (bad news first). */
export function buildGuardTestRows(
  scenarios: readonly GuardScenarioRowData[],
  flowTitles: ReadonlyMap<string, string> = new Map(),
): GuardTestRow[] {
  return scenarios
    .map((s) => ({
      id: s.id,
      title: s.title,
      doc: s.doc,
      anchor: s.anchor,
      ...(s.headingText ? { headingText: s.headingText } : {}),
      ...(s.surface ? { surface: s.surface } : {}),
      flowId: s.flowId,
      flowTitle: flowTitles.get(s.flowId) ?? s.title,
      handWritten: s.handWritten,
      status: guardTestStatusView({
        outcome: s.lastResult?.outcome ?? null,
        ...(s.lastResult?.stage ? { stage: s.lastResult.stage } : {}),
        ...(s.status ? { committed: s.status } : {}),
      }),
    }))
    .sort((a, b) => {
      const [ap, as, at] = severityKey(a);
      const [bp, bs, bt] = severityKey(b);
      return ap - bp || as - bs || at.localeCompare(bt);
    });
}
