/**
 * One test of a run of the stored FLOW TESTS, as it went in THIS run: the
 * flow's title and the run's outcome over the flow-test body, fed this run
 * alone. Like a scenario result it opens in place, since a run is history, and
 * "open this flow" goes to the flow's current state, its spec and its seed.
 */

import { ArrowUpRight } from 'lucide-react';
import type { FlowTestRunResult, GuardRunFlow } from '@truecourse/shared';
import { FLOW_TEST_OUTCOME_STATUS } from '@/lib/guard-flow-status';
import { GuardFlowStatusChip } from '@/components/guard/GuardStatusBadge';
import { GuardFlowTestBody } from '@/components/guard/GuardFlowTestBody';

export function GuardFlowTestRunDetail({
  repoId,
  result,
  runId,
  runFlow,
  onOpenFlow,
}: {
  repoId: string;
  result: FlowTestRunResult;
  runId: string;
  /** The flow the test proves, joined onto the run payload (`runFlows`). */
  runFlow: GuardRunFlow | null;
  onOpenFlow: (flowId: string) => void;
}) {
  const status = FLOW_TEST_OUTCOME_STATUS[result.outcome];
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-background">
      <div data-pane className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overflow-x-hidden">
        <div className="min-w-0 shrink-0 border-b border-border bg-card px-6 py-4">
          <h2 className="break-words text-sm font-semibold text-foreground">{runFlow?.title ?? result.flowId}</h2>
          <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-2">
            <GuardFlowStatusChip status={status.plain} word={status.word} />
            <span className="text-[11px] text-muted-foreground">As of run {runId}</span>
          </div>
          <button
            type="button"
            onClick={() => onOpenFlow(result.flowId)}
            className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
          >
            open this flow
            <ArrowUpRight className="h-3 w-3" />
          </button>
        </div>
        <div className="flex min-w-0 flex-1 flex-col px-6 py-4">
          <GuardFlowTestBody
            repoId={repoId}
            test={{ status: result.outcome === 'pass' ? 'passing' : 'failing', summary: '', run: result.run }}
            ran={result}
          />
        </div>
      </div>
    </div>
  );
}
