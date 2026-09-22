/**
 * Settings › Usage: what this workspace's runs spent at the model.
 *
 * ONE control row — the period, then Add filter for Repository and Job type —
 * and everything on it is in the address, so a narrowed page is a place a link
 * can point at. The server answers ONE repository and ONE job type at a time,
 * so picking a second value along a dimension REPLACES the first: a pill the
 * answer does not honour would be a lie.
 *
 * Under it the trend: one quiet band per job type over the period's days (its
 * weeks, once a day per point stops being readable), plotting ONE measure at a
 * time — cost, input, output or cached tokens — picked beside it, and the
 * period's total once beneath it with its tokens split into input, output and
 * cached. Then the runs that spent it, four corners each, carrying the same
 * split and opening the conversation they belong to.
 *
 * Nothing is composed here: the server folded every number, named every value
 * and faceted every filter, so this page draws what it was told.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Coins } from 'lucide-react';
import {
  USAGE_PERIODS,
  usageJobTypeWord,
  type JobStatus,
  type UsagePeriod,
  type UsageMeasure,
  type UsageResponse,
  type UsageRunRow,
  type UsageTokenSplit,
} from '@truecourse/shared';
import { EmptyState } from '@/components/ui/empty-state';
import {
  RUN_STATUS_META,
  formatDuration,
  formatTokens,
  formatUsd,
  startedLabel,
} from '@/components/sessions/run-model';
import { fetchUsage } from '@/lib/api';
import { EntityList } from '@/dashboard/ui/entity-list';
import { FilterBuilder, filterKey, selectedValues } from '@/dashboard/ui/filter-builder';
import { StackedArea, type StackedSeries } from '@/dashboard/ui/stacked-area';
import {
  RUN_STATUS_TONE,
  StatusTally,
  StatusWord,
  tallyOf,
  type StatusTone,
} from '@/dashboard/ui/status-word';

/** The dimensions the filter row offers, in the order the menu lists them. */
const DIMENSION_KEYS = ['repo', 'jobType'] as const;
type DimensionKey = (typeof DIMENSION_KEYS)[number];

/** The URL parameter each dimension is spelled with. */
const PARAM: Record<DimensionKey, string> = { repo: 'repo', jobType: 'jobType' };

const DIMENSION_LABEL: Record<DimensionKey, string> = {
  repo: 'Repository',
  jobType: 'Job type',
};

/** Every parameter this page owns; nothing else on the address reaches the server. */
const OWN_PARAMS = ['period', 'from', 'to', ...Object.values(PARAM)];

const PERIOD_LABEL: Record<UsagePeriod, string> = {
  '7d': '7 days',
  '30d': '30 days',
  '90d': '90 days',
  custom: 'Custom',
};

const CHIP = 'rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors';
const CHIP_ON = 'bg-primary text-primary-foreground ring-1 ring-inset ring-current';
const CHIP_OFF = 'bg-muted text-foreground';
const DATE_FIELD =
  'rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary';

/**
 * The bands' colours. A job type is a CATEGORY, not a verdict, so the palette
 * deliberately avoids the status colours: nothing here is good or bad news.
 */
const JOB_TYPE_FILL: Record<string, { fill: string; dot: string }> = {
  'context.scan': { fill: 'fill-sky-500', dot: 'bg-sky-500' },
  'repo.guard-setup': { fill: 'fill-violet-500', dot: 'bg-violet-500' },
  'repo.guard-generate': { fill: 'fill-teal-500', dot: 'bg-teal-500' },
  'repo.guard-run': { fill: 'fill-indigo-400', dot: 'bg-indigo-400' },
};

const UNKNOWN_FILL = { fill: 'fill-slate-400', dot: 'bg-slate-400' };

/**
 * How a job's outcome reads. The four states a run record shares with the queue
 * keep the run model's own words, so one thing never wears two names; a
 * cancelled job has no run-record analog and is named here.
 */
