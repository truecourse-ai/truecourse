/**
 * The Journeys tab's MAIN PANE — the code half's read surface.
 *
 * Top: the DETECTED-SURFACE banner, one chip per surface TrueCourse actually found
 * in this repo, saying whether scenarios can run on it today (runnable ✓ / awaiting
 * its driver ⚠) and how many journeys it carries. It is the one-glance answer to
 * "what does TrueCourse think my app is" — a surface this repo does not have is not
 * user information, so it renders nothing at all.
 *
 * Below: the selected journey as a SEQUENCE DIAGRAM, its typed step list, and the
 * flows that use it (click-through into the Flows tab) — every reference a chip
 * of the same shape, wearing the same status word the Flows list wears; a flow
 * whose realization plan reached the journey but could not be authored reads
 * Blocked, with what it needs. With nothing mapped
 * the pane is one CTA — Map is deterministic, LLM-free and free, so it needs no
 * estimate and no confirmation.
 */

import { Loader2, Route, Workflow } from 'lucide-react';
import type { GuardJourneyRow, GuardJourneysView } from '@truecourse/shared';
import { guardDriver, journeyEntryLabel } from '@truecourse/shared';
import { EmptyState } from '@/components/ui/empty-state';
import { HoverPopover } from '@/components/ui/hover-popover';
import { formatGuardTime, shortFingerprint } from '@/lib/guard-drifts';
import { guardGapNeed, guardPlainStatus, type GuardFlowPlainStatus } from '@/lib/guard-flow-status';
import { journeyStepLabel } from '@/lib/guard-journey-diagram';
import { GuardJourneyDiagram } from './GuardJourneyDiagram';
import { GuardFlowStatusChip } from './GuardStatusBadge';
import { GuardTabStrip, type GuardTabStripItem } from './GuardTabStrip';
import type { GuardTabsState } from '@/hooks/useGuardTabs';

/**
 * Every reference to this journey as ONE uniform chip: the flows that use it,
 * plus any grounding test whose flow the corpus can't name (an id-only reference
 * still reads as a FLOW — chipped by its flow id, never as a bare test id, and
 * never as loose text beside real chips).
 */
function journeyFlowRefs(
  journey: GuardJourneyRow,
): { flowId: string; label: string; status: GuardFlowPlainStatus; need?: string }[] {
  const refs = journey.flows.map((flow) => ({
    flowId: flow.flowId,
    label: flow.title || flow.flowId,
    status: flow.realized ? guardPlainStatus('guarded') : guardPlainStatus('blocked-on'),
    ...(flow.realized ? {} : { need: flow.gap ? guardGapNeed(flow.gap) : undefined }),
  }));
  const known = new Set(refs.map((r) => r.flowId));
  // A test id is `<flow-id>.<surface>.<n>` — recover the flow it belongs to.
  for (const testId of journey.scenarioIds) {
    const flowId = testId.split('.')[0] ?? testId;
    if (known.has(flowId)) continue;
    known.add(flowId);
    refs.push({ flowId, label: flowId, status: guardPlainStatus('guarded') });
  }
  return refs;
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full w-full items-center justify-center">{children}</div>;
}

const LABEL = 'mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground';

/**
 * One chip per surface found in this repo — runnable ✓ / awaiting its driver ⚠,
 * with its journey count. Drivers the repo has no code for are dropped entirely,
 * and with nothing detected the banner itself disappears (the unmapped/empty body
 * already says what to do).
 */
