/**
 * Home, for the product owner: a dashboard over `GET /api/home`.
 *
 * The hero is FLOWS OVER TIME, a full-width stacked area of the workspace's
 * flows by status across the baseline runs of the chosen period, whose right
 * edge is today's composition and whose readout doubles as the legend and the
 * current tally, each word a door into Flows narrowed to that status. A flow is
 * what the engine proves and what can be proved on its own, which is why it is
 * the headline: a section is worth the worst thing in it, so one blocked
 * scenario would erase every proof beside it.
 *
 * Beneath it the widgets, each one question with its own rows and its own
 * door:
 *
 *   Needs attention    the conversations that ended badly, the open conflicts,
 *                      the blocked documents, the failed syncs, the provider
 *   Findings           the flows whose test fails: what the product did where
 *                      its documents say otherwise. A row opens the flow
 *   Blocked on         what the blocked flows wait on, one row per missing
 *                      thing, most flows first
 *   Documents          one composition strip per document, over its FLOWS
 *
 * Every count on the page is a count of flows, in the Flows page's words
 * (Succeeded, Never run), so no number here says a different word than the
 * page it opens.
 *
 * The server folds every number and computes every address. The default view
 * excludes blocked results unless Settings > Workspace includes them. It re-reads
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
  HOME_FLOW_STATUS_ORDER,
  HOME_FLOW_STATUS_WORD,
  HOME_STATUS_ORDER,
  HOME_STATUS_WORD,
  type HomeAttentionRow,
  type HomeDocumentFlowsRow,
  type HomeFlowStatus,
  type HomePeriod,
  type HomeResponse,
} from '@truecourse/shared';
import { EmptyState } from '@/components/ui/empty-state';
import { fetchHome } from '@/lib/api';
import { PageHeader, SectionTitle } from '@/dashboard/ui/bits';
import { StackedArea, type StackedSeries } from '@/dashboard/ui/stacked-area';
import { CONTEXT_DOC_TONE, StatusWord, type StatusTone } from '@/dashboard/ui/status-word';
import { SegmentedControl } from '@/dashboard/ui/segmented-control';
import { useDashboardState } from '@/dashboard/shell/dashboard-state';
import { useOnboarding } from '@/dashboard/shell/use-onboarding';
import { FLOWS_BASE, flowsStatusHref } from './flow-hrefs';

/**
 * The fills the states wear: green, lime, red, amber, grey, blue. ONE colour per
 * state under both vocabularies — a flow's Succeeded and a section's Proved are
 * the same green, because they are the same state counted in two units.
 */
const FLOW_FILL: Record<HomeFlowStatus, { fill: string; dot: string }> = {
  succeeded: { fill: 'fill-emerald-500', dot: 'bg-emerald-500' },
  'partially-succeeded': { fill: 'fill-lime-500', dot: 'bg-lime-500' },
  failed: { fill: 'fill-red-500', dot: 'bg-red-500' },
  blocked: { fill: 'fill-amber-500', dot: 'bg-amber-500' },
  'not-testable': { fill: 'fill-slate-400', dot: 'bg-slate-400' },
  'never-run': { fill: 'fill-sky-400', dot: 'bg-sky-400' },
};

/** Bottom first: what is proved is the ground, the worst news sits on top. */
const STACK: HomeFlowStatus[] = ['succeeded', 'partially-succeeded', 'never-run', 'not-testable', 'blocked', 'failed'];

const SERIES: StackedSeries<HomeFlowStatus>[] = STACK.map((status) => ({
  key: status,
  label: HOME_FLOW_STATUS_WORD[status],
  fill: FLOW_FILL[status].fill,
  dot: FLOW_FILL[status].dot,
}));

