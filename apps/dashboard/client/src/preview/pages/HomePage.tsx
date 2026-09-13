/**
 * Home, for the product owner: a dashboard over `GET /api/home`.
 *
 * The hero is SECTIONS OVER TIME, a full-width stacked area of the workspace's
 * sections by status across the baseline runs of the chosen period, whose right
 * edge is today's composition and whose readout doubles as the legend and the
 * current tally, each word a door into Documents narrowed to that status.
 * Beneath it three equal widgets, each one question with its own rows and its
 * own door:
 *
 *   Needs attention    the conversations that ended badly, the open conflicts,
 *                      the blocked documents, the failed syncs, the provider
 *   Areas              one composition strip per area, worst share first
 *   Recently changed   the documents a run moved, grouped by day
 *
 * Nothing is composed here: the server folded every number and computed every
 * address, so this page draws what it was told and invents no row. It re-reads
 * on the workspace's change signal, which a settled job bumps too.
 *
 * Before any of that, ONBOARDING: a workspace without both a context source and
 * a connected repository has no dashboard to draw, so Home is two checkpoints
 * instead, each with its own action, and the dashboard read is not made at all.
 * The decision waits for both reads, so the checkpoints never flash on a
 * workspace that already has everything.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Check, ClipboardList } from 'lucide-react';
import {
  HOME_STATUS_ORDER,
  HOME_STATUS_WORD,
  type HomeAttentionRow,
  type HomeChangeRow,
  type HomePeriod,
  type HomeResponse,
  type HomeStatus,
} from '@truecourse/shared';
import { EmptyState } from '@/components/ui/empty-state';
import { fetchHome } from '@/lib/api';
import { PageHeader, SectionTitle } from '@/preview/ui/bits';
import { EntityList, type EntityListGroup } from '@/preview/ui/entity-list';
import { StackedArea, type StackedSeries } from '@/preview/ui/stacked-area';
import { CONTEXT_DOC_TONE, StatusWord, type StatusTone } from '@/preview/ui/status-word';
import { useOnboarding } from '@/preview/shell/use-onboarding';
import { PREVIEW_BASE } from '@/preview/shell/base';
import { documentsHref } from './context-hrefs';

/** The fills each word wears: green, red, the darker blue, grey, the lighter blue. */
const FILL: Record<HomeStatus, { fill: string; dot: string }> = {
  proved: { fill: 'fill-emerald-500', dot: 'bg-emerald-500' },
  failed: { fill: 'fill-red-500', dot: 'bg-red-500' },
  blocked: { fill: 'fill-sky-600', dot: 'bg-sky-600' },
  'not-testable': { fill: 'fill-slate-400', dot: 'bg-slate-400' },
  'not-run': { fill: 'fill-sky-400', dot: 'bg-sky-400' },
};

/** Bottom first: proved is the ground, the worst news sits on top. */
const STACK: HomeStatus[] = ['proved', 'not-run', 'not-testable', 'blocked', 'failed'];

const SERIES: StackedSeries<HomeStatus>[] = STACK.map((status) => ({
  key: status,
  label: HOME_STATUS_WORD[status],
  fill: FILL[status].fill,
  dot: FILL[status].dot,
}));

/** The chart's periods, as the filter idiom's chips. */
const PERIODS: { key: HomePeriod; label: string }[] = [
  { key: '7d', label: '7d' },
  { key: '30d', label: '30d' },
  { key: '90d', label: '90d' },
  { key: 'all', label: 'All' },
];

const CHIP = 'rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors';
const ROW = 'flex w-full flex-col gap-0.5 px-6 py-2 text-left transition-colors hover:bg-muted/30';

/** The tone a status word wears, in the vocabulary every Context surface uses. */
function toneOf(word: string): StatusTone {
  const status = HOME_STATUS_ORDER.find((key) => HOME_STATUS_WORD[key] === word);
  if (status) return CONTEXT_DOC_TONE[status];
  return word === 'First read' ? 'neutral' : 'blocked';
}

/** The page's one read: the whole dashboard, re-read on the workspace's signal. */
function useHome(period: HomePeriod, signal: number): { home: HomeResponse | null; error: string | null } {
  const [home, setHome] = useState<HomeResponse | null>(null);
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
        const next = await fetchHome(period);
        if (!alive.current) return;
        setHome(next);
        setError(null);
      } catch (e) {
        if (!alive.current) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [period, signal]);

  return { home, error };
}

