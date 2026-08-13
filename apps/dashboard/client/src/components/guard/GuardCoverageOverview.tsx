/**
 * The coverage pane AT REST — the corpus-wide OVERVIEW a reader sees before any
 * document is selected. Read-only by design: NOTHING here is clickable. The
 * sidebar beside it is where a doc is opened; this pane answers "where does the
 * whole corpus stand" at a glance, and stops.
 *
 * THE FORM IS A COMPOSITION BAR, not a wall of numbers: each store rolls up as
 * one part-to-whole strip (sections, claims, flows, tests), segments in the
 * guard status vocabulary, worst first, with a legend naming every bucket and
 * its count. The legend is load-bearing, not decoration — two of the tiers
 * share a hue family (deliberately, everywhere in guard), and the grey tier is
 * grey on purpose, so the words + counts are what carry exact identity; the bar
 * carries the SHAPE. Segments keep a 2px surface gap (the mark spec, and the
 * secondary encoding that keeps the near-pairs legal).
 *
 * Palette: the guard four-colour vocabulary (red wrong / green proven / blue
 * waiting / grey nobody's-to-do), validated for adjacency in both modes. The
 * blue tier splits into two steps HERE ONLY (sky-600 vs sky-400) because two
 * blue buckets sit adjacent inside one bar — everywhere else they deliberately
 * share one blue and are never adjacent fills.
 *
 * Every number is a straight read of a store the page already trusts:
 * `specs/corpus.json` (documents), `guard/status` (sections, flows, tests,
 * surfaces, freshness), the claims view's own totals (the coverage ledger).
 * Numbers that need a generate render only once one exists — a fresh repo shows
 * the document line and one honest "nothing generated yet" sentence, never a
 * wall of zeros pretending to be a report.
 */

import { useEffect, useState } from 'react';
import {
  GUARD_COVERAGE_PLAIN_ORDER,
  GUARD_COVERAGE_STATUS_WORD,
  GUARD_DRIVERS,
  formatRelativeTime,
} from '@truecourse/shared';
import type {
  GuardClaimsView,
  GuardCoveragePlainStatus,
  GuardFlowsView,
  GuardStaleness,
  GuardStatusSummary,
} from '@truecourse/shared';
import * as api from '@/lib/api';

const LABEL = 'text-[10px] font-medium uppercase tracking-wider text-muted-foreground';

/** One bucket of a composition bar: its word, its count, its fill class. */
interface Segment {
  word: string;
  count: number;
  fill: string;
}

/** The five coverage words in their own worst-first order, in the four-colour
 *  vocabulary (blue split into two steps — see the file comment). */
const PLAIN_FILL: Record<GuardCoveragePlainStatus, string> = {
  failed: 'bg-red-500',
  blocked: 'bg-sky-600',
  'never-run': 'bg-sky-400',
  succeeded: 'bg-emerald-500',
  'not-testable': 'bg-slate-400',
};

function fiveWordSegments(byStatus: Record<GuardCoveragePlainStatus, number>): Segment[] {
  return GUARD_COVERAGE_PLAIN_ORDER.map((word) => ({
    word: GUARD_COVERAGE_STATUS_WORD[word],
    count: byStatus[word],
    fill: PLAIN_FILL[word],
  }));
}

/**
 * One part-to-whole strip: the label row with its total, the bar, the legend.
 * Zero-count buckets vanish from bar AND legend (the chips' own rule); a bar
 * whose total is zero renders nothing — the caller says why instead.
 */