/** The chart's periods, as the filter idiom's chips. */
const PERIODS: { key: HomePeriod; label: string }[] = [
  { key: '7d', label: '7d' },
  { key: '30d', label: '30d' },
  { key: '90d', label: '90d' },
  { key: 'all', label: 'All' },
];

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
  unit,
  to,
  toWord = 'All',
  stacked = false,
  children,
}: {
  title: string;
  /** What the widget counts, when the page counts more than one thing. */
  unit?: string;
  to?: string;
  toWord?: string;
  /** Share a column with another widget instead of taking the row's full height. */
  stacked?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className={`flex min-w-0 flex-col overflow-hidden bg-background ${stacked ? 'min-h-0 flex-1' : 'h-80'}`}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-6 py-2">
        <span className="flex min-w-0 items-baseline gap-1.5">
          <SectionTitle>{title}</SectionTitle>
          {unit && <span className="text-[11px] text-muted-foreground">{unit}</span>}
        </span>
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

/** One document's flows as a composition, full width: the name left, the dot counts right. */
function DocumentBar({ row, onOpen }: { row: HomeDocumentFlowsRow; onOpen: () => void }) {
  const shown = HOME_FLOW_STATUS_ORDER.filter((status) => row.byStatus[status] > 0);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${row.doc}: ${shown
        .map((status) => `${row.byStatus[status]} ${HOME_FLOW_STATUS_WORD[status].toLowerCase()}`)
        .join(', ')}`}
      className={`${ROW} group`}
    >
      <span className="flex w-full items-center gap-3">
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-foreground" title={row.doc}>
          {row.doc.split('/').slice(-2).join('/')}
        </span>
        <span className="flex shrink-0 items-center gap-x-2.5">
          {shown.map((status) => (
            <span key={status} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${FLOW_FILL[status].dot}`} />
              <span className="tabular-nums text-foreground">{row.byStatus[status]}</span>
            </span>
          ))}
        </span>
      </span>
      {/* Muted at rest, full colour under the pointer, like the chart. */}
      <span className="flex h-2 w-full gap-[2px] overflow-hidden rounded opacity-45 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100">
        {shown.map((status) => (
          <span
            key={status}
            className={`${FLOW_FILL[status].dot} min-w-[4px]`}
            style={{ flexGrow: row.byStatus[status], flexBasis: 0 }}
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

/** The dashboard itself, drawn once the workspace has both of its halves. */
function Dashboard({ signal }: { signal: number }) {
  const navigate = useNavigate();
  const [period, setPeriod] = useState<HomePeriod>('30d');
  const { home: fullHome, error } = useHome(period, signal);
  const { showBlocked } = useDashboardState();
  const home = useMemo(() => {
    if (!fullHome || showBlocked) return fullHome;
    return {
      ...fullHome,
      today: {
        total: fullHome.today.total - fullHome.today.byStatus.blocked,
        byStatus: { ...fullHome.today.byStatus, blocked: 0 },
      },
      trend: fullHome.trend.map((point) => ({
        ...point, byStatus: { ...point.byStatus, blocked: 0 },
      })),
      areas: fullHome.areas.map((area) => ({
        ...area,
        total: area.total - area.byStatus.blocked,
        byStatus: { ...area.byStatus, blocked: 0 },
      })).filter((area) => area.total > 0),
      attention: fullHome.attention.filter((row) => row.kind !== 'blocked-document' && row.status !== 'Blocked'),
      changed: fullHome.changed.filter((row) => row.event !== 'Blocked'),
      blockedOn: [],
      documents: fullHome.documents
        .map((row) => ({
          ...row,
          total: row.total - row.byStatus.blocked,
          byStatus: { ...row.byStatus, blocked: 0 },
        }))
        .filter((row) => row.total > 0),
    };
  }, [fullHome, showBlocked]);
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

  const attention: HomeAttentionRow[] = home?.attention ?? [];
  const findings = home?.findings ?? [];
  const blockedOn = home?.blockedOn ?? [];
  const documents = home?.documents ?? [];

  if (error) {
    return (
      <div className="flex h-full min-h-0 min-w-0 flex-col">
        <PageHeader title="Home" />
        <EmptyState icon={ClipboardList} title="Home" body={`Home could not be read: ${error}`} />
      </div>
    );
  }

  // A partially succeeded flow proved what its documents promise, under another
  // name for a control, so the headline counts it as succeeded.
  const proven = today ? today.byStatus.succeeded + today.byStatus['partially-succeeded'] : 0;
  const provenShare = today && today.total > 0 ? Math.round((proven / today.total) * 100) : 0;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <PageHeader title="Home" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Today's numbers, once: the succeeded share, which is the one cell
            that names what is being counted and how much of it there is, then
            every status of today's flows, each a door into Flows narrowed to
            it. */}
        {today && (
          <div
            className={`grid grid-cols-2 border-b border-border sm:grid-cols-3 ${showBlocked ? 'lg:grid-cols-7' : 'lg:grid-cols-6'} [&>*]:border-b [&>*]:border-r [&>*]:border-border lg:[&>*]:border-b-0 [&>*:nth-child(2n)]:border-r-0 sm:[&>*:nth-child(2n)]:border-r sm:[&>*:nth-child(3n)]:border-r-0 lg:[&>*:nth-child(3n)]:border-r lg:[&>*:last-child]:border-r-0`}
            role="list"
            aria-label="Today"
          >
            <div role="listitem" className="bg-background px-6 py-4">
              <span className="block text-2xl font-semibold tabular-nums text-foreground">{provenShare}%</span>
              <span className="mt-0.5 block text-[11px] text-muted-foreground">
                {`${proven} of ${today.total} ${today.total === 1 ? 'flow' : 'flows'} succeeded${showBlocked ? '' : ', excluding blocked'}`}
              </span>
            </div>
            {HOME_FLOW_STATUS_ORDER.filter((status) => showBlocked || status !== 'blocked').map((status) => (
              <button
                key={status}
                type="button"
                role="listitem"
                aria-label={`${today.byStatus[status]} ${HOME_FLOW_STATUS_WORD[status]}`}
                onClick={() => navigate(flowsStatusHref(status))}
                className="bg-background px-6 py-4 text-left transition-colors hover:bg-muted/30"
              >
                <span className="block text-2xl font-semibold tabular-nums text-foreground">{today.byStatus[status]}</span>
                <span className="mt-0.5 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${FLOW_FILL[status].dot}`} />
                  {HOME_FLOW_STATUS_WORD[status]}
                </span>
              </button>
            ))}
          </div>
        )}
        <div className="border-b border-border px-6 py-5">
          {points.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              {today && today.total > 0
                ? 'No run has recorded its flows yet, so there is no trend to draw.'
                : 'Nothing has run yet, so there is nothing to draw.'}
            </p>
          ) : (
            <StackedArea<HomeFlowStatus>
              label="Flows over time"
              series={showBlocked ? SERIES : SERIES.filter((series) => series.key !== 'blocked')}
              points={points}
              numbersAtRest={false}
              onPickSeries={(status) => navigate(flowsStatusHref(status))}
              controls={
                <SegmentedControl label="Period" options={PERIODS} value={period} onChange={setPeriod} />
              }
            />
          )}
        </div>

        {/* The widgets sit in the strip's grid: cells parted by the same lines,
            no card chrome, edge to edge. Needs attention takes the full width,
            since its rows carry the longest titles and a reason; the other two
            share the row under it. */}
        <div className="border-b border-border">
          <Widget title="Needs attention" to={'/agent'} toWord="Agent">
            {attention.length === 0 ? (
              <Nothing>{!showBlocked && (fullHome?.attention.length ?? 0) > 0 ? 'No attention items match this view.' : 'Nothing is waiting on you.'}</Nothing>
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
          <Widget
            title="Findings"
            unit="the product does not do what the document says"
            to={flowsStatusHref('failed')}
            toWord={findings.length > 0 ? `All ${findings.length}` : 'Flows'}
          >
            {findings.length === 0 ? (
              <Nothing>No flow test fails.</Nothing>
            ) : (
              <ul className="divide-y divide-border/60" aria-label="Findings">
                {findings.map((row) => (
                  <li key={row.id}>
                    <button type="button" onClick={() => navigate(row.href)} className={ROW} title={row.documented}>
                      <span className="w-full truncate text-[13px] font-medium text-foreground">{row.title}</span>
                      <span className="w-full truncate text-[11px] text-muted-foreground">{row.observed}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Widget>

          <div className="flex h-80 min-w-0 flex-col divide-y divide-border">
            {showBlocked && (
              <Widget title="Blocked on" to={flowsStatusHref('blocked')} toWord="Blocked" stacked>
                {blockedOn.length === 0 ? (
                  <Nothing>No flow is blocked.</Nothing>
                ) : (
                  <ul className="divide-y divide-border/60" aria-label="Blocked on">
                    {blockedOn.map((row) => (
                      <li key={row.reason}>
                        <button
                          type="button"
                          onClick={() => navigate(row.href)}
                          className="flex w-full items-center gap-3 px-6 py-2 text-left text-[13px] transition-colors hover:bg-muted/30"
                          title={row.reason}
                        >
                          <span className="min-w-0 flex-1 truncate text-foreground">{row.reason}</span>
                          <span className="shrink-0 tabular-nums text-muted-foreground">
                            {row.flows === 1 ? '1 flow' : `${row.flows} flows`}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Widget>
            )}
            <Widget title="Documents" unit="by flow" to={FLOWS_BASE} toWord="Flows" stacked>
              {documents.length === 0 ? (
                <Nothing>No flow cites a document yet.</Nothing>
              ) : (
                <ul className="divide-y divide-border/60" aria-label="Documents">
                  {documents.map((row) => (
                    <li key={row.doc}>
                      <DocumentBar row={row} onOpen={() => navigate(row.href)} />
                    </li>
                  ))}
                </ul>
              )}
            </Widget>
          </div>
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
            to={'/context?add=1'}
          />
          <Checkpoint
            step={2}
            done={hasRepo}
            title="Connect your first repository"
            line="The code that has to keep the promise."
            action="Connect repository"
            to={'/code?connect=1'}
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
