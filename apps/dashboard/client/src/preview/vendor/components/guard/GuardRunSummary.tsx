// PREVIEW (UI mock, fake data): delete when the one-product dashboard lands. See docs/ONE_PRODUCT_PLAN.md §3.5.
// Copied from the agentic branch's apps/dashboard/client/src/components/guard/GuardRunSummary.tsx; delete with the preview.
/**
 * The Runs view's LEFT panel, THE reading of the selected run: its envelope
 * (ranAt · branch @ commit · recipe fingerprint), how long it took, and the history
 * that switches between runs. Clicking a history row retargets the whole view to
 * that run. Read-only.
 *
 * It carries NO outcome tally. The results list in the middle column is grouped by
 * outcome and counts each group, so a tally card here was the same numbers a second
 * time, and two places that count one run are two places that can disagree.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import type { GuardHistoryEntry, GuardLatest, GuardOutcome } from '@/preview/vendor/shared';
import { CHIP_CLASS } from '@/preview/ui/bits';
import { EntityList } from '@/preview/ui/entity-list';
import { coverageVersionById } from '@/preview/data/corpus';
import { HoverPopover } from '@/preview/ui/hover-popover';
import {
  GUARD_OUTCOMES,
  formatGuardDuration,
  formatGuardTime,
  guardRunRef,
  shortRunId,
} from '@/preview/vendor/lib/guard-drifts';
import { guardStatusMeta } from '@/preview/vendor/lib/guard-status';

function HistoryRow({ entry: h }: { entry: GuardHistoryEntry }) {
  const verdict: GuardOutcome = h.summary.fail > 0 || h.summary.error > 0 ? 'fail' : 'pass';
  return (
    <>
      <span className="flex w-full items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-foreground">{h.commit ?? shortRunId(h.runId)}</span>
        <span className="inline-flex shrink-0 items-center gap-1.5 text-[10px] font-medium text-foreground">
          <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${guardStatusMeta(verdict).dot}`} />
          {verdict === 'fail' ? 'Failed' : 'Passed'}
        </span>
      </span>
      <span className="flex w-full items-center gap-2 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-2 tabular-nums">
          {GUARD_OUTCOMES.filter((o) => h.summary[o] > 0).map((o) => (
            <HoverPopover key={o} portal width="narrow" content={`${h.summary[o]} ${guardStatusMeta(o).label}`}>
              <span className="inline-flex items-center gap-1 text-[10px] text-foreground">
                <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${guardStatusMeta(o).dot}`} />
                {h.summary[o]}
              </span>
            </HoverPopover>
          ))}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {h.pullRequest != null && <span className={CHIP_CLASS}>#{h.pullRequest}</span>}
          {h.origin === 'local' && <span className={CHIP_CLASS}>local</span>}
          {formatGuardTime(h.ranAt)}
        </span>
      </span>
    </>
  );
}

function coverageVersionLabel(repoId: string, id: string): string {
  const v = coverageVersionById(repoId, id);
  return v ? `${v.label} · ${v.sha}` : id;
}

export function GuardRunSummary({
  repoId,
  run,
  history,
  selectedRunId,
  onSelectRun,
}: {
  repoId: string;
  /** The selected run, its envelope and its duration. Null before the first load. */
  run?: GuardLatest | null;
  history: GuardHistoryEntry[];
  selectedRunId: string | null;
  onSelectRun: (runId: string) => void;
}) {
  const [originFilter, setOriginFilter] = useState<string[]>([]);
  const originOptions = useMemo(
    () =>
      (['hosted', 'local'] as const)
        .map((key) => ({ key, label: key, count: history.filter((h) => (h.origin ?? 'hosted') === key).length }))
        .filter((o) => o.count > 0),
    [history],
  );
  const recent = [...history].sort((a, b) => b.ranAt.localeCompare(a.ranAt));
  const env = run?.run;
  const ref = env ? guardRunRef(env) : null;
  const totalMs = (run?.scenarios ?? []).reduce((n, s) => n + s.durationMs, 0);

  return (
    <div role="region" aria-label="Run summary" className="flex h-full min-h-0 flex-col">
      {env && run && (
        <div className="border-b border-border px-3 py-2.5">
          <div className="flex items-center gap-2">
            <span className="text-[13px] text-foreground">{formatGuardTime(env.ranAt)}</span>
            <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{formatGuardDuration(totalMs)}</span>
          </div>
          {ref && <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">{ref}</div>}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            {env.pullRequest != null && <span className={CHIP_CLASS}>#{env.pullRequest}</span>}
            {env.origin && <span className={CHIP_CLASS}>{env.origin}</span>}
            {env.coverageVersion && (
              <Link
                to={`/preview/repos/${repoId}/corpus?version=${encodeURIComponent(env.coverageVersion)}`}
                className="ml-auto inline-flex items-center gap-1 text-foreground hover:underline"
              >
                coverage {coverageVersionLabel(repoId, env.coverageVersion)}
                <ArrowUpRight className="h-3 w-3" />
              </Link>
            )}
          </div>
        </div>
      )}

      {/* Run history: the shared list. Search by PR number, commit or branch;
          the Pull request filter is chips while there are few and a
          type-to-narrow box beyond a dozen. */}
      <div className="min-h-0 flex-1">
        <EntityList<GuardHistoryEntry>
          label="Run history"
          items={recent}
          itemId={(h) => h.runId}
          activeId={selectedRunId}
          onOpen={(id) => onSelectRun(id)}
          search={{
            placeholder: 'Search runs (PR, commit, branch)',
            ariaLabel: 'Search runs',
            match: (h, q) =>
              (h.pullRequest != null && `#${h.pullRequest}`.includes(q)) ||
              (h.commit ?? '').toLowerCase().includes(q) ||
              (h.branch ?? '').toLowerCase().includes(q),
          }}
          filter={{
            label: 'Origin',
            ariaLabel: 'Filter runs by origin',
            options: originOptions,
            selected: originFilter,
            onChange: setOriginFilter,
            match: (h, key) => (h.origin ?? 'hosted') === key,
          }}
          renderRow={(h) => <HistoryRow entry={h} />}
          emptyText="No run recorded yet."
        />
      </div>
    </div>
  );
}