const OUTCOME: Record<JobStatus, { word: string; tone: StatusTone }> = {
  queued: { word: RUN_STATUS_META.queued.word, tone: RUN_STATUS_TONE.queued },
  running: { word: RUN_STATUS_META.running.word, tone: RUN_STATUS_TONE.running },
  succeeded: { word: RUN_STATUS_META.completed.word, tone: RUN_STATUS_TONE.completed },
  failed: { word: RUN_STATUS_META.failed.word, tone: RUN_STATUS_TONE.failed },
  interrupted: { word: RUN_STATUS_META.interrupted.word, tone: RUN_STATUS_TONE.interrupted },
  paused: { word: RUN_STATUS_META.paused.word, tone: RUN_STATUS_TONE.paused },
  cancelled: { word: 'Cancelled', tone: 'neutral' },
};

/** Worst first, the way every tally on the product reads. */
const OUTCOME_ORDER: JobStatus[] = [
  'failed',
  'interrupted',
  'paused',
  'cancelled',
  'running',
  'queued',
  'succeeded',
];

/** What the chart can plot, in the order the picker offers it. */
const MEASURES: UsageMeasure[] = ['costUsd', 'input', 'output', 'cached'];

const MEASURE_LABEL: Record<UsageMeasure, string> = {
  costUsd: 'Cost',
  input: 'Input',
  output: 'Output',
  cached: 'Cached',
};

/** A share as a whole percent; a share too small to round to one still reads as some. */
function formatShare(share: number): string {
  const percent = Math.round(share * 100);
  return percent === 0 && share > 0 ? '<1%' : `${percent}%`;
}

/**
 * The split as one dot-separated tally. With no prompt caching reported there
 * is no cached figure and no hit rate to show, rather than a zero that reads as
 * a cache that missed.
 */
function splitWords(split: UsageTokenSplit): string {
  const words = [`${formatTokens(split.input)} input`, `${formatTokens(split.output)} output`];
  if (split.cacheHitRate !== null) {
    words.push(`${formatTokens(split.cached)} cached`, `${formatShare(split.cacheHitRate)} cache hits`);
  }
  return words.join(' · ');
}

/** The page's one read, re-made whenever the address moves. */
function useUsage(query: string): { usage: UsageResponse | null; error: string | null } {
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const next = await fetchUsage(new URLSearchParams(query));
        if (!alive.current) return;
        setUsage(next);
        setError(null);
      } catch (e) {
        if (!alive.current) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [query]);

  return { usage, error };
}

/** A date as the day the reader calls it, which is the day they are picking. */
function dayOf(at: Date): string {
  const month = String(at.getMonth() + 1).padStart(2, '0');
  return `${at.getFullYear()}-${month}-${String(at.getDate()).padStart(2, '0')}`;
}

/** Today, and the day 29 days before it, for the custom range's first opening. */
function defaultRange(): { from: string; to: string } {
  const today = new Date();
  const from = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29);
  return { from: dayOf(from), to: dayOf(today) };
}

