/**
 * The Flows tab's MAIN-PANE OVERVIEW — the FILTER DASHBOARD for the list beside
 * it. The corpus in the list's own words (total · Passing · Failing · Blocked ·
 * Not generated · Not in specs), each count a BUTTON that narrows the list to it,
 * so nothing here is a number a reader can't act on. The counts come from the
 * same flows payload the panel filters and are derived by the same predicate, so
 * a chip can never promise rows the list won't show.
 *
 * Below the chips: the preparation-recipe card, ONE line for the last generate
 * (when · how many flows it worked · what it cost), and — when there is any — the
 * one housekeeping line for flows that retry next time. Everything the old
 * overview carried besides that (the call tallies, the authored/birth-passed
 * counts, the per-error accordion, the findings list) named nothing visible on
 * this tab; a flow says its own status in the list, and a test says its own
 * result on the Tests tab.
 */

import { FileCode2, Loader2 } from 'lucide-react';
import type {
  GuardFlowListItem,
  GuardGenerateReport,
  GuardRecipeCard as GuardRecipeCardData,
} from '@truecourse/shared';
import { EmptyState } from '@/components/ui/empty-state';
import { formatGuardTime } from '@/lib/guard-drifts';
import { changedFlowCount, retryPendingCount } from '@/lib/guard-report';
import { guardFlowFilterCounts, type GuardFlowFilter } from '@/lib/guard-flow-status';
import { GuardRecipeCard } from './GuardRecipeCard';
import { GuardBlockedPanel, type BlockedConflictRow } from './GuardBlockedPanel';

const LABEL = 'text-[10px] font-semibold uppercase tracking-wider text-muted-foreground';

/** The corpus as clickable counts — the list's filter, said in numbers. */
function GuardFlowFilterChips({
  flows,
  filter,
  onFilter,
}: {
  flows: readonly GuardFlowListItem[];
  filter: GuardFlowFilter;
  onFilter: (filter: GuardFlowFilter) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Flow filters">
      {guardFlowFilterCounts(flows).map(({ key, label, count }) => {
        const active = filter === key;
        return (
          <button
            key={key}
            type="button"
            aria-pressed={active}
            onClick={() => onFilter(key)}
            className={`flex items-center gap-1.5 rounded border px-2.5 py-1.5 transition-colors ${
              active
                ? 'border-primary bg-primary/10'
                : 'border-border bg-muted/30 hover:bg-muted/60'
            }`}
          >
            <span className="text-sm font-semibold text-foreground">{count}</span>
            <span className="text-xs text-muted-foreground">{label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** The last generate as ONE line, plus the one retry line. */
function GuardLastGenerateLine({ report }: { report: GuardGenerateReport }) {
  const changed = changedFlowCount(report);
  const retry = retryPendingCount(report);
  const parts = [
    formatGuardTime(report.generatedAt),
    ...(changed != null ? [`${changed} flow${changed === 1 ? '' : 's'} changed`] : []),
    ...(report.usage ? [`$${report.usage.costUsd.toFixed(2)}`] : []),
  ];

  return (
    <div className="space-y-1">
      <div className={LABEL}>Last generate</div>
      <p className="text-[13px] text-foreground">{parts.join(' · ')}</p>
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
  flows,
  filter,
  onFilter,
  loading,
  error,
  conflicts = null,
  onOpenConflict,
  emptyTitle = 'No flows yet',
}: {
  recipe: GuardRecipeCardData | null;
  report: GuardGenerateReport | null;
  /** The SAME rows the left panel filters — the chips count these, nothing else. */
  flows: readonly GuardFlowListItem[];
  /** The list's active filter (shared state), so the active chip reads as pressed. */
  filter: GuardFlowFilter;
  /** Apply a filter to the list; `all` clears it. */
  onFilter: (filter: GuardFlowFilter) => void;
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

  const empty = flows.length === 0 && !recipe && !report;

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
        {flows.length > 0 && <GuardFlowFilterChips flows={flows} filter={filter} onFilter={onFilter} />}
        {recipe && <GuardRecipeCard recipe={recipe} />}
        {report && <GuardLastGenerateLine report={report} />}
      </div>
    </div>
  );
}
