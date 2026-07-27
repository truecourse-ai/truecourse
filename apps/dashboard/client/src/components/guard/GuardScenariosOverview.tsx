/**
 * The Flows tab's MAIN-PANE OVERVIEW — what shows when the permanent Overview tab
 * is active (no flow open). The preparation-recipe card, then the last generate as
 * NUMBERS: how many flows it covered, how many tests it wrote and how those tests
 * were committed (passing / failing — guard commits both), and its LLM cost.
 *
 * Exactly ONE housekeeping line survives: "N flows will retry next generate".
 * Everything else the old overview carried — the per-error accordion, the held
 * block, the findings list — was the same news a second time, in engine words; a
 * flow says its own status on the Flows list, and a test says its own result on
 * the Tests tab.
 */

import { FileCode2, Loader2 } from 'lucide-react';
import type { GuardGenerateReport, GuardRecipeCard as GuardRecipeCardData } from '@truecourse/shared';
import { EmptyState } from '@/components/ui/empty-state';
import { formatGuardTime } from '@/lib/guard-drifts';
import { retryPendingCount, writtenTestCounts } from '@/lib/guard-report';
import { GuardRecipeCard } from './GuardRecipeCard';
import { GuardBlockedPanel, type BlockedConflictRow } from './GuardBlockedPanel';

const LABEL = 'text-[10px] font-semibold uppercase tracking-wider text-muted-foreground';

/** The last generate in numbers, plus the one retry line. */
function GuardLastGenerateStrip({ report }: { report: GuardGenerateReport }) {
  const tests = writtenTestCounts(report);
  const retry = retryPendingCount(report);
  const usage = report.usage;

  const stats: { label: string; value: string | number }[] = [
    ...(report.flows ? [{ label: 'flows', value: report.flows.total }] : []),
    { label: 'tests written', value: report.written.length },
    { label: 'passing', value: tests.passing },
    { label: 'failing', value: tests.failing },
    ...(usage
      ? [{ label: 'calls', value: usage.calls }, { label: 'cost', value: `$${usage.costUsd.toFixed(2)}` }]
      : []),
  ];

  return (
    <div className="space-y-3">
      <div className={LABEL}>Last generate</div>
      <div className="text-sm text-foreground">
        {formatGuardTime(report.generatedAt)}{' '}
        <span className="text-xs text-muted-foreground">· {report.status}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="flex items-center gap-1.5 rounded border border-border bg-muted/30 px-2.5 py-1.5"
          >
            <span className="text-sm font-semibold text-foreground">{stat.value}</span>
            <span className="text-xs text-muted-foreground">{stat.label}</span>
          </div>
        ))}
      </div>
      {retry > 0 && (
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          {retry} flow{retry === 1 ? '' : 's'} will retry next generate.
        </p>
      )}
    </div>
  );
}

export function GuardScenariosOverview({
  recipe,
  report,
  hasFlows,
  loading,
  error,
  conflicts = null,
  onOpenConflict,
  emptyTitle = 'No flows yet',
}: {
  recipe: GuardRecipeCardData | null;
  report: GuardGenerateReport | null;
  /** Whether the inventory (the left panel) has any rows. */
  hasFlows: boolean;
  loading: boolean;
  error: string | null;
  /**
   * The LIVE open conflicts, only meaningful when the report is `open-conflicts`.
   * `null` while the spec corpus is still loading (the blocked panel spins).
   */
  conflicts?: BlockedConflictRow[] | null;
  /** Route to the Coverage tab with a conflict's resolution detail open. */
  onOpenConflict?: (key: string) => void;
  /** Title of the nothing-generated-yet empty state. */
  emptyTitle?: string;
}) {
  // Generation refused to write tests while the spec corpus still carries
  // unresolved disagreements — the blocked panel replaces the whole overview and
  // lists the conflicts LIVE from the corpus, so resolving one drops it next read.
  if (report?.status === 'open-conflicts') {
    return <GuardBlockedPanel conflicts={conflicts} onOpenConflict={onOpenConflict ?? (() => {})} />;
  }

  const empty = !hasFlows && !recipe && !report;

  if (loading && empty) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (error && empty) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <p className="max-w-sm px-6 text-center text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }
  if (empty) {
    return (
      <EmptyState
        icon={FileCode2}
        title={emptyTitle}
        body={
          <>
            Run <code className="rounded bg-muted px-1 py-0.5 text-xs">truecourse guard generate</code> to
            synthesize flows and write their tests.
          </>
        }
      />
    );
  }

  return (
    <div role="region" aria-label="Generate overview" className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-6 px-5 py-5">
        {recipe && <GuardRecipeCard recipe={recipe} />}
        {report && <GuardLastGenerateStrip report={report} />}
      </div>
    </div>
  );
}
