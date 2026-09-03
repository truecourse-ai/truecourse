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
  GUARD_FLOW_STATUS_WORD,
  guardTestStatusView,
  type GuardFlowPlainStatus,
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

/**
 * The surface a test id names. Generated ids are `<flow-id>.<surface>.<n>`
 * (`serialize.ts`), so a RUN result — which carries no surface field of its own —
 * still reads its lead line from the same vocabulary the inventory row does. Only
 * a segment the driver registry knows counts; anything else (a hand-written id,
 * a future shape) is simply "Test".
 */
export function guardTestSurface(id: string): GuardDriverId | undefined {
  const parts = id.split('.');
  if (parts.length < 3) return undefined;
  const candidate = parts[parts.length - 2];
  return guardDriver(candidate as GuardDriverId) ? (candidate as GuardDriverId) : undefined;
}

// ---------------------------------------------------------------------------
// The Tests list FILTER — the status domain, counted over the SAME rows the list
// filters (the Flows-tab pattern), plus the birth/run split of the failures.
// ---------------------------------------------------------------------------

/** What the Tests list narrows to: one status word, or every committed test. */
export type GuardTestFilter = GuardFlowPlainStatus | 'all';

/** One filter as a chip / option: its key, its word, and how many tests match. */
export interface GuardTestFilterCount {
  key: GuardTestFilter;
  label: string;
  count: number;
}

/** The ONE predicate the list filters by and the counts are derived from. */
export function guardTestMatchesFilter(test: GuardTestRow, filter: GuardTestFilter): boolean {
  return filter === 'all' || test.status.plain === filter;
}

/** Every status filter with its count, severity-led, over the given rows. */
export function guardTestFilterCounts(tests: readonly GuardTestRow[]): GuardTestFilterCount[] {
  return GUARD_FLOW_STATUS_ORDER.map((key) => ({
    key,
    label: GUARD_FLOW_STATUS_WORD[key],
    count: tests.filter((t) => t.status.plain === key).length,
  }));
}

/**
 * How the failing tests failed: at BIRTH (the execution that wrote them — guard
 * commits those red) or in a RUN. The split reads the stage the latest result
 * carried, so it moves the moment a run covers a birth-red test.
 */
export function guardFailingSplit(tests: readonly GuardTestRow[]): { birth: number; run: number } {
  const failing = tests.filter((t) => t.status.plain === 'failing');
  const birth = failing.filter((t) => t.status.birth).length;
  return { birth, run: failing.length - birth };
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
      // The row wears its FIRST driver: the list is one surface per row, and a
      // scenario spanning surfaces reads under the one its steps open with.
      ...(s.drivers?.[0] ? { surface: s.drivers[0] } : {}),
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
