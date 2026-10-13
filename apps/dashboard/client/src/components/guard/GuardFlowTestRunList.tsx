/**
 * A run of the stored FLOW TESTS, as the run page's results column: one row per
 * test, named by its flow and wearing the run's own outcome. The tests that did
 * not pass lead in one group, followed by a collapsible passed group.
 */

import type { FlowTestRunResult, GuardRunFlow } from '@truecourse/shared';
import { EntityList, type EntityListGroup } from '@/dashboard/ui/entity-list';
import { guardStatusMeta } from '@/lib/guard-status';
import { FLOW_TEST_OUTCOME_STATUS } from '@/lib/guard-flow-status';
import { GuardTestListRow } from '@/components/guard/GuardTestListRow';
import { PASS_GROUP_EXPAND_MAX } from '@/components/guard/GuardDriftList';

export function GuardFlowTestRunList({
  results,
  runFlows,
  activeId,
  onPreview,
  onPin,
}: {
  results: FlowTestRunResult[];
  /** The flows the run's tests prove, for their titles. */
  runFlows: GuardRunFlow[];
  /** The open result's flow id. */
  activeId: string | null;
  onPreview: (flowId: string) => void;
  onPin: (flowId: string) => void;
}) {
  const titleOf = new Map(runFlows.map((flow) => [flow.flowId, flow.title]));
  const title = (result: FlowTestRunResult): string => titleOf.get(result.flowId) ?? result.flowId;
  const sorted = [...results].sort((a, b) => title(a).localeCompare(title(b)));
  const failed = sorted.filter((r) => r.outcome !== 'pass');
  const passed = sorted.filter((r) => r.outcome === 'pass');

  const groups: EntityListGroup<FlowTestRunResult>[] = [];
  if (failed.length > 0) {
    groups.push({
      key: 'fail',
      label: FLOW_TEST_OUTCOME_STATUS.fail.word,
      name: 'failed tests',
      count: failed.length,
      tone: guardStatusMeta('fail').badge,
      items: failed,
    });
  }
  if (passed.length > 0 || failed.length === 0) {
    groups.push({
      key: 'pass',
      label: FLOW_TEST_OUTCOME_STATUS.pass.word,
      name: 'passed tests',
      count: passed.length,
      tone: guardStatusMeta('pass').badge,
      collapsible: true,
      defaultOpen: failed.length === 0 || passed.length <= PASS_GROUP_EXPAND_MAX,
      items: passed,
    });
  }

  return (
    <EntityList<FlowTestRunResult>
      label="Run results"
      groups={groups}
      itemId={(r) => r.flowId}
      activeId={activeId}
      onOpen={(id, pinned) => (pinned ? onPin(id) : onPreview(id))}
      renderRow={(result) => (
        <GuardTestListRow
          row={{ id: result.flowId, title: title(result), status: FLOW_TEST_OUTCOME_STATUS[result.outcome] }}
        />
      )}
    />
  );
}