/** A dashboard rectangle: one question, its rows, one door at the top right. */
function Widget({
  title,
  to,
  toWord = 'All',
  children,
}: {
  title: string;
  to?: string;
  toWord?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="flex h-80 min-w-0 flex-col overflow-hidden bg-background"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-6 py-2">
        <SectionTitle>{title}</SectionTitle>
        {to && (
          <Link to={to} className="text-[11px] font-medium text-primary hover:underline">
            {toWord}
          </Link>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </section>
  );
}

/** A widget's four-corner row: the title and the status, then a fact and a time. */
function WidgetRow({
  title,
  status,
  fact,
  when,
  onOpen,
}: {
  title: React.ReactNode;
  status: React.ReactNode;
  fact: React.ReactNode;
  when?: React.ReactNode;
  onOpen: () => void;
}) {
  return (
    <li>
      <button type="button" onClick={onOpen} className={ROW}>
        <span className="flex w-full items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{title}</span>
          <span className="shrink-0">{status}</span>
        </span>
        <span className="flex w-full items-center gap-2 text-[11px] text-muted-foreground">
          <span className="min-w-0 truncate">{fact}</span>
          {when && <span className="ml-auto shrink-0">{when}</span>}
        </span>
      </button>
    </li>
  );
}

function Nothing({ children }: { children: string }) {
  return <p className="px-4 py-6 text-center text-xs text-muted-foreground">{children}</p>;
}

/** One area's composition, full width: the name left, the dot counts right. */
function AreaBar({
  area,
  onOpen,
}: {
  area: { area: string; total: number; byStatus: Record<HomeStatus, number> };
  onOpen: () => void;
}) {
  const shown = HOME_STATUS_ORDER.filter((status) => area.byStatus[status] > 0);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${area.area || 'No area'}: ${shown
        .map((status) => `${area.byStatus[status]} ${HOME_STATUS_WORD[status].toLowerCase()}`)
        .join(', ')}`}
      className={`${ROW} group`}
    >
      <span className="flex w-full items-center gap-3">
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
          {area.area || 'No area'}
        </span>
        <span className="flex shrink-0 items-center gap-x-2.5">
          {shown.map((status) => (
            <span key={status} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${FILL[status].dot}`} />
              <span className="tabular-nums text-foreground">{area.byStatus[status]}</span>
            </span>
          ))}
        </span>
      </span>
      {/* Muted at rest, full colour under the pointer, like the chart. */}
      <span className="flex h-2 w-full gap-[2px] overflow-hidden rounded opacity-45 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100">
        {shown.map((status) => (
          <span
            key={status}
            className={`${FILL[status].dot} min-w-[4px]`}
            style={{ flexGrow: area.byStatus[status], flexBasis: 0 }}
          />
        ))}
      </span>
    </button>
  );
}

