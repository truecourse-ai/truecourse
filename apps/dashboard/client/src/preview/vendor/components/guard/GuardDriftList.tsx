/**
 * The Runs view's MIDDLE column, the selected run's FULL results. The non-pass
 * results lead, severity-grouped (fail → error → stale → orphaned, most severe
 * first) with a tinted header per group, followed by a collapsible "passed"
 * group.
 *
 * A row is the shared {@link GuardTestListRow}, the ONE row anatomy every guard
 * list wears: the wrapped title, then a chip line led by the status word. Nothing
 * per-row rides along: the duration and the failure excerpt are in the instance
 * detail one click away.
 *
 * The list itself is the shared {@link EntityList}: severity groups are its
 * groups, the passed group is a collapsible one, and the preview/pin interaction
 * and scroll-to-selection come from there rather than from a second
 * implementation.
 */

import type { GuardScenarioResult } from '@/preview/vendor/shared';
import { EntityList, type EntityListGroup } from '@/preview/ui/entity-list';
import { guardStatusMeta } from '@/preview/vendor/lib/guard-status';
import { guardTestStatusView } from '@/preview/vendor/lib/guard-flow-status';
import { GUARD_DRIFT_ORDER } from '@/preview/vendor/lib/guard-drifts';
import { GuardTestListRow, type GuardTestListRowData } from '@/preview/vendor/components/guard/GuardTestListRow';

/**
 * Passes are auto-expanded up to this count; beyond it the group collapses by
 * default so a long green list never buries the failures above it. An all-green
 * run (no drifts) always expands, the passes are then the point of the view.
 */
export const PASS_GROUP_EXPAND_MAX = 10;

/** A run result as the shared row's data. */
function resultRow(result: GuardScenarioResult): GuardTestListRowData {
  return {
    id: result.id,
    title: result.title,
    status: guardTestStatusView({
      outcome: result.outcome,
      ...(result.stage ? { stage: result.stage } : {}),
    }),
  };
}

export function GuardDriftList({
  drifts,
  passed,
  activeId,
  onPreview,
  onPin,
}: {
  /** Already ordered fail → error → stale → orphaned by `orderGuardDrifts`. */
  drifts: GuardScenarioResult[];
  /** The run's passing results, original order. */
  passed: GuardScenarioResult[];
  activeId: string | null;
  onPreview: (id: string) => void;
  onPin: (id: string) => void;
}) {
  const hasDrifts = drifts.length > 0;
  const passMeta = guardStatusMeta('pass');
  const showPassGroup = passed.length > 0 || !hasDrifts;

  const groups: EntityListGroup<GuardScenarioResult>[] = GUARD_DRIFT_ORDER.map((outcome) => {
    const rows = drifts.filter((d) => d.outcome === outcome);
    const meta = guardStatusMeta(outcome);
    return {
      key: outcome,
      label: meta.label,
      name: `${meta.label} tests`,
      count: rows.length,
      // Stale/orphaned name their mechanism, not their meaning, one muted
      // line says why these tests have no result (they never ran).
      ...(meta.hint ? { hint: meta.hint } : {}),
      tone: meta.badge,
      items: rows,
    };
  }).filter((g) => (g.items?.length ?? 0) > 0);

  if (showPassGroup) {
    groups.push({
      key: 'pass',
      label: passMeta.label,
      name: 'passed tests',
      count: passed.length,
      tone: passMeta.badge,
      collapsible: true,
      defaultOpen: !hasDrifts || passed.length <= PASS_GROUP_EXPAND_MAX,
      items: passed,
    });
  }

  return (
    <EntityList<GuardScenarioResult>
      label="Run results"
      groups={groups}
      itemId={(r) => r.id}
      activeId={activeId}
      onOpen={(id, pinned) => (pinned ? onPin(id) : onPreview(id))}
      renderRow={(result) => <GuardTestListRow row={resultRow(result)} />}
    />
  );
}