export function UsageTab() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [picked, setPicked] = useState<UsageMeasure>('costUsd');

  const period: UsagePeriod = (USAGE_PERIODS as readonly string[]).includes(params.get('period') ?? '')
    ? (params.get('period') as UsagePeriod)
    : '30d';

  // The address as the server reads it: this page's own parameters and no
  // other tab's, so a leftover `?from=context-add` never reaches it. The
  // reader's zone rides along without being on the address, because it is
  // whoever is looking rather than anything a link should carry: the chart's
  // days are cut in it, the way the runs beneath are already written in it.
  const query = useMemo(() => {
    const own = new URLSearchParams();
    for (const key of OWN_PARAMS) {
      const value = params.get(key);
      if (value) own.set(key, value);
    }
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone) own.set('tz', zone);
    return own.toString();
  }, [params]);

  const { usage, error } = useUsage(query);

  /** Write the page's own parameters, leaving anything else on the address alone. */
  const write = useCallback(
    (next: Record<string, string | null>) => {
      const merged = new URLSearchParams(params);
      for (const [key, value] of Object.entries(next)) {
        if (value === null) merged.delete(key);
        else merged.set(key, value);
      }
      setParams(merged, { replace: true });
    },
    [params, setParams],
  );

  const pickPeriod = useCallback(
    (next: UsagePeriod) => {
      if (next !== 'custom') {
        write({ period: next, from: null, to: null });
        return;
      }
      const range = defaultRange();
      write({ period: 'custom', from: params.get('from') ?? range.from, to: params.get('to') ?? range.to });
    },
    [params, write],
  );

  const selected = useMemo(
    () =>
      DIMENSION_KEYS.flatMap((d) => {
        const value = params.get(PARAM[d]);
        return value ? [filterKey(d, value)] : [];
      }),
    [params],
  );

  // One value per dimension: picking a second replaces the first, because one
  // is all the answer can honour.
  const onSelect = useCallback(
    (next: string[]) => {
      const written: Record<string, string | null> = {};
      for (const d of DIMENSION_KEYS) {
        const values = selectedValues(next, d);
        written[PARAM[d]] = values.length === 0 ? null : values[values.length - 1]!;
      }
      write(written);
    },
    [write],
  );

  const dimensions = useMemo(() => {
    const facets = { repo: usage?.repositories ?? [], jobType: usage?.jobTypes ?? [] };
    return DIMENSION_KEYS.map((key) => ({
      key,
      label: DIMENSION_LABEL[key],
      options: facets[key].map((facet) => ({
        key: filterKey(key, facet.value),
        label: facet.label,
        count: facet.count,
        total: facet.total,
      })),
    }));
  }, [usage]);

  // The bands are the job types that actually spent in this slice, so a series
  // is never an empty line drawn for its own sake.
  const series = useMemo<StackedSeries<string>[]>(() => {
    const present = new Set<string>();
    for (const point of usage?.series ?? []) {
      for (const [jobType, amount] of Object.entries(point.byJobType)) {
        if (MEASURES.some((key) => amount[key] > 0)) present.add(jobType);
      }
    }
    return [...present]
      .sort()
      .map((jobType) => ({
        key: jobType,
        label: usageJobTypeWord(jobType),
        ...(JOB_TYPE_FILL[jobType] ?? UNKNOWN_FILL),
      }));
  }, [usage]);

  // A period nothing was cached in offers no Cached measure, the way its split
  // shows no cached figure: a flat zero would read as a cache that missed.
  const measures = useMemo(
    () => MEASURES.filter((key) => key !== 'cached' || usage?.totals.split.cacheHitRate !== null),
    [usage],
  );
  const measure = measures.includes(picked) ? picked : 'costUsd';

  const points = useMemo(
    () =>
      (usage?.series ?? []).map((point) => ({
        at: point.at,
        values: Object.fromEntries(
          series.map((s) => [s.key, point.byJobType[s.key]?.[measure] ?? 0]),
        ) as Record<string, number>,
      })),
    [usage, series, measure],
  );

  const rows = usage?.runs ?? [];
  const settled = useMemo(
    () => rows.filter((row): row is UsageRunRow & { outcome: JobStatus } => row.outcome !== null),
    [rows],
  );
  const tally = useMemo(
    () => tallyOf(settled, OUTCOME_ORDER, (row) => row.outcome, (status) => OUTCOME[status]),
    [settled],
  );

  const format = measure === 'costUsd' ? formatUsd : formatTokens;

  const control = (
    <span className="mr-2 flex flex-wrap items-center gap-1">
      <span role="group" aria-label="Period" className="flex items-center gap-1">
        {USAGE_PERIODS.map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={period === key}
            onClick={() => pickPeriod(key)}
            className={`${CHIP} ${period === key ? CHIP_ON : CHIP_OFF}`}
          >
            {PERIOD_LABEL[key]}
          </button>
        ))}
      </span>
      {period === 'custom' && (
        <span className="flex items-center gap-1">
          <input
            type="date"
            aria-label="From"
            value={params.get('from') ?? defaultRange().from}
            onChange={(e) => write({ from: e.target.value })}
            className={DATE_FIELD}
          />
          <input
            type="date"
            aria-label="To"
            value={params.get('to') ?? defaultRange().to}
            onChange={(e) => write({ to: e.target.value })}
            className={DATE_FIELD}
          />
        </span>
      )}
    </span>
  );

  const nothing = usage !== null && usage.totals.runs === 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <FilterBuilder
        label="Filter"
        ariaLabel="Filter usage"
        lead={control}
        dimensions={dimensions}
        selected={selected}
        onChange={onSelect}
      />

      {error && (
        <p className="border-b border-border px-6 py-3 text-[11px] text-destructive">
          Usage could not be read: {error}
        </p>
      )}

      {nothing ? (
        <div className="min-h-0 flex-1 py-10">
          <EmptyState
            icon={Coins}
            title={selected.length > 0 ? 'Nothing matches' : 'No usage in this period'}
            body={
              selected.length > 0
                ? 'No run matching these filters spent in this period.'
                : usage.since
                  ? `Usage is on record from ${new Date(usage.since).toLocaleDateString()}.`
                  : 'No run has spent at the model yet.'
            }
          />
        </div>
      ) : (
        usage && (
          <>
            <div className="border-b border-border px-6 py-5">
              <StackedArea<string>
                label="Spend over time"
                series={series}
                points={points}
                numbersAtRest={false}
                formatValue={format}
                controls={
                  <span role="group" aria-label="Measure" className="flex items-center gap-1">
                    {measures.map((key) => (
                      <button
                        key={key}
                        type="button"
                        aria-pressed={measure === key}
                        onClick={() => setPicked(key)}
                        className={`${CHIP} ${measure === key ? CHIP_ON : CHIP_OFF}`}
                      >
                        {MEASURE_LABEL[key]}
                      </button>
                    ))}
                  </span>
                }
              />
              <p className="mt-3 text-[13px] text-foreground">
                <span className="text-lg font-semibold tabular-nums">{formatUsd(usage.totals.costUsd)}</span>
                <span className="ml-2 text-[11px] text-muted-foreground">
                  spent over{' '}
                  {period === 'custom' ? 'the chosen days' : `the last ${PERIOD_LABEL[period]}`}
                </span>
              </p>
              <p className="mt-1 text-[11px] tabular-nums text-muted-foreground">
                {splitWords(usage.totals.split)}
              </p>
            </div>

            <EntityList<UsageRunRow>
              variant="embedded"
              label="Runs"
              items={rows}
              itemId={(row) => row.jobId}
              activeId={null}
              rowInteractive={(row) => row.runId !== null}
              onOpen={(id) => {
                const row = rows.find((candidate) => candidate.jobId === id);
                if (row?.runId) navigate(`/agent/${row.runId}`);
              }}
              emptyText="No run spent in this period."
              renderRow={(row) => (
                <>
                  <span className="flex w-full items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
                      {row.title}
                      {row.repository && (
                        <span className="ml-2 font-mono text-[11px] font-normal text-muted-foreground">
                          {row.repository}
                        </span>
                      )}
                    </span>
                    {row.outcome && (
                      <StatusWord
                        tone={OUTCOME[row.outcome].tone}
                        word={OUTCOME[row.outcome].word}
                      />
                    )}
                  </span>
                  <span className="flex w-full items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="min-w-0 truncate tabular-nums">
                      {formatUsd(row.costUsd)} · {splitWords(row.split)}
                      {row.model && ` · ${row.model}`}
                    </span>
                    <span className="ml-auto shrink-0 tabular-nums">
                      {startedLabel(row.startedAt)} · {formatDuration(row.durationMs)}
                    </span>
                  </span>
                </>
              )}
            />

            <StatusTally label="Runs" items={tally} total={rows.length} />
          </>
        )
      )}
    </div>
  );
}