function when(iso: string | null): string {
  if (!iso) return '';
  const at = new Date(iso);
  return Number.isNaN(at.getTime())
    ? ''
    : at.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Today, Yesterday, Earlier: the day a change happened, from the reader's clock. */
function dayOf(iso: string): 'today' | 'yesterday' | 'earlier' {
  const hours = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  return hours < 24 ? 'today' : hours < 48 ? 'yesterday' : 'earlier';
}

/** The dashboard itself, drawn once the workspace has both of its halves. */
function Dashboard({ signal }: { signal: number }) {
  const navigate = useNavigate();
  const [period, setPeriod] = useState<HomePeriod>('30d');
  const { home, error } = useHome(period, signal);

  const today = home?.today ?? null;

  // The chart's points are the baseline runs; its right edge is today's
  // composition, so the trend and the strip above it are one picture. The
  // readout shows numbers only under the pointer: today's are in the strip.
  const points = useMemo(() => {
    const trend = home?.trend ?? [];
    return trend.map((point, index) => ({
      at: point.at.slice(0, 10),
      values: index === trend.length - 1 && today ? today.byStatus : point.byStatus,
    }));
  }, [home, today]);

  const changed = useMemo<EntityListGroup<HomeChangeRow>[]>(() => {
    const buckets: Record<'today' | 'yesterday' | 'earlier', HomeChangeRow[]> = {
      today: [],
      yesterday: [],
      earlier: [],
    };
    for (const row of home?.changed ?? []) buckets[dayOf(row.at)].push(row);
    return (
      [
        { key: 'today', label: 'Today', items: buckets.today },
        { key: 'yesterday', label: 'Yesterday', items: buckets.yesterday },
        { key: 'earlier', label: 'Earlier', items: buckets.earlier },
      ] as EntityListGroup<HomeChangeRow>[]
    ).filter((group) => (group.items?.length ?? 0) > 0);
  }, [home]);

  const attention: HomeAttentionRow[] = home?.attention ?? [];

  if (error) {
    return (
      <div className="flex h-full min-h-0 min-w-0 flex-col">
        <PageHeader title="Home" />
        <EmptyState icon={ClipboardList} title="Home" body={`Home could not be read: ${error}`} />
      </div>
    );
  }

  const provenShare = today && today.total > 0 ? Math.round((today.byStatus.proved / today.total) * 100) : 0;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <PageHeader title="Home" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Today's numbers, once: the proved share, then every status of
            today's sections, each a door into Documents narrowed to it. */}
        {today && (
          <div
            className="grid grid-cols-2 border-b border-border sm:grid-cols-3 lg:grid-cols-6 [&>*]:border-b [&>*]:border-r [&>*]:border-border lg:[&>*]:border-b-0 [&>*:nth-child(2n)]:border-r-0 sm:[&>*:nth-child(2n)]:border-r sm:[&>*:nth-child(3n)]:border-r-0 lg:[&>*:nth-child(3n)]:border-r lg:[&>*:last-child]:border-r-0"
            role="list"
            aria-label="Today"
          >
            <div role="listitem" className="bg-background px-6 py-4">
              <span className="block text-2xl font-semibold tabular-nums text-foreground">{provenShare}%</span>
              <span className="mt-0.5 block text-[11px] text-muted-foreground">proved</span>
            </div>
            {HOME_STATUS_ORDER.map((status) => (
              <button
                key={status}
                type="button"
                role="listitem"
                aria-label={`${today.byStatus[status]} ${HOME_STATUS_WORD[status]}`}
                onClick={() => navigate(documentsHref({ status }))}
                className="bg-background px-6 py-4 text-left transition-colors hover:bg-muted/30"
              >
                <span className="block text-2xl font-semibold tabular-nums text-foreground">{today.byStatus[status]}</span>
                <span className="mt-0.5 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${FILL[status].dot}`} />
                  {HOME_STATUS_WORD[status]}
                </span>
              </button>
            ))}
          </div>
        )}
        <div className="border-b border-border px-6 py-5">
          {points.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              Nothing has run yet, so there is nothing to draw.
            </p>
          ) : (
            <StackedArea<HomeStatus>
              label="Sections over time"
              series={SERIES}
              points={points}
              numbersAtRest={false}
              onPickSeries={(status) => navigate(documentsHref({ status }))}
              controls={
                <span role="group" aria-label="Period" className="flex items-center gap-1">
                  {PERIODS.map((p) => (
                    <button
                      key={p.key}
                      type="button"
                      aria-pressed={period === p.key}
                      onClick={() => setPeriod(p.key)}
                      className={`${CHIP} ${
                        period === p.key
                          ? 'bg-primary text-primary-foreground ring-1 ring-inset ring-current'
                          : 'bg-muted text-foreground'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </span>
              }
            />
          )}
        </div>

        {/* The widgets sit in the strip's grid: cells parted by the same lines,
            no card chrome, edge to edge. Needs attention takes the full width,
            since its rows carry the longest titles and a reason; the other two
            share the row under it. */}
        <div className="border-b border-border">
          <Widget title="Needs attention" to={`${PREVIEW_BASE}/agent`} toWord="Agent">
            {attention.length === 0 ? (
              <Nothing>Nothing is waiting on you.</Nothing>
            ) : (
              <ul className="divide-y divide-border/60" aria-label="Needs attention">
                {attention.map((row) => (
                  <WidgetRow
                    key={row.id}
                    title={row.title}
                    status={<StatusWord tone={toneOf(row.status)} word={row.status} />}
                    fact={row.fact}
                    when={when(row.at)}
                    onOpen={() => navigate(row.href)}
                  />
                ))}
              </ul>
            )}
          </Widget>
        </div>
        <div className="grid grid-cols-1 border-b border-border lg:grid-cols-2 [&>*]:border-b [&>*]:border-border lg:[&>*]:border-b-0 lg:[&>*]:border-r lg:[&>*:last-child]:border-r-0">
          <Widget title="Areas" to={documentsHref({})} toWord="Documents">
            {(home?.areas ?? []).length === 0 ? (
              <Nothing>No document is read by a repository yet.</Nothing>
            ) : (
              <ul className="divide-y divide-border/60" aria-label="Areas">
                {(home?.areas ?? []).map((area) => (
                  <li key={area.area}>
                    <AreaBar area={area} onOpen={() => navigate(documentsHref({ area: area.area }))} />
                  </li>
                ))}
              </ul>
            )}
          </Widget>

          <Widget title="Recently changed" to={documentsHref({ status: 'failed' })} toWord="Failed">
            <EntityList<HomeChangeRow>
              variant="embedded"
              label="Recently changed"
              groups={changed}
              itemId={(row) => row.ref}
              activeId={null}
              onOpen={(id) => {
                const row = (home?.changed ?? []).find((candidate) => candidate.ref === id);
                if (row) navigate(row.href);
              }}
              emptyText="Nothing has changed."
              renderRow={(row) => (
                <>
                  <span className="flex w-full items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
                      {row.title}
                    </span>
                    <StatusWord tone={toneOf(row.event)} word={row.event} />
                  </span>
                  <span className="flex w-full items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="min-w-0 truncate">{row.ref}</span>
                    <span className="ml-auto shrink-0">{when(row.at)}</span>
                  </span>
                </>
              )}
            />
          </Widget>
        </div>
      </div>
    </div>
  );
}

const PRIMARY_ACTION =
  'inline-block rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90';

/**
 * One checkpoint: its mark (a check once done, its number until then), what it
 * gives the workspace, and either its action or the word Done.
 */
function Checkpoint({
  step,
  done,
  title,
  line,
  action,
  to,
}: {
  step: number;
  done: boolean;
  title: string;
  line: string;
  action: string;
  to: string;
}) {
  return (
    <li className="flex flex-col gap-4 px-8 py-8">
      <span
        aria-hidden
        className={`inline-flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold ${
          done ? 'bg-emerald-500 text-white' : 'border border-border text-foreground'
        }`}
      >
        {done ? <Check className="h-4.5 w-4.5" /> : step}
      </span>
      <span className="min-w-0">
        <span className="block text-base font-semibold text-foreground">{title}</span>
        <span className="mt-1 block text-[13px] text-muted-foreground">{line}</span>
      </span>
      <span className="mt-1">
        {done ? (
          <StatusWord tone="success" word="Done" />
        ) : (
          <Link to={to} className={PRIMARY_ACTION}>
            {action}
          </Link>
        )}
      </span>
    </li>
  );
}

/**
 * Home before the workspace has both halves: two checkpoints, side by side in
 * the strip's grid, either order. Both done, and Home is the dashboard.
 */
function Onboarding({ hasContext, hasRepo }: { hasContext: boolean; hasRepo: boolean }) {
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <PageHeader title="Home" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="px-8 pb-6 pt-10">
          <h2 className="text-xl font-semibold text-foreground">Set up your workspace</h2>
          <p className="mt-1.5 text-[13px] text-muted-foreground">
            Connect the documentation that says what the product promises, and the code that has to keep it.
          </p>
        </div>
        <ul
          className="grid grid-cols-1 border-y border-border lg:grid-cols-2 [&>*]:border-b [&>*]:border-border lg:[&>*]:border-b-0 lg:[&>*]:border-r lg:[&>*:last-child]:border-r-0"
          aria-label="Getting started"
        >
          <Checkpoint
            step={1}
            done={hasContext}
            title="Connect your first context"
            line="The documentation that says what the product promises."
            action="Add context"
            to={`${PREVIEW_BASE}/context?add=1`}
          />
          <Checkpoint
            step={2}
            done={hasRepo}
            title="Connect your first repository"
            line="The code that has to keep the promise."
            action="Connect repository"
            to={`${PREVIEW_BASE}/code?connect=1`}
          />
        </ul>
      </div>
    </div>
  );
}

export default function HomePage() {
  const { ready, hasContext, hasRepo, done, signal } = useOnboarding();

  // Until both reads have landed there is nothing honest to draw: an empty
  // list in flight is not a workspace with nothing in it.
  if (!ready) {
    return (
      <div className="flex h-full min-h-0 min-w-0 flex-col">
        <PageHeader title="Home" />
      </div>
    );
  }

  if (!done) return <Onboarding hasContext={hasContext} hasRepo={hasRepo} />;

  return <Dashboard signal={signal} />;
}