function SurfaceBanner({ view }: { view: GuardJourneysView }) {
  const detected = view.surfaces.filter((s) => s.detected);
  if (detected.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-card px-4 py-2">
      <span className="mr-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Detected surfaces
      </span>
      {detected.map((s) => {
        const tone = s.runnable
          ? 'border-emerald-500/60 text-emerald-600 dark:text-emerald-400'
          : 'border-amber-500/60 text-amber-600 dark:text-amber-400';
        const state = s.runnable ? 'runnable ✓' : `${s.waitingLabel ?? 'awaiting driver'} ⚠`;
        return (
          <HoverPopover portal
            key={s.surface}
            width="narrow"
            content={`${s.journeys} journey(s) mapped for ${s.label}${s.source ? ` (from the ${s.source})` : ''}.`}
          >
            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${tone}`}>
              {s.label} · {state}
              <span className="text-muted-foreground">· {s.journeys}</span>
            </span>
          </HoverPopover>
        );
      })}
    </div>
  );
}

export function GuardJourneysPane({
  view,
  loading,
  error,
  mapping,
  onMap,
  tabs,
  onOpenFlow,
}: {
  view: GuardJourneysView | null;
  loading: boolean;
  error: string | null;
  mapping: boolean;
  onMap: () => void;
  tabs: GuardTabsState;
  onOpenFlow: (flowId: string) => void;
}) {
  const { activeId, openTabs, open, close } = tabs;

  if (loading && !view) {
    return (
      <Centered>
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </Centered>
    );
  }
  if (error && !view) {
    return (
      <Centered>
        <p className="max-w-sm px-6 text-center text-sm text-muted-foreground">{error}</p>
      </Centered>
    );
  }
  if (!view) {
    return (
      <EmptyState icon={Route} title="No journey catalog" body="Journeys are derived from the working tree." />
    );
  }

  if (view.unavailable === 'no-working-tree') {
    return (
      <EmptyState
        icon={Route}
        title="No working tree to map"
        body="Journey mapping reads the repository's files; hosted repos map their surfaces during the server-side generate."
      />
    );
  }

  const active = activeId ? view.journeys.find((j) => j.id === activeId) ?? null : null;
  const tabItems: GuardTabStripItem[] = openTabs.map((t) => ({
    ...t,
    label: t.id,
    title: view.journeys.find((j) => j.id === t.id)?.title ?? t.id,
    icon: Route,
  }));

  const body = (() => {
    if (!view.mapped || view.journeys.length === 0) {
      return (
        <EmptyState
          icon={Route}
          title="No journeys mapped yet"
          body={
            <>
              Journeys are derived from the working tree — deterministic, no LLM, seconds.
              <button
                type="button"
                onClick={onMap}
                disabled={mapping}
                className="mt-3 block rounded border border-border px-2 py-1 text-xs text-foreground hover:bg-muted/40 disabled:opacity-60"
              >
                {mapping ? 'Mapping…' : 'Map · free, no LLM'}
              </button>
            </>
          }
        />
      );
    }

    if (!active) {
      return (
        <EmptyState
          icon={Route}
          title="Select a journey"
          body={`${view.totals.journeys} journeys mapped · ${view.totals.grounded} used by a flow · ${view.totals.ungrounded} not mentioned by any spec.`}
        />
      );
    }

    return (
      <div className="h-full overflow-auto px-6 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {guardDriver(active.type)?.label ?? active.type}
          </span>
          <span className="font-mono text-[12px] text-foreground">{active.id}</span>
          <HoverPopover portal width="narrow" content="Fingerprint over the journey's surface-visible shape — what a scenario is grounded on.">
            <span className="font-mono text-[10px] text-muted-foreground">
              {shortFingerprint(active.fingerprint)}
            </span>
          </HoverPopover>
        </div>
        <h2 className="mt-1 text-sm font-semibold text-foreground">{active.title}</h2>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          entry {journeyEntryLabel(active.entry)}
          {active.source ? ` · derived from the ${active.source}` : ''}
          {view.generatedAt ? ` · mapped ${formatGuardTime(view.generatedAt)}` : ''}
        </p>
        {active.specOnly ? (
          <p className="mt-0.5 text-[11px] text-amber-600 dark:text-amber-400">
            Declared in your API docs, but no code route serves it — a scenario through it
            checks whether the documented operation really exists.
          </p>
        ) : null}

        <div className="mt-4">
          <div className={LABEL}>Sequence</div>
          <GuardJourneyDiagram journey={active} label={active.id} />
        </div>

        <div className="mt-4">
          <div className={LABEL}>Steps</div>
          <ol className="space-y-1">
            {active.steps.map((step, i) => (
              <li key={i} className="flex items-baseline gap-2 text-[12px] text-muted-foreground">
                <span className="w-4 shrink-0 text-right text-[10px]">{i + 1}</span>
                <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px]">{step.kind}</span>
                <span className="min-w-0 break-all font-mono text-foreground">{journeyStepLabel(step)}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="mt-4">
          <div className={LABEL}>Used by flows</div>
          {active.flows.length === 0 ? (
            // Reserved for ZERO references of any kind: no scenario grounds here AND
            // no flow's realization plan reached it. A flow that matched but couldn't
            // be authored still counts as used — it reads "blocked" below.
            <p className="text-[12px] text-amber-600 dark:text-amber-400">
              {active.specOnly
                ? 'No flow uses this journey yet.'
                : 'No flow uses this journey — the spec never mentions this code path.'}
            </p>
          ) : (
            <div className="flex flex-col items-start gap-1">
              {journeyFlowRefs(active).map((ref) => (
                <button
                  key={ref.flowId}
                  type="button"
                  onClick={() => onOpenFlow(ref.flowId)}
                  className="inline-flex max-w-full items-center gap-1 rounded border border-border px-1.5 py-0.5 text-left text-[11px] text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                >
                  <Workflow className="h-3 w-3 shrink-0" />
                  <span className="truncate">{ref.label}</span>
                  {/* The SAME status chip the Flows list shows — one vocabulary. */}
                  <GuardFlowStatusChip status={ref.status} />
                  {ref.need && <span className="shrink-0 text-muted-foreground">{ref.need}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  })();

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <SurfaceBanner view={view} />
      {/* No Overview chip: with no journey open this pane IS its no-selection
          state — the surface banner over "pick a journey". */}
      <GuardTabStrip
        tabs={tabItems}
        activeId={activeId}
        onSelect={(t) => open(t.id, t.pinned)}
        onClose={close}
      />
      <div className="relative min-h-0 flex-1 overflow-hidden">{body}</div>
    </div>
  );
}
