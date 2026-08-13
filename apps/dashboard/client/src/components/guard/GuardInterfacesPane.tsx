/**
 * The Interfaces tab's MAIN PANE — the code half's read surface.
 *
 * The selected interface as a SEQUENCE DIAGRAM, then its CONTRACT (the full
 * grammar of every command in the tree plus each command's input/output as
 * structured facts — see {@link GuardInterfaceContract}), and the
 * flows that use it (click-through into the Tests tab) — every reference a chip
 * of the same shape, wearing the same status word the Flows list wears; a flow
 * whose realization plan reached the interface but could not be authored reads
 * Blocked, with what it needs. With nothing mapped
 * the pane is one CTA — Map is deterministic, LLM-free and free, so it needs no
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
} from '@truecourse/shared';
import { guardDriver, interfaceEntryLabel } from '@truecourse/shared';
import { ArtifactModeSwitch, ArtifactRaw, useArtifactMode } from '@/components/ui/artifact-view';
import { EmptyState } from '@/components/ui/empty-state';
import { HoverPopover } from '@/components/ui/hover-popover';
import { useGuardArtifactRaw } from '@/hooks/useGuardArtifactRaw';
import { formatGuardTime, shortFingerprint } from '@/lib/guard-drifts';
import { guardGapNeed, guardPlainStatus, type GuardFlowPlainStatus } from '@/lib/guard-flow-status';
import { GuardInterfaceContract } from './GuardInterfaceContract';
import { GuardInterfaceDiagram } from './GuardInterfaceDiagram';
import { GuardRecipeDetail } from './GuardRecipeDetail';
import { GuardFlowStatusChip } from './GuardStatusBadge';
import { GuardTabStrip, type GuardTabStripItem } from './GuardTabStrip';
import type { GuardTabsState } from '@/hooks/useGuardTabs';

/**
 * Every reference to this interface as ONE uniform chip: the flows that use it,
 * plus any grounding test whose flow the corpus can't name (an id-only reference
 * still reads as a FLOW — chipped by its flow id, never as a bare test id, and
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
  // A test id is `<flow-id>.<surface>.<n>` — recover the flow it belongs to.
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

export function GuardInterfacesPane({
  repoId,
  view,
  loading,
  error,
  tabs,
  commandTabs,
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
  /** The contract's command nav — `?gcmd=`, the same tab model as `tabs`. */
  commandTabs: GuardTabsState;
  /** The preparation every test on these surfaces runs against; null = no recipe. */
  recipe?: GuardRecipeCardData | null;
  /** The surface whose recipe is the pane's subject right now, instead of an interface. */
  recipeSurface?: GuardDriverId | null;
  /** Drop the recipe — an interface selection takes the body back. */
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
        title="No working tree to map"
        body="Hosted repos map their surfaces during the server-side generate."
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
    // The recipe is a second subject for ONE body — the surface's preparation. It
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
          <HoverPopover portal width="narrow" content="Fingerprint over the interface's surface-visible shape — what a test is grounded on.">
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

        {/* The task's state contract: the world it assumes and the world it
            leaves, each a NAMED state of its area's registry. Rendered before
            the sequence so the steps read as the path from one to the other,
            and rendered mono because these are ids — two tasks chain when they
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

        {/* The contract: the full grammar and each command's input/output — what a
            scenario author (and a reader) needs after knowing WHICH command runs.
            The sequence above already showed the steps; a typed list of the same
            steps underneath it is the same reading twice. */}
        <GuardInterfaceContract iface={active} tabs={commandTabs} />

        <div className="mt-4">
          <div className={LABEL}>Used by flows</div>
          {active.flows.length === 0 ? (
            // Reserved for ZERO references of any kind: no scenario grounds here AND
            // no flow's realization plan reached it. A flow that matched but couldn't
            // be authored still counts as used — it reads "blocked" below.
            <p className="text-[12px] text-muted-foreground">
              {active.specOnly
                ? 'No flow uses this interface yet.'
                : 'No flow uses this interface — the spec never mentions this code path.'}
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
      {/* No Overview chip: with no interface open this pane IS its no-selection
          state — "pick an interface", and nothing else to read. */}
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
