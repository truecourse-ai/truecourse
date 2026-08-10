/**
 * The Journeys tab's MAIN PANE — the code half's read surface.
 *
 * Top: the DETECTED-SURFACE banner, one chip per surface TrueCourse actually found
 * in this repo, saying whether scenarios can run on it today (runnable ✓ / awaiting
 * its driver ⚠). It is the one-glance answer to "what does TrueCourse think my app
 * is" — a surface this repo does not have is not user information, so it renders
 * nothing at all. It carries no tally: the catalog list beside it counts its own
 * surface groups, and one number said twice is two numbers to keep in agreement.
 *
 * Below: the selected journey as a SEQUENCE DIAGRAM, then its CONTRACT (the full
 * grammar of every command in the tree plus each command's input/output as
 * structured facts — see {@link GuardJourneyContract}), and the
 * flows that use it (click-through into the Tests tab) — every reference a chip
 * of the same shape, wearing the same status word the Flows list wears; a flow
 * whose realization plan reached the journey but could not be authored reads
 * Blocked, with what it needs. With nothing mapped
 * the pane is one CTA — Map is deterministic, LLM-free and free, so it needs no
 * estimate and no confirmation.
 *
 * A journey's truth is its entry in `guard/journeys.json`, so the open journey
 * carries the same two-mode switch every artifact-backed entity has: this page,
 * or that entry verbatim ({@link ArtifactModeSwitch}).
 */

import { Loader2, Route, FlaskConical } from 'lucide-react';
import type { GuardJourneyRow, GuardJourneysView } from '@truecourse/shared';
import { guardDriver, journeyEntryLabel } from '@truecourse/shared';
import { ArtifactModeSwitch, ArtifactRaw, useArtifactMode } from '@/components/ui/artifact-view';
import { EmptyState } from '@/components/ui/empty-state';
import { HoverPopover } from '@/components/ui/hover-popover';
import { useGuardArtifactRaw } from '@/hooks/useGuardArtifactRaw';
import { formatGuardTime, shortFingerprint } from '@/lib/guard-drifts';
import { guardGapNeed, guardPlainStatus, type GuardFlowPlainStatus } from '@/lib/guard-flow-status';
import { GuardJourneyContract } from './GuardJourneyContract';
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
 * One chip per surface found in this repo — runnable ✓ / awaiting its driver ⚠.
 * Drivers the repo has no code for are dropped entirely, and with nothing detected
 * the banner itself disappears (the unmapped/empty body already says what to do).
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
          : 'border-sky-500/60 text-sky-600 dark:text-sky-400';
        const state = s.runnable ? 'runnable ✓' : `${s.waitingLabel ?? 'awaiting driver'} ⚠`;
        return (
          <HoverPopover portal
            key={s.surface}
            width="narrow"
            content={`${s.label} journeys are mapped${s.source ? ` from the ${s.source}` : ''}.`}
          >
            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${tone}`}>
              {s.label} · {state}
            </span>
          </HoverPopover>
        );
      })}
    </div>
  );
}

export function GuardJourneysPane({
  repoId,
  view,
  loading,
  error,
  mapping,
  tabs,
  commandTabs,
  onMap,
  onOpenFlow,
}: {
  /** Whose store the raw mode reads the open journey's entry out of. */
  repoId: string;
  view: GuardJourneysView | null;
  loading: boolean;
  error: string | null;
  mapping: boolean;
  tabs: GuardTabsState;
  /** The contract's command nav — `?gcmd=`, the same tab model as `tabs`. */
  commandTabs: GuardTabsState;
  onMap: () => void;
  onOpenFlow: (flowId: string) => void;
}) {
  const { activeId, openTabs, open, close } = tabs;
  const { mode, setMode, raw } = useArtifactMode('JSON');
  const rawSource = useGuardArtifactRaw(repoId, 'journey', activeId, raw);

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
        body="Hosted repos map their surfaces during the server-side generate."
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
            <button
              type="button"
              onClick={onMap}
              disabled={mapping}
              className="mx-auto mt-1 block rounded border border-border px-2 py-1 text-xs text-foreground hover:bg-muted/40 disabled:opacity-60"
            >
              {mapping ? 'Mapping…' : 'Map · free, no LLM'}
            </button>
          }
        />
      );
    }

    if (!active) {
      return (
        <EmptyState icon={Route} title="Select a journey" body="Select a journey." />
      );
    }

    return (
      <div className="h-full min-w-0 overflow-y-auto overflow-x-hidden px-6 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {guardDriver(active.type)?.label ?? active.type}
          </span>
          <span className="font-mono text-[12px] text-foreground">{active.id}</span>
          <HoverPopover portal width="narrow" content="Fingerprint over the journey's surface-visible shape — what a test is grounded on.">
            <span className="font-mono text-[10px] text-muted-foreground">
              {shortFingerprint(active.fingerprint)}
            </span>
          </HoverPopover>
          <ArtifactModeSwitch format="JSON" mode={mode} onSelect={setMode} className="ml-auto" />
        </div>
        {raw ? (
          <ArtifactRaw content={rawSource.content} label="journey source" />
        ) : (
          <>
        <h2 className="mt-1 text-sm font-semibold text-foreground">{active.title}</h2>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          entry {journeyEntryLabel(active.entry)}
          {active.source ? ` · derived from the ${active.source}` : ''}
          {view.generatedAt ? ` · mapped ${formatGuardTime(view.generatedAt)}` : ''}
        </p>
        {active.specOnly ? (
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Declared in your API docs, but no code route serves it.
          </p>
        ) : null}

        {/* The task's state contract: the world it assumes and the world it
            leaves. Rendered before the sequence so the steps read as the path
            from one to the other. */}
        {(active.startingState || active.endState) && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {active.startingState && (
              <div>
                <div className={LABEL}>Starting state</div>
                <p className="rounded border border-border bg-card/40 px-2.5 py-2 text-[12px] leading-snug text-muted-foreground">
                  {active.startingState}
                </p>
              </div>
            )}
            {active.endState && (
              <div>
                <div className={LABEL}>End state</div>
                <p className="rounded border border-border bg-card/40 px-2.5 py-2 text-[12px] leading-snug text-muted-foreground">
                  {active.endState}
                </p>
              </div>
            )}
          </div>
        )}

        <div className="mt-4">
          <div className={LABEL}>Sequence</div>
          <GuardJourneyDiagram journey={active} label={active.id} />
        </div>

        {/* The contract: the full grammar and each command's input/output — what a
            scenario author (and a reader) needs after knowing WHICH command runs.
            The sequence above already showed the steps; a typed list of the same
            steps underneath it is the same reading twice. */}
        <GuardJourneyContract journey={active} tabs={commandTabs} />

        <div className="mt-4">
          <div className={LABEL}>Used by flows</div>
          {active.flows.length === 0 ? (
            // Reserved for ZERO references of any kind: no scenario grounds here AND
            // no flow's realization plan reached it. A flow that matched but couldn't
            // be authored still counts as used — it reads "blocked" below.
            <p className="text-[12px] text-muted-foreground">
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
                  <FlaskConical className="h-3 w-3 shrink-0" />
                  <span className="truncate">{ref.label}</span>
                  {/* The SAME status chip the Tests list shows — one vocabulary. */}
                  <GuardFlowStatusChip status={ref.status} />
                  {ref.need && <span className="shrink-0 text-muted-foreground">{ref.need}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
          </>
        )}
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