function CompositionBar({
  label,
  segments,
  note,
  totalLabel,
}: {
  label: string;
  segments: Segment[];
  note?: string;
  /** Overrides the right-side total — for a UNION bar whose segments overlap. */
  totalLabel?: string;
}) {
  const shown = segments.filter((s) => s.count > 0);
  const total = shown.reduce((n, s) => n + s.count, 0);
  if (total === 0) return null;
  return (
    <section aria-label={label} className="min-w-0">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className={LABEL}>{label}</span>
        <span className="text-[11px] tabular-nums text-muted-foreground">{totalLabel ?? total}</span>
      </div>
      {/* The strip: thin, rounded, one flex row; each fill keeps the 2px surface
          gap. `min-w` keeps a 1-of-200 bucket visible as a sliver. */}
      <div
        role="img"
        aria-label={`${label}: ${shown.map((s) => `${s.count} ${s.word.toLowerCase()}`).join(', ')}`}
        className="flex h-2.5 w-full gap-[2px] overflow-hidden rounded"
      >
        {shown.map((s) => (
          <div
            key={s.word}
            className={`${s.fill} min-w-[4px]`}
            style={{ flexGrow: s.count, flexBasis: 0 }}
          />
        ))}
      </div>
      {/* The legend carries the exact values — the bar is the shape, the words
          are the identity. Never color alone. */}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        {shown.map((s) => (
          <span key={s.word} className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${s.fill}`} />
            {s.word}
            <span className="tabular-nums text-foreground">{s.count}</span>
          </span>
        ))}
      </div>
      {note && <p className="mt-1 text-[11px] text-muted-foreground">{note}</p>}
    </section>
  );
}

export function GuardCoverageOverview({
  repoId,
  docsCount,
  claims,
  staleness,
  reloadKey = 0,
  prRef,
}: {
  repoId: string;
  /** The curated corpus's kept-doc count. */
  docsCount: number;
  /** The claims view the page already holds; null while loading / before extract. */
  claims: GuardClaimsView | null;
  staleness: GuardStaleness;
  /** Bumped on a generate/run completion → refetch the summary. */
  reloadKey?: number;
  /** EE PR scope. */
  prRef?: string;
}) {
  const [status, setStatus] = useState<GuardStatusSummary | null>(null);
  const [flowsView, setFlowsView] = useState<GuardFlowsView | null>(null);
  useEffect(() => {
    let cancelled = false;
    api
      .getGuardStatus(repoId, prRef)
      .then((s) => !cancelled && setStatus(s))
      .catch(() => !cancelled && setStatus(null));
    api
      .getGuardFlows(repoId, prRef)
      .then((v) => !cancelled && setFlowsView(v))
      .catch(() => !cancelled && setFlowsView(null));
    return () => {
      cancelled = true;
    };
  }, [repoId, prRef, reloadKey]);

  const coverage = status?.coverage ?? null;
  const lastGenerate = status?.lastGenerate ?? null;
  const lastRun = status?.lastRun ?? null;
  const claimTotals = claims?.extracted ? claims.totals : null;

  // The claim ledger, worst-first: the accounting hole leads, the ruled-out
  // tail closes. `untestable` counts refused STATEMENTS (not claims), so it
  // rides as a sentence under the bar, never as a segment of it.
  const claimSegments: Segment[] = claimTotals
    ? [
        { word: 'Unplanned', count: claimTotals.unplanned, fill: 'bg-red-500' },
        { word: 'Gapped', count: claimTotals.gapped, fill: 'bg-sky-400' },
        { word: 'Planned', count: claimTotals.planned, fill: 'bg-sky-600' },
        { word: 'Proven', count: claimTotals.proven, fill: 'bg-emerald-500' },
        { word: 'Dismissed', count: claimTotals.dismissed, fill: 'bg-slate-400' },
      ]
    : [];
  const claimNotes = claimTotals
    ? [
        claimTotals.untestable > 0
          ? `${claimTotals.untestable} statement${claimTotals.untestable === 1 ? '' : 's'} refused as untestable`
          : null,
        claimTotals.orphanedAnchors > 0
          ? `${claimTotals.orphanedAnchors} claim anchor${claimTotals.orphanedAnchors === 1 ? '' : 's'} no longer resolve in the live docs`
          : null,
      ]
        .filter((line): line is string => line != null)
        .join(' · ')
    : '';

  // The tests' CURRENT state: the last run's outcomes when one exists (the
  // committed-at statuses go stale the moment a run records real verdicts);
  // the generate's written split is the fallback for a corpus never run.
  const testSegments: Segment[] = lastRun
    ? [
        { word: 'Failed', count: lastRun.summary.fail, fill: 'bg-red-500' },
        { word: 'Error', count: lastRun.summary.error, fill: 'bg-red-400' },
        { word: 'Stale', count: lastRun.summary.stale, fill: 'bg-sky-600' },
        { word: 'Orphaned', count: lastRun.summary.orphaned, fill: 'bg-sky-600' },
        { word: 'Blocked', count: lastRun.summary.blocked, fill: 'bg-sky-400' },
        { word: 'Passed', count: lastRun.summary.pass, fill: 'bg-emerald-500' },
      ]
    : lastGenerate
      ? [
          { word: 'Failing', count: lastGenerate.testsFailing, fill: 'bg-red-500' },
          { word: 'Never run', count: lastGenerate.testsNeverRun, fill: 'bg-sky-400' },
          { word: 'Passing', count: lastGenerate.testsPassing, fill: 'bg-emerald-500' },
        ]
      : [];

  // Surfaces are IDENTITY, not status — the guard four colours are reserved for
  // verdicts, so this bar wears NEUTRAL steps (a slate ramp): the legend words
  // carry which driver is which, the bar carries the shape, and no segment can
  // be misread as a verdict. The counts are the SAME derivation the Tests tab's
  // driver filter uses: each flow's step-level drivers — a mixed test counts
  // under every driver its steps exercise, a UNION, so the right-side label
  // names the real test total instead of summing overlapping segments.
  const SURFACE_FILL = ['bg-slate-500', 'bg-slate-400', 'bg-slate-300'];
  const flowRows = flowsView?.flows ?? [];
  const surfaceSegments: Segment[] = GUARD_DRIVERS.map((d, i) => ({
    word: d.label,
    count: flowRows.filter((f) => (f.drivers ?? []).includes(d.id)).length,
    fill: SURFACE_FILL[i % SURFACE_FILL.length]!,
  }));

  return (
    <div className="h-full min-w-0 overflow-y-auto overflow-x-hidden px-6 py-4">
      <div className="mx-auto max-w-2xl space-y-5">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Coverage overview</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {docsCount} document{docsCount === 1 ? '' : 's'}
            {coverage
              ? ` · ${coverage.totalSections} sections bound by flows · ${coverage.withScenarios} with tests`
              : ''}
            {' — select a document on the left to read its sections.'}
          </p>
        </div>

        {coverage ? (
          <>
            <CompositionBar label="Sections" segments={fiveWordSegments(coverage.byStatus)} />
            <CompositionBar
              label="Claims"
              segments={claimSegments}
              {...(claimNotes ? { note: claimNotes } : {})}
            />
            <CompositionBar label="Flows" segments={fiveWordSegments(coverage.flows.byStatus)} />
            <CompositionBar label="Tests" segments={testSegments} />

            <CompositionBar
              label="Surfaces"
              segments={surfaceSegments}
              totalLabel={`${flowRows.length} tests`}
            />
          </>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            Nothing generated yet — coverage appears after the first generate.
          </p>
        )}

        {(lastGenerate || lastRun) && (
          <section aria-label="Freshness" className="min-w-0 space-y-0.5">
            <div className={`${LABEL} mb-1`}>Freshness</div>
            {lastGenerate && (
              <p className="text-[11px] text-muted-foreground">
                Generated {formatRelativeTime(lastGenerate.generatedAt)}
              </p>
            )}
            {lastRun && (
              <p className="text-[11px] text-muted-foreground">
                Ran {formatRelativeTime(lastRun.ranAt)}
                {lastRun.branch ? ` on ${lastRun.branch}` : ''}
              </p>
            )}
            {staleness.generateStale && (
              <p className="text-[11px] text-sky-600 dark:text-sky-400">
                The spec corpus changed since the last generate.
              </p>
            )}
            {staleness.runStale && (
              <p className="text-[11px] text-sky-600 dark:text-sky-400">
                The tests changed since the last run.
              </p>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
