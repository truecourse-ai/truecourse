/**
 * The Interfaces tab's MAIN PANE, the code half's read surface.
 *
 * The selected interface as a SEQUENCE DIAGRAM, then its CONTRACT (the full
 * grammar of every command in the tree plus each command's input/output as
 * structured facts, see {@link GuardInterfaceContract}), and the
 * flows that use it (click-through into the Tests tab), every reference a chip
 * of the same shape, wearing the same status word the Flows list wears; a flow
 * whose realization plan reached the interface but could not be authored reads
 * Blocked, with what it needs. With nothing mapped
 * the pane is one CTA, Map is deterministic, LLM-free and free, so it needs no
 * estimate and no confirmation.
 *
 * An interface's truth is its entry in `guard/interfaces.json`, so the open interface
 * carries the same two-mode switch every artifact-backed entity has: this page,
 * or that entry verbatim ({@link ArtifactModeSwitch}).
 */

import { Braces, Loader2, FlaskConical } from 'lucide-react';
import type {
  GuardDriverId,
  GuardInterfaceRow,
  GuardInterfacesView,
  GuardRecipeCard as GuardRecipeCardData,
  InterfaceResource,
} from '@/preview/vendor/shared';
import { describeWebLocator, guardDriver, interfaceEntryLabel } from '@/preview/vendor/shared';
import { ArtifactModeSwitch, ArtifactRaw, useArtifactMode } from '@/preview/ui/artifact-view';
import { EmptyState } from '@/components/ui/empty-state';
import { HoverPopover } from '@/preview/ui/hover-popover';
import { useGuardArtifactRaw } from '@/preview/vendor/hooks/useGuardArtifactRaw';
import { formatGuardTime, shortFingerprint } from '@/preview/vendor/lib/guard-drifts';
import { guardGapNeed, guardPlainStatus, type GuardFlowPlainStatus } from '@/preview/vendor/lib/guard-flow-status';
import { GuardInterfaceContract } from '@/preview/vendor/components/guard/GuardInterfaceContract';
import { GuardInterfaceDiagram } from '@/preview/vendor/components/guard/GuardInterfaceDiagram';
import { GuardRecipeDetail } from '@/preview/vendor/components/guard/GuardRecipeDetail';
import { GuardFlowStatusChip } from '@/preview/vendor/components/guard/GuardStatusBadge';
import { GuardTabStrip, type GuardTabStripItem } from '@/preview/vendor/components/guard/GuardTabStrip';
import type { GuardTabsState } from '@/preview/vendor/hooks/useGuardTabs';

/**
 * Every reference to this interface as ONE uniform chip: the flows that use it,
 * plus any grounding test whose flow the corpus can't name (an id-only reference
 * still reads as a FLOW, chipped by its flow id, never as a bare test id, and
 * never as loose text beside real chips).
 */
