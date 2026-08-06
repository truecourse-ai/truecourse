/**
 * The Flows tab's MAIN-PANE OVERVIEW — the FILTER DASHBOARD for the list beside
 * it. The corpus in the list's own words (total · Passing · Failing · Blocked ·
 * Not generated · Not in specs), each count a BUTTON that narrows the list to it,
 * so nothing here is a number a reader can't act on. The counts come from the
 * same flows payload the panel filters and are derived by the same predicate, so
 * a chip can never promise rows the list won't show.
 *
 * Below the chips: the preparation-recipe card, ONE line for the last generate
 * (when · how many flows it worked · what it cost), the one housekeeping line for
 * flows that retry next time, WHAT FAILED (errors grouped by message shape) and
 * WHAT SHIPPED UNADJUDICATED (a verdict stage that lost every call), both only when
 * the run recorded any. Everything else the old overview carried (the call
 * tallies, the authored/birth-passed counts, the per-error accordion, the findings
 * list) named nothing visible on this tab; a flow says its own status in the list,
 * and a test says its own result on the Tests tab.
 *
 * The errors block is not a return of that accordion. Errors reached this screen as
 * a COUNT only, and a generate that wrote zero tests because one line of `recipe.json`
 * was half-finished therefore said nothing anywhere: the count was consumed by the
 * "will retry" line, which was itself a promise the next run could not keep. Grouping
 * is what makes it readable — N near-identical errors are one fact, said once.
 */

import { FileCode2, Loader2 } from 'lucide-react';
import type {
  GuardFlowListItem,
  GuardGenerateError,
  GuardGenerateReport,
  GuardRecipeCard as GuardRecipeCardData,
  GuardUnadjudicatedStage,
} from '@truecourse/shared';
import { GUARD_UNADJUDICATED_REMEDY, guardUnadjudicatedEffect } from '@truecourse/shared';
import { EmptyState } from '@/components/ui/empty-state';
import { formatGuardTime } from '@/lib/guard-drifts';
import { changedFlowCount, groupErrorsByPattern, retryPendingCount } from '@/lib/guard-report';
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
      {/* A REFUSED run leaves every flow unsettled, but "will retry" is exactly the
          wrong promise there: the next generate is declined identically until the
          configuration is fixed. The errors block below says what to fix instead. */}
      {retry > 0 && !report.refusal && (
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          {retry} flow{retry === 1 ? '' : 's'} will retry next generate.
        </p>
      )}
    </div>
  );
}

/**
 * What the last generate FAILED on, grouped by message shape, most-affected first.
 *
 * This is the block whose absence made a run-level refusal invisible: 49 identical
 * errors were recorded in `result.json`, the overview consumed only their COUNT, and
 * nothing on any screen said WHAT they were. One line per shape, with the sections it
 * affected — so "49 sections · external service hit-pay is only partly configured"
 * reads as one config fact, which is what it is.
 *
 * A REFUSAL leads, and says so: it is not the run's most numerous error, it is the
 * reason the run produced nothing at all.
 */
function GuardGenerateErrors({ errors }: { errors: readonly GuardGenerateError[] }) {
  const groups = groupErrorsByPattern(errors);
  const refused = new Set(errors.filter((e) => e.kind === 'refusal').map((e) => e.message));
  const ordered = [
    ...groups.filter((g) => refused.has(g.message)),
    ...groups.filter((g) => !refused.has(g.message)),
  ];

  return (
    <div className="space-y-1">
      <div className={LABEL}>What failed</div>
      <div className="flex flex-col gap-1.5" role="list" aria-label="Generate errors">
        {ordered.map((group) => {
          const blocking = refused.has(group.message);
          return (
            <div
              key={group.pattern}
              role="listitem"
              className={`rounded border px-2.5 py-1.5 ${
                blocking ? 'border-orange-500/40 bg-orange-500/[0.07]' : 'border-border bg-muted/30'
              }`}
            >
              <div className="flex items-baseline gap-1.5">
                <span className="text-[11px] font-medium text-muted-foreground">
                  {blocking
                    ? 'run refused'
                    : `${group.sections.length} section${group.sections.length === 1 ? '' : 's'}`}
                </span>
              </div>
              <p className="whitespace-pre-wrap break-words text-[13px] leading-snug text-foreground">
                {group.message}
              </p>
            </div>
          );
        })}
      </div>
      {ordered.some((g) => refused.has(g.message)) && (
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          The run was declined before anything was built or executed — re-running changes nothing
          until this is fixed.
        </p>
      )}
    </div>
  );
}

/**
 * What shipped with NO verdict behind it. A generate whose fidelity or triage
 * stage lost every call keeps its corpus rather than aborting — those stages judge
 * content birth has already validated, so losing them costs annotation, not
 * correctness, and throwing away the run costs strictly more. The trade is only
 * honest if the screen says it: an unreviewed test must never read as a reviewed
 * one. The corpus is committed, so the fix is a re-run, not a re-author.
 */
function GuardUnadjudicated({ stages }: { stages: readonly GuardUnadjudicatedStage[] }) {
  return (
    <div className="space-y-1">
      <div className={LABEL}>Unadjudicated</div>
      <div className="flex flex-col gap-1.5" role="list" aria-label="Unadjudicated stages">
        {stages.map((s) => (
          <div
            key={s.stage}
            role="listitem"
            className="rounded border border-amber-500/40 bg-amber-500/[0.07] px-2.5 py-1.5"
          >
            <p className="text-[13px] leading-snug text-foreground">{guardUnadjudicatedEffect(s)}</p>
          </div>
        ))}
      </div>
      <p className="text-[13px] leading-relaxed text-muted-foreground">
        The stage lost every LLM call this run. {GUARD_UNADJUDICATED_REMEDY}
      </p>
    </div>
  );
}

/**
 * The third parties the analyzed repo imports, read straight off the last
 * generate report — the answer to "what does this app talk to", visible whether or
 * not any flow was blocked on one. Read-only: nothing here is a filter, because the
 * list is a fact about the CODE, not about the flows beside it.
 */
function GuardExternalServices({ services }: { services: readonly { service: string }[] }) {
  return (
    <div className="space-y-1">
      <div className={LABEL}>Third-party dependencies</div>
      <div className="flex flex-wrap gap-1.5" aria-label="Detected third-party services">
        {services.map(({ service }) => (
          <span
            key={service}
            className="rounded border border-border bg-muted/30 px-2 py-0.5 text-[12px] text-foreground"
          >
            {service}
          </span>
        ))}
      </div>
      <p className="text-[13px] leading-relaxed text-muted-foreground">
        Detected from this repo&rsquo;s imports and the URLs it calls. Scenarios never reach them — a
        flow that needs one is
        reported blocked on it by name.
      </p>
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
            synthesize flows and write their scenarios.
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
        {report && report.errors.length > 0 && <GuardGenerateErrors errors={report.errors} />}
        {report && report.unadjudicated && report.unadjudicated.length > 0 && (
          <GuardUnadjudicated stages={report.unadjudicated} />
        )}
        {report && report.externalServices && report.externalServices.length > 0 && (
          <GuardExternalServices services={report.externalServices} />
        )}
      </div>
    </div>
  );
}