function interfaceFlowRefs(
  iface: GuardInterfaceRow,
): { flowId: string; label: string; status: GuardFlowPlainStatus; need?: string }[] {
  const refs = iface.flows.map((flow) => ({
    flowId: flow.flowId,
    label: flow.title || flow.flowId,
    status: flow.realized ? guardPlainStatus('guarded') : guardPlainStatus('blocked-on'),
    ...(flow.realized ? {} : { need: flow.gap ? guardGapNeed(flow.gap) : undefined }),
  }));
  const known = new Set(refs.map((r) => r.flowId));
  // A test id is `<flow-id>.<surface>.<n>`, recover the flow it belongs to.
  for (const testId of iface.scenarioIds) {
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

/** One readable line: a fixed lead-in, then the fact in the driver's own words. */
function ReadableLine({ lead, children }: { lead: string; children: React.ReactNode }) {
  return (
    <li className="text-[11px] leading-snug text-muted-foreground">
      <span className="text-foreground/70">{lead}</span> {children}
    </li>
  );
}

/**
 * THE PLACE CARD, the resource the open task acts on, from the catalog's own
 * registry: what kind of place it is, and its READABLES (what the place visibly
 * shows, as the structured facts a scenario can assert on). Locators render
 * through {@link describeWebLocator} so the card, a step list and a failure all
 * use the same words for the same element.
 */
function GuardResourceCard({
  resource,
  sitsOn,
  leavesAt,
}: {
  resource: InterfaceResource;
  /** The title of the resource this one sits on/over (`of`), when it has one. */
  sitsOn?: string;
  leavesAt?: string;
}) {
  const r = resource.readables;
  return (
    <div className="rounded border border-border bg-card/40 px-2.5 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {resource.kind}
        </span>
        <span className="text-[12px] font-medium text-foreground">{resource.title}</span>
        <span className="font-mono text-[10px] text-muted-foreground">{resource.id}</span>
        {sitsOn && (
          <span className="text-[11px] text-muted-foreground">
            {resource.kind === 'dialog' ? 'over' : 'on'} {sitsOn}
          </span>
        )}
        {leavesAt && (
          <span className="text-[11px] text-muted-foreground">→ leaves the user at {leavesAt}</span>
        )}
      </div>
      {resource.description && (
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{resource.description}</p>
      )}
      {r && (
        <ul className="mt-1.5 flex flex-col gap-0.5">
          {r.markers?.map((m, i) => (
            <ReadableLine key={`m${i}`} lead="shows">
              “{m.marker}”{m.within ? `, within ${describeWebLocator(m.within)}` : ''}
              {m.when ? ` (when ${m.when})` : ''}
            </ReadableLine>
          ))}
          {r.elements?.map((e, i) => (
            <ReadableLine key={`e${i}`} lead="renders">
              {describeWebLocator(e.element)}
              {e.when ? ` (when ${e.when})` : ''}
            </ReadableLine>
          ))}
          {r.rows?.map((row, i) => (
            <ReadableLine key={`r${i}`} lead="lists">
              one {row.item} per item{row.within ? ` within ${describeWebLocator(row.within)}` : ''}, shaped{' '}
              <span className="font-mono text-foreground/80">{row.template}</span>
              {row.slots.some((s) => s.kind === 'enum') && (
                <>
                  {', '}
                  {row.slots
                    .filter((s) => s.kind === 'enum')
                    .map((s) => `${s.name}: ${(s.values ?? []).join(' | ')}`)
                    .join(' · ')}
                </>
              )}
              {row.when ? ` (when ${row.when})` : ''}
            </ReadableLine>
          ))}
          {r.controls?.map((c, i) => (
            <ReadableLine key={`c${i}`} lead="control">
              {describeWebLocator(c.control)}, exposes {c.states.join(', ')}
              {c.when ? ` (when ${c.when})` : ''}
            </ReadableLine>
          ))}
        </ul>
      )}
    </div>
  );
}

export function GuardInterfacesPane({
  repoId,
  view,
  loading,
  error,
  tabs,
  recipe = null,
  recipeSurface = null,
  onCloseRecipe,
  prRef,
  onOpenFlow,
}: {
  /** Whose store the raw mode reads the open interface's entry out of. */
  repoId: string;
  view: GuardInterfacesView | null;
  loading: boolean;
  error: string | null;
  tabs: GuardTabsState;
  /** The preparation every test on these surfaces runs against; null = no recipe. */
  recipe?: GuardRecipeCardData | null;
  /** The surface whose recipe is the pane's subject right now, instead of an interface. */
  recipeSurface?: GuardDriverId | null;
  /** Drop the recipe, an interface selection takes the body back. */
  onCloseRecipe?: () => void;
  /** The PR head ref scoping the raw read (EE); undefined at repo level. */
  prRef?: string;
  onOpenFlow: (flowId: string) => void;
}) {
  const { activeId, openTabs, open, close } = tabs;
  const { mode, setMode, raw } = useArtifactMode('JSON');
  const rawSource = useGuardArtifactRaw(repoId, 'interface', activeId, raw);

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
      <EmptyState icon={Braces} title="No interface catalog" body="Interfaces are derived from the working tree." />
    );
  }

  if (view.unavailable === 'no-working-tree') {
    return (
      <EmptyState
        icon={Braces}
        title="No interface catalog stored yet"
        body="A connected repository maps its surfaces during guard setup."
      />
    );
  }

  const active = activeId ? view.interfaces.find((j) => j.id === activeId) ?? null : null;
  const tabItems: GuardTabStripItem[] = openTabs.map((t) => ({
    ...t,
    label: t.id,
    title: view.interfaces.find((j) => j.id === t.id)?.title ?? t.id,
    icon: Braces,
  }));

  const body = (() => {
    // The recipe is a second subject for ONE body, the surface's preparation. It
    // wins while it is open, and any interface selection closes it on the way in.
    if (recipeSurface && recipe) {
      return (
        <GuardRecipeDetail
          repoId={repoId}
          recipe={recipe}
          surface={recipeSurface}
          {...(prRef ? { prRef } : {})}
        />
      );
    }

    if (!view.mapped || view.interfaces.length === 0) {
      return (
        <EmptyState
          icon={Braces}
          title="No interfaces mapped yet"
          body="The interface catalog has not been derived for this repository."
        />
      );
    }

    if (!active) {
      return (
        <EmptyState icon={Braces} title="Select an interface" body="Select an interface." />
      );
    }

    return (
      <div className="h-full min-w-0 overflow-y-auto overflow-x-hidden px-6 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {guardDriver(active.type)?.label ?? active.type}
          </span>
          <span className="font-mono text-[12px] text-foreground">{active.id}</span>
          <HoverPopover portal width="narrow" content="Fingerprint over the interface's surface-visible shape, what a test is grounded on.">
            <span className="font-mono text-[10px] text-muted-foreground">
              {shortFingerprint(active.fingerprint)}
            </span>
          </HoverPopover>
          <ArtifactModeSwitch format="JSON" mode={mode} onSelect={setMode} className="ml-auto" />
        </div>
        {raw ? (
          <ArtifactRaw content={rawSource.content} label="interface source" />
        ) : (
          <>
        <h2 className="mt-1 text-sm font-semibold text-foreground">{active.title}</h2>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          entry {interfaceEntryLabel(active.entry)}
          {view.generatedAt ? ` · mapped ${formatGuardTime(view.generatedAt)}` : ''}
        </p>
        {active.specOnly ? (
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Declared in your API docs, but no code route serves it.
          </p>
        ) : null}

        {/* WHERE the task acts, its place, joined from the registry the view
            carries. Location before world-state, the way the catalog splits
            them: `at`/`to` say the place, the states say the world. */}
        {(() => {
          if (!active.at) return null;
          const areaResources = view.resources?.[active.type] ?? [];
          const place = areaResources.find((res) => res.id === active.at);
          if (!place) return null;
          const dest = active.to
            ? areaResources.find((res) => res.id === active.to)?.title ?? active.to
            : undefined;
          const parent = place.of
            ? areaResources.find((res) => res.id === place.of)?.title ?? place.of
            : undefined;
          return (
            <div className="mt-4">
              <div className={LABEL}>Where</div>
              <GuardResourceCard
                resource={place}
                {...(parent ? { sitsOn: parent } : {})}
                {...(dest ? { leavesAt: dest } : {})}
              />
            </div>
          );
        })()}

        {/* The task's state contract: the world it assumes and the world it
            leaves, each a NAMED state of its area's registry. Rendered before
            the sequence so the steps read as the path from one to the other,
            and rendered mono because these are ids, two tasks chain when they
            match exactly. */}
        {(active.startingState || active.endState) && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {active.startingState && (
              <div>
                <div className={LABEL}>Starting state</div>
                <p className="rounded border border-border bg-card/40 px-2.5 py-2 font-mono text-[12px] leading-snug text-muted-foreground">
                  {active.startingState}
                </p>
              </div>
            )}
            {active.endState && (
              <div>
                <div className={LABEL}>End state</div>
                <p className="rounded border border-border bg-card/40 px-2.5 py-2 font-mono text-[12px] leading-snug text-muted-foreground">
                  {active.endState}
                </p>
              </div>
            )}
          </div>
        )}

        <div className="mt-4">
          <div className={LABEL}>Sequence</div>
          <GuardInterfaceDiagram iface={active} label={active.id} />
        </div>

        {/* The contract, in the surface's OWN vocabulary, what a scenario author
            (and a reader) needs after knowing WHICH thing is invoked. The sequence
            above already showed the steps; a typed list of the same steps
            underneath it is the same reading twice. */}
        <GuardInterfaceContract iface={active} />

        <div className="mt-4">
          <div className={LABEL}>Used by flows</div>
          {active.flows.length === 0 ? (
            // Reserved for ZERO references of any kind: no scenario grounds here AND
            // no flow's realization plan reached it. A flow that matched but couldn't
            // be authored still counts as used, it reads "blocked" below.
            <p className="text-[12px] text-muted-foreground">
              {active.specOnly
                ? 'No flow uses this interface yet.'
                : 'No flow uses this interface, the spec never mentions this code path.'}
            </p>
          ) : (
            <div className="flex flex-col items-start gap-1">
              {interfaceFlowRefs(active).map((ref) => (
                <button
                  key={ref.flowId}
                  type="button"
                  onClick={() => onOpenFlow(ref.flowId)}
                  className="inline-flex max-w-full items-center gap-1 rounded border border-border px-1.5 py-0.5 text-left text-[11px] text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                >
                  <FlaskConical className="h-3 w-3 shrink-0" />
                  <span className="truncate">{ref.label}</span>
                  {/* The SAME status chip the Tests list shows, one vocabulary. */}
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
      {/* No Overview chip: with no interface open this pane IS its no-selection
          state, "pick an interface", and nothing else to read. */}
      <GuardTabStrip
        tabs={tabItems}
        activeId={recipeSurface ? null : activeId}
        onSelect={(t) => {
          onCloseRecipe?.();
          open(t.id, t.pinned);
        }}
        onClose={close}
      />
      <div className="relative min-h-0 flex-1 overflow-hidden">{body}</div>
    </div>
  );
}
