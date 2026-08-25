/**
 * The Interfaces tab's MAIN PANE — one row of the panel, in full.
 *
 * The subject is what the panel selected, and the panel's rows are the surface's
 * own shape (see `lib/interface-pom.ts`), so this pane has three pages:
 *
 *   SCREEN     a top-level web place, AGGREGATED over its panels and dialogs. The
 *              classic pane skeleton (kind chips, the place id, the route and the
 *              mapping time, the description) over ONE section — the CONTRACT —
 *              and the contract is two tables:
 *                Actions      one row per task on the screen or any part of it:
 *                             what it is called, which part it acts on, the worlds
 *                             it needs and leaves, and how many flows use it. A
 *                             row opens IN PLACE into that task's own facts — the
 *                             chevron is the affordance that says it opens.
 *                The page shows
 *                             one row per readable across the parts: what kind of
 *                             fact it is, the fact, the element it is read off,
 *                             the condition, and the part.
 *              A panel or dialog has no page of its own: it has no address, and
 *              everything on it is read on the screen it is part of.
 *   OPERATION  ONE api interface — a method and a path — opened DIRECTLY from the
 *              panel with no endpoint list in between, because the operation is
 *              the thing a caller calls. The endpoint it is served by is one line
 *              ("also on this endpoint"), with its siblings as chips that jump.
 *   COMMAND    one cli interface, whole — its grammar, its io, its flows.
 *
 * Plus the surface's ENTRIES: the members that act at no place at all (every web
 * entry point, in practice — a task that OPENS a screen acts before there is a
 * place to act at).
 *
 * The pane was ENTRY-scoped before (2026-08-24): one interface at a time, its
 * internal id leading, its place, states, sequence and contract rendering as four
 * disconnected sections. Nothing on screen answered "what can I do on this
 * screen", which is the question a reader of a catalog actually has. The first
 * answer nested every place under every place; the second put a fact LIST under
 * each screen and an operations list under each endpoint, which made a reader
 * scan prose to compare two tasks and click twice to reach one operation. This
 * one is TABULAR where the facts are uniform and DIRECT where the row is already
 * the thing. Everything here is a render-time JOIN over the catalog — no field
 * was added to make it. Nothing wears a minted function signature: the runner
 * has no task verb (a scenario executes a task as its individual verb steps), so
 * dressing a task as `camelCase()` would claim a callable that does not exist —
 * a task reads by its TITLE, its identity line is its id, and the elements it
 * touches read in its Sequence. `apiEffects` is deliberately NOT rendered
 * (2026-08-24): implementation traffic, kept to the catalog and the raw view.
 *
 * CROSS-NAVIGATION lands on an INTERFACE id (a flow's "grounds on" jump, a
 * bookmark, the retired `?gjourney` alias), which this pane resolves to the row
 * that owns it: a web task to the SCREEN its place is part of, an operation and a
 * command to themselves. It selects that row, expands the member and scrolls to
 * it. The inbound id is consumed by the selection it produces.
 *
 * An interface's truth is its entry in `guard/interfaces.json`, so an OPEN member
 * carries the same two-mode switch every artifact-backed entity has: this page,
 * or that entry verbatim ({@link ArtifactModeSwitch}). A SCREEN is not one
 * artifact, so with no action open the switch is not offered.
 */

import { Fragment, useEffect, useRef } from 'react';
import { Braces, ChevronDown, ChevronRight, Loader2, FlaskConical } from 'lucide-react';
import type {
  GuardDriverId,
  GuardInterfaceRow,
  GuardInterfacesView,
  GuardRecipeCard as GuardRecipeCardData,
  InterfaceResource,
  InterfaceResourceKind,
  InterfaceState,
} from '@truecourse/shared';
import { guardDriver } from '@truecourse/shared';
import { ArtifactModeSwitch, ArtifactRaw, useArtifactMode } from '@/components/ui/artifact-view';
import { EmptyState } from '@/components/ui/empty-state';
import { HoverPopover } from '@/components/ui/hover-popover';
import { useGuardArtifactRaw } from '@/hooks/useGuardArtifactRaw';
import { useScrollToSelected } from '@/hooks/useScrollToSelected';
import { formatGuardTime, shortFingerprint } from '@/lib/guard-drifts';
import { guardGapNeed, guardPlainStatus, type GuardFlowPlainStatus } from '@/lib/guard-flow-status';
import {
  ENTRIES_PLACE,
  actionWhere,
  buildScreens,
  commandLabel,
  endpointContext,
  entryMethod,
  entryPath,
  findInterfaceBySlug,
  interfaceSelectionId,
  looseEntries,
  memberReturns,
  parsePlaceSelectionId,
  placeSelectionForInterface,
  placeSelectionId,
  screenActions,
  screenShowRows,
  selectsInterface,
  stateTransition,
  surfaceShape,
  topPlaceId,
  type PomScreen,
  type PomShowRow,
} from '@/lib/interface-pom';
import {
  GuardInterfaceContract,
  GuardTableBox,
  GuardWebSequence,
  GuardWebState,
} from './GuardInterfaceContract';
import { GuardMethodLabel } from './GuardMethodLabel';
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
/** A table's own caption — the same size, quieter, and in a reader's own words. */
const TABLE_LABEL = 'mb-1 mt-3 text-[10px] font-medium text-muted-foreground/80';
const CHIP = 'inline-flex items-center gap-1 rounded border border-border px-1 py-px text-[10px] text-muted-foreground';
const KIND = 'rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground';
/** A place reference a click follows — the one affordance for "go there". */
const CROSSLINK = 'underline decoration-dotted underline-offset-2 hover:text-foreground';
/** The table idiom, shared by both of the screen's tables and the contract's. */
const HEAD = 'px-2 py-1 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground';
const CELL = 'px-2 py-1.5 align-top text-[11px] text-foreground';
const MUTED_CELL = `${CELL} text-muted-foreground`;
const STATE_CELL = `${CELL} whitespace-nowrap font-mono text-[10px] text-muted-foreground`;
const NUM_CELL = `${CELL} whitespace-nowrap text-right text-muted-foreground`;
/** Nothing established, in the one glyph the whole tab uses for it. */
const DASH = '—';

/**
 * What a place KIND is called on the page. The registry's word is the derivation's
 * (`rest-noun` is what the api mapper writes); the reader's word for one is the
 * thing they call — an endpoint.
 */
const KIND_WORD: Record<InterfaceResourceKind, string> = {
  screen: 'screen',
  dialog: 'dialog',
  panel: 'panel',
  'command-group': 'command group',
  'rest-noun': 'endpoint',
};

/**
 * A member's TITLE is worth a line only when it says something the mono half does
 * not. A derived cli entry is titled by its argv path and an api entry by its
 * operation — both of which the heading already spells — so the line would be
 * reading itself back. A web task's title is prose nothing else carries.
 */
function titleEchoesEntry(iface: GuardInterfaceRow): boolean {
  const entry = iface.entry;
  const label = 'command' in entry ? entry.command.join(' ') : `${entry.method.toUpperCase()} ${entry.path}`;
  return iface.title === label || iface.title.endsWith(` ${label}`);
}

/** Every flow that uses an interface, as the one chip the Tests list also wears. */
function FlowChips({
  iface,
  onOpenFlow,
}: {
  iface: GuardInterfaceRow;
  onOpenFlow: (flowId: string) => void;
}) {
  if (iface.flows.length === 0) {
    // Reserved for ZERO references of any kind: no scenario grounds here AND no
    // flow's realization plan reached it.
    return (
      <p className="text-[12px] text-muted-foreground">
        {iface.specOnly
          ? 'No flow uses this interface yet.'
          : 'No flow uses this interface — the spec never mentions this code path.'}
      </p>
    );
  }
  return (
    <div className="flex flex-col items-start gap-1">
      {interfaceFlowRefs(iface).map((ref) => (
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
  );
}

/**
 * ONE MEMBER as a row — the ENTRIES page's shape, where the members are a short
 * loose list rather than a screen's uniform table: what you call, what it hands
 * back, and what it costs to know. Opening it drops the member's own contract
 * underneath, so nothing is stored twice.
 *
 * The row is a `role="button"` div rather than a `<button>` for one reason: its
 * DESTINATION — the place this task hands you (`to`) — is itself a way to get
 * there, and a link inside a button is not a thing.
 */
function MemberRow({
  iface,
  open,
  titleOf,
  onToggle,
  onGo,
}: {
  iface: GuardInterfaceRow;
  open: boolean;
  titleOf: (id: string) => string;
  onToggle: () => void;
  onGo: (placeId: string) => void;
}) {
  const returns = memberReturns(iface);
  const transition = stateTransition(iface);
  const destination = iface.to;
  // An api member IS one operation — the row says which, in HTTP's own words,
  // with no minted signature in front of it.
  const method = iface.type === 'api' ? entryMethod(iface) : '';
  return (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={open}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        onToggle();
      }}
      className={`flex w-full cursor-pointer items-center gap-2 border-t border-border/60 px-2 py-1.5 text-left ${
        open ? 'bg-primary/10' : 'hover:bg-muted/40'
      }`}
    >
      {open ? (
        <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
      ) : (
        <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
      )}
      {method ? (
        <>
          <GuardMethodLabel method={method} />
          <span className="min-w-0 truncate font-mono text-[12px] text-foreground">{entryPath(iface)}</span>
        </>
      ) : (
        // A task is not a function anywhere any more — the runner has no task
        // verb — so an entry reads by its TITLE, like the Actions table's rows.
        <span className="min-w-0 truncate text-[12px] text-foreground">{iface.title}</span>
      )}
      {destination && (
        <span className="shrink-0 text-[11px] text-muted-foreground">
          :{' '}
          <button
            type="button"
            className={CROSSLINK}
            onClick={(e) => {
              e.stopPropagation();
              onGo(destination);
            }}
          >
            {titleOf(destination)}
          </button>
        </span>
      )}
      {transition && (
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{transition}</span>
      )}
      <span className="ml-auto flex shrink-0 items-center gap-2">
        {returns && <span className="font-mono text-[11px] text-muted-foreground">→ {returns}</span>}
        <span className="text-[10px] text-muted-foreground">
          {iface.flows.length} flow{iface.flows.length === 1 ? '' : 's'}
        </span>
      </span>
    </div>
  );
}

/**
 * WHAT THE SUBJECT IS. Resolved from the selection and the catalog together —
 * one place, so the tab strip, the panel and this body can never disagree about
 * what is open.
 */
type Subject =
  | { kind: 'screen'; screen: PomScreen }
  | {
      kind: 'operation';
      iface: GuardInterfaceRow;
      /** The endpoint it is served by; absent when the registry names no noun. */
      endpoint?: InterfaceResource;
      /** The other operations on that endpoint, in the panel's own order. */
      siblings: GuardInterfaceRow[];
    }
  | { kind: 'command'; iface: GuardInterfaceRow }
  | { kind: 'entries'; surface: string; members: GuardInterfaceRow[] }
  | { kind: 'gone' };

function resolveSubject(view: GuardInterfacesView, surface: string, placeId: string): Subject {
  const places = view.resources?.[surface] ?? [];
  if (placeId === ENTRIES_PLACE) {
    return { kind: 'entries', surface, members: looseEntries(surface, places, view.interfaces) };
  }
  // The two interface-addressed shapes resolve the SLUG back to its entry; only a
  // screens surface addresses a place.
  if (selectsInterface(surface)) {
    const iface = findInterfaceBySlug(surface, placeId, view.interfaces);
    if (!iface) return { kind: 'gone' };
    if (surfaceShape(surface) === 'commands') return { kind: 'command', iface };
    const { place, siblings } = endpointContext(iface, places, view.interfaces);
    return { kind: 'operation', iface, ...(place ? { endpoint: place } : {}), siblings };
  }
  const screen = buildScreens(surface, places, view.interfaces).find((s) => s.place.id === placeId);
  return screen ? { kind: 'screen', screen } : { kind: 'gone' };
}

/** Every member of the subject, in the order the page lists them. */
function subjectMembers(subject: Subject): GuardInterfaceRow[] {
  if (subject.kind === 'screen') return subject.screen.parts.flatMap((part) => part.members);
  if (subject.kind === 'entries') return subject.members;
  if (subject.kind === 'command' || subject.kind === 'operation') return [subject.iface];
  return [];
}

export function GuardInterfacesPane({
  repoId,
  view,
  loading,
  error,
  tabs,
  member,
  onMember,
  recipe = null,
  recipeSurface = null,
  onCloseRecipe,
  prRef,
  onOpenFlow,
}: {
  /** Whose store the raw mode reads the open member's entry out of. */
  repoId: string;
  view: GuardInterfacesView | null;
  loading: boolean;
  error: string | null;
  /** The ROW tab set — its ids are `<surface>:<placeId|slug>`. */
  tabs: GuardTabsState;
  /** The member expanded inside the open row, by interface id. */
  member?: string | null;
  onMember?: (interfaceId: string | null) => void;
  /** The preparation every test on these surfaces runs against; null = no recipe. */
  recipe?: GuardRecipeCardData | null;
  /** The surface whose recipe is the pane's subject right now, instead of a row. */
  recipeSurface?: GuardDriverId | null;
  /** Drop the recipe — a row selection takes the body back. */
  onCloseRecipe?: () => void;
  /** The PR head ref scoping the raw read (EE); undefined at repo level. */
  prRef?: string;
  onOpenFlow: (flowId: string) => void;
}) {
  const { activeId, openTabs, open, close } = tabs;
  const { mode, setMode, raw } = useArtifactMode('JSON');
  const expanded = member ?? null;

  // WHAT IS OPEN, resolved once — the tab strip, the body and the raw read all
  // read it, so they cannot disagree about the subject.
  const selection = activeId ? parsePlaceSelectionId(activeId) : null;
  const subject = view && selection ? resolveSubject(view, selection.surface, selection.placeId) : null;
  const members = subject ? subjectMembers(subject) : [];
  const openMember = expanded ? members.find((j) => j.id === expanded) ?? null : null;
  // The ONE stored entry this page is a reading of, if there is one. A COMMAND
  // and an OPERATION page are one interface whole, so they have an artifact with
  // nothing expanded; a screen is many, and only an open action names one.
  const artifact =
    subject?.kind === 'command' || subject?.kind === 'operation' ? subject.iface : openMember;

  const rawSource = useGuardArtifactRaw(repoId, 'interface', artifact?.id ?? null, raw && artifact != null);
  const memberRows = useScrollToSelected(expanded, [activeId]);

  // CROSS-NAVIGATION resolves here, because here is where the catalog is: an
  // inbound `?ginterface=` names a member, and the pane's subject is a row. The
  // ref makes the resolution happen ONCE per inbound id — the tab open clears the
  // param, and re-resolving a value the user has since navigated away from would
  // drag them back.
  const resolved = useRef<string | null>(null);
  const inbound = !activeId && expanded && expanded !== resolved.current ? expanded : null;
  const inboundIface = inbound ? view?.interfaces.find((j) => j.id === inbound) ?? null : null;
  const inboundRow = inboundIface
    ? placeSelectionForInterface(inboundIface, view?.resources?.[inboundIface.type])
    : null;
  useEffect(() => {
    // While a row is open, whatever member shows has been ACCOUNTED FOR —
    // record it, so CLOSING that tab later does not read the still-expanded
    // member as a fresh arrival and re-open the row the user just closed.
    if (activeId) {
      resolved.current = expanded;
      return;
    }
    if (!inbound || !inboundRow) return;
    resolved.current = inbound;
    open(inboundRow, true);
  }, [activeId, expanded, inbound, inboundRow, open]);

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

  const areaResources = selection ? view.resources?.[selection.surface] ?? [] : [];
  const areaStates = selection ? view.states?.[selection.surface] : undefined;

  /** The registry title of a place id — the words a reader knows it by. */
  const titleOf = (id: string): string => areaResources.find((r) => r.id === id)?.title ?? id;

  /**
   * Open the row a place belongs to. A panel or a dialog is not a row, so a `to`
   * that names one opens the SCREEN it is part of — the page that reads it.
   */
  const goTo = (placeId: string) => {
    if (!selection) return;
    onCloseRecipe?.();
    onMember?.(null);
    const top = selectsInterface(selection.surface) ? placeId : topPlaceId(placeId, areaResources);
    open(placeSelectionId(selection.surface, top ?? placeId), false);
  };

  /** Open another interface as its own page — a sibling operation's chip. */
  const goToInterface = (iface: GuardInterfaceRow) => {
    onCloseRecipe?.();
    onMember?.(null);
    open(interfaceSelectionId(iface), false);
  };

  /** A row selection as a reader knows it — the row's own words, never the id. */
  const rowLabel = (id: string): string => {
    const parsed = parsePlaceSelectionId(id);
    if (!parsed) return id;
    const surface = guardDriver(parsed.surface)?.label ?? parsed.surface;
    if (parsed.placeId === ENTRIES_PLACE) return `${surface} ways in`;
    if (selectsInterface(parsed.surface)) {
      const iface = findInterfaceBySlug(parsed.surface, parsed.placeId, view.interfaces);
      if (!iface) return id;
      return surfaceShape(parsed.surface) === 'commands'
        ? commandLabel(iface)
        : `${entryMethod(iface)} ${entryPath(iface)}`;
    }
    return (view.resources?.[parsed.surface] ?? []).find((r) => r.id === parsed.placeId)?.title ?? id;
  };

  const tabItems: GuardTabStripItem[] = openTabs.map((t) => ({
    ...t,
    label: rowLabel(t.id),
    title: t.id,
    icon: Braces,
  }));

  /**
   * The member's own identity, its contract and its flows. `nested` is the gutter
   * that hangs it off the row it opened from — a COMMAND or an OPERATION page has
   * no row above it (the page IS the interface), so it carries none.
   */
  const expansion = (iface: GuardInterfaceRow, nested = true) => (
    <div className={nested ? 'mb-1 ml-3 border-l-2 border-border pb-1.5 pl-4' : ''}>
      <div className="flex flex-wrap items-center gap-2 pt-1.5">
        <span className="font-mono text-[10px] text-muted-foreground">{iface.id}</span>
        <HoverPopover
          portal
          width="narrow"
          content="Fingerprint over the interface's surface-visible shape — what a test is grounded on."
        >
          <span className="font-mono text-[10px] text-muted-foreground">
            {shortFingerprint(iface.fingerprint)}
          </span>
        </HoverPopover>
      </div>
      <GuardInterfaceContract
        iface={iface}
        {...(view.states?.[iface.type] ? { states: view.states[iface.type] } : {})}
      />
      <div className="mt-4">
        <div className={LABEL}>Used by flows</div>
        <FlowChips iface={iface} onOpenFlow={onOpenFlow} />
      </div>
      {iface.specOnly && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Declared in your API docs, but no code route serves it.
        </p>
      )}
    </div>
  );

  /** One member and, while it is open, everything under it. */
  const memberBlock = (iface: GuardInterfaceRow) => {
    const isOpen = iface.id === expanded;
    return (
      <div key={iface.id} ref={memberRows.set(iface.id)}>
        <MemberRow
          iface={iface}
          open={isOpen}
          titleOf={titleOf}
          onToggle={() => onMember?.(isOpen ? null : iface.id)}
          onGo={goTo}
        />
        {isOpen && expansion(iface)}
      </div>
    );
  };

  /** The header every page opens with, and the raw switch when a member is open. */
  const heading = (chips: React.ReactNode, title: React.ReactNode, trailing?: React.ReactNode) => (
    <div className="flex flex-wrap items-center gap-2">
      {chips}
      {title}
      {trailing}
      {/* Raw is a reading of ONE stored entry, so it is offered only where the
          page IS one — a command, an operation, or a screen with an action open. */}
      {artifact && <ArtifactModeSwitch format="JSON" mode={mode} onSelect={setMode} className="ml-auto" />}
    </div>
  );

  /** "mapped 2026-08-11 09:18" — when the derivation last ran. */
  const mappedAt = view.generatedAt ? `mapped ${formatGuardTime(view.generatedAt)}` : null;

  const body = (() => {
    // The recipe is a second subject for ONE body — the surface's preparation. It
    // wins while it is open, and any row selection closes it on the way in.
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

    if (!selection || !subject) {
      return <EmptyState icon={Braces} title="Select a place" body="Pick a place from the catalog." />;
    }

    if (subject.kind === 'gone') {
      return (
        <EmptyState
          icon={Braces}
          title="Not in the catalog"
          body="This place is not in the catalog any more — the last mapping did not derive it."
        />
      );
    }

    const surfaceWord = guardDriver(selection.surface)?.label ?? selection.surface;
    // The one-line summary of an OPERATION — the contract's own, not the longer
    // `description` the contract body renders under it.
    const operationSummary = subject.kind === 'operation' ? subject.iface.contract?.summary : undefined;

    return (
      <div className="h-full min-w-0 overflow-y-auto overflow-x-hidden px-6 py-4">
        {subject.kind === 'screen' && (
          <ScreenHeader
            screen={subject.screen}
            surfaceWord={surfaceWord}
            mappedAt={mappedAt}
            heading={heading}
          />
        )}
        {subject.kind === 'operation' && (
          <>
            {heading(
              <>
                <span className={KIND}>{surfaceWord}</span>
                <GuardMethodLabel method={entryMethod(subject.iface)} size="md" />
              </>,
              <h2 className="font-mono text-sm font-semibold text-foreground">
                {entryPath(subject.iface)}
              </h2>,
            )}
            {operationSummary && (
              <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{operationSummary}</p>
            )}
            {/* The ENDPOINT is one line, not a page: it is what the other
                operations on this path share, and each of them is one click. */}
            {subject.endpoint && subject.siblings.length > 0 && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                <span>
                  endpoint <span className="font-mono">{subject.endpoint.title}</span> · also:
                </span>
                {subject.siblings.map((sibling) => (
                  <button
                    key={sibling.id}
                    type="button"
                    onClick={() => goToInterface(sibling)}
                    className={`${CHIP} hover:bg-muted/40 hover:text-foreground`}
                  >
                    <GuardMethodLabel method={entryMethod(sibling)} />
                    <span className="font-mono">{entryPath(sibling)}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
        {subject.kind === 'command' && (
          <>
            {heading(
              <>
                <span className={KIND}>{surfaceWord}</span>
                <span className={KIND}>command</span>
              </>,
              <h2 className="font-mono text-sm font-semibold text-foreground">
                {commandLabel(subject.iface)}
              </h2>,
              titleEchoesEntry(subject.iface) ? undefined : (
                <span className="text-[11px] text-muted-foreground">{subject.iface.title}</span>
              ),
            )}
          </>
        )}
        {subject.kind === 'entries' && (
          <>
            {heading(
              <span className={KIND}>ways in</span>,
              <h2 className="text-sm font-semibold text-foreground">{surfaceWord} ways in</h2>,
            )}
            <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
              Tasks that act at no place — what OPENS this surface, before there is a place to act at.
            </p>
          </>
        )}
        {/* A screen carries the mapping time on its own route line, where it reads
            as one fact about the place; every other page says it here. */}
        {subject.kind !== 'screen' && mappedAt && (
          <p className="mt-0.5 text-[11px] text-muted-foreground">{mappedAt}</p>
        )}

        {raw && artifact ? (
          <div className="mt-3">
            <ArtifactRaw content={rawSource.content} label="interface source" />
          </div>
        ) : subject.kind === 'command' || subject.kind === 'operation' ? (
          // One artifact: no member list, no signature row — the whole page is
          // that one interface.
          expansion(subject.iface, false)
        ) : subject.kind === 'screen' ? (
          <ScreenContract
            screen={subject.screen}
            states={areaStates}
            interfaces={view.interfaces}
            expanded={expanded}
            rowRef={memberRows.set}
            titleOf={titleOf}
            onToggle={(id) => onMember?.(id === expanded ? null : id)}
            onGo={goTo}
            onOpenFlow={onOpenFlow}
          />
        ) : (
          <div className="mt-4">
            <div className={LABEL}>Ways in · {members.length}</div>
            {members.length === 0 ? (
              <p className="py-1 text-[12px] text-muted-foreground">Nothing in the catalog acts here.</p>
            ) : (
              members.map(memberBlock)
            )}
          </div>
        )}
      </div>
    );
  })();

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* No Overview chip: with nothing open this pane IS its no-selection
          state — "pick a place", and nothing else to read. */}
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

/** The screen's own line: what it is, what it is called, and where it lives. */
function ScreenHeader({
  screen,
  surfaceWord,
  mappedAt,
  heading,
}: {
  screen: PomScreen;
  surfaceWord: string;
  mappedAt: string | null;
  heading: (chips: React.ReactNode, title: React.ReactNode, trailing?: React.ReactNode) => React.ReactNode;
}) {
  const { place } = screen;
  // WHERE it is and WHEN it was last read off the tree — one muted line, because
  // they are the two facts about the place itself rather than about its contract.
  // A place with no address carries none: a panel has no route, and a derived
  // screen the mapper could not address is not given a guessed one.
  const where = [place.address ? `route ${place.address}` : null, mappedAt].filter(Boolean).join(' · ');
  return (
    <>
      {heading(
        <>
          <span className={KIND}>{surfaceWord}</span>
          <span className={KIND}>{KIND_WORD[place.kind]}</span>
        </>,
        <span className="font-mono text-[12px] text-foreground">{place.id}</span>,
      )}
      <h2 className="mt-1 text-sm font-semibold text-foreground">{place.title}</h2>
      {where && <p className="mt-0.5 text-[11px] text-muted-foreground">{where}</p>}
      {place.description && (
        <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{place.description}</p>
      )}
    </>
  );
}

/**
 * THE SCREEN'S CONTRACT — its two tables.
 *
 * ACTIONS is every task on the screen and on every part of it, one row each: the
 * parts are a COLUMN rather than a set of headings, because a reader comparing
 * two tasks is comparing what they need and leave, not which panel they happen to
 * sit on. It always renders — zero tasks on a screen is a fact the derivation DID
 * establish, and it is the one that hides the row from the panel.
 *
 * THE PAGE SHOWS is every readable across the parts. It renders only where the
 * catalog established something: a screen nobody wrote readables for gets no
 * table at all rather than a confident "shows · 0".
 */
function ScreenContract({
  screen,
  states,
  interfaces,
  expanded,
  rowRef,
  titleOf,
  onToggle,
  onGo,
  onOpenFlow,
}: {
  screen: PomScreen;
  states: readonly InterfaceState[] | undefined;
  interfaces: readonly GuardInterfaceRow[];
  expanded: string | null;
  rowRef: (id: string) => (el: HTMLTableRowElement | null) => void;
  titleOf: (id: string) => string;
  onToggle: (interfaceId: string) => void;
  onGo: (placeId: string) => void;
  onOpenFlow: (flowId: string) => void;
}) {
  const actions = screenActions(screen);
  const shows = screenShowRows(screen);
  return (
    <>
      <div className={`${LABEL} mt-3`}>Contract</div>

      <div className={TABLE_LABEL}>Actions · {actions.length}</div>
      {actions.length === 0 ? (
        <p className="py-1 text-[12px] text-muted-foreground">Nothing in the catalog acts on this screen.</p>
      ) : (
        <GuardTableBox>
          <table className="w-full border-collapse">
            <thead className="border-b border-border bg-muted/30">
              <tr>
                <th className={`${HEAD} w-2/5`}>Action</th>
                <th className={HEAD}>Where</th>
                <th className={HEAD}>Needs</th>
                <th className={HEAD}>Leaves</th>
                <th className={`${HEAD} text-right`}>Flows</th>
              </tr>
            </thead>
            <tbody>
              {actions.map(({ iface, part }) => {
                const open = iface.id === expanded;
                const destination = iface.to;
                return (
                  <Fragment key={iface.id}>
                    <tr
                      ref={rowRef(iface.id)}
                      tabIndex={0}
                      aria-expanded={open}
                      onClick={() => onToggle(iface.id)}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter' && e.key !== ' ') return;
                        e.preventDefault();
                        onToggle(iface.id);
                      }}
                      className={`cursor-pointer border-b border-border/60 ${
                        open ? 'bg-primary/10' : 'hover:bg-muted/40'
                      }`}
                    >
                      <td className={CELL}>
                        {/* The chevron is the row's ONE affordance — without it a
                            table row does not read as something that opens. The
                            elements the task touches wait in the Sequence below. */}
                        <div className="flex items-center gap-1.5">
                          {open ? (
                            <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                          )}
                          <span className="text-[12px] text-foreground">{iface.title}</span>
                        </div>
                      </td>
                      <td className={`${MUTED_CELL} whitespace-nowrap`}>{actionWhere(screen, part)}</td>
                      <td className={STATE_CELL}>{iface.startingState ?? DASH}</td>
                      <td className={STATE_CELL}>
                        {destination ? (
                          // A task that HANDS YOU somewhere leaves you at a place,
                          // not in a world. It is a LINK only when that place is
                          // another screen — a destination on THIS screen (its own
                          // menu, its own dialog) navigates nowhere, and a
                          // non-link must not dress as one.
                          screen.parts.some((p) => p.place.id === destination) ? (
                            <span className="font-sans text-[11px] text-foreground">
                              → {titleOf(destination)}
                            </span>
                          ) : (
                            <button
                              type="button"
                              className={`${CROSSLINK} font-sans text-[11px] text-foreground`}
                              onClick={(e) => {
                                e.stopPropagation();
                                onGo(destination);
                              }}
                            >
                              → {titleOf(destination)}
                            </button>
                          )
                        ) : (
                          (iface.endState ?? DASH)
                        )}
                      </td>
                      <td className={NUM_CELL}>{iface.flows.length}</td>
                    </tr>
                    {open && (
                      <tr className="border-b border-border/60 bg-card/40">
                        <td colSpan={5} className="p-0">
                          <ActionDetail iface={iface} states={states} onOpenFlow={onOpenFlow} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </GuardTableBox>
      )}

      {shows.length > 0 && (
        <>
          <div className={TABLE_LABEL}>The page shows · {shows.length}</div>
          <GuardTableBox>
            <table className="w-full border-collapse">
              <thead className="border-b border-border bg-muted/30">
                <tr>
                  <th className={HEAD}>Kind</th>
                  <th className={`${HEAD} w-[32%]`}>What</th>
                  <th className={`${HEAD} w-[26%]`}>Locator</th>
                  <th className={HEAD}>When</th>
                  <th className={HEAD}>Where</th>
                </tr>
              </thead>
              <tbody>
                {shows.map((row, i) => (
                  <ShowRow key={`${row.part.id}-${row.kind}-${i}`} screen={screen} row={row} />
                ))}
              </tbody>
            </table>
          </GuardTableBox>
        </>
      )}
    </>
  );
}

/**
 * The Kind column's words, in a reader's vocabulary: what KIND of thing the page
 * shows — a piece of text, an element, repeated rows, a control. The catalog's
 * own verbs (shows/lists/renders/click) read as noise in a column.
 */
const SHOW_KIND_LABEL: Record<PomShowRow['kind'], string> = {
  shows: 'text',
  lists: 'rows',
  renders: 'element',
  click: 'control',
};

/** One readable, as five columns. A control's states are prose; the rest are code. */
function ShowRow({ screen, row }: { screen: PomScreen; row: PomShowRow }) {
  return (
    <tr className="border-b border-border/60 last:border-0">
      <td className={MUTED_CELL}>{SHOW_KIND_LABEL[row.kind]}</td>
      <td className={row.kind === 'click' ? MUTED_CELL : `${CELL} font-mono`}>{row.what}</td>
      <td className={`${CELL} font-mono text-[10px] text-muted-foreground`}>{row.locator ?? DASH}</td>
      <td className={MUTED_CELL}>{row.when ?? DASH}</td>
      <td className={`${MUTED_CELL} whitespace-nowrap`}>{actionWhere(screen, row.part)}</td>
    </tr>
  );
}

/**
 * ONE ACTION, opened in place: what it IS on the left (its id, the fingerprint a
 * test grounds on, the steps in order, the flows that use it) and the world it
 * LEAVES on the right. Every block is the same component the contract renders —
 * one rendering of a sequence, one of a state.
 */
function ActionDetail({
  iface,
  states,
  onOpenFlow,
}: {
  iface: GuardInterfaceRow;
  states: readonly InterfaceState[] | undefined;
  onOpenFlow: (flowId: string) => void;
}) {
  return (
    <div className="grid gap-x-6 gap-y-3 px-3 py-2.5 lg:grid-cols-2">
      <div>
        <div className="mb-1.5 flex flex-wrap items-baseline gap-2">
          <span className="font-mono text-[11px] text-foreground">{iface.id}</span>
          <HoverPopover
            portal
            width="narrow"
            content="Fingerprint over the interface's surface-visible shape — what a test is grounded on."
          >
            <span className="font-mono text-[10px] text-muted-foreground">
              {shortFingerprint(iface.fingerprint)}
            </span>
          </HoverPopover>
        </div>
        <div className={LABEL}>Sequence</div>
        <GuardWebSequence steps={iface.steps} />
        <div className={`${LABEL} mt-3`}>Used by flows</div>
        <FlowChips iface={iface} onOpenFlow={onOpenFlow} />
      </div>
      <div>
        {iface.endState && (
          <>
            <div className={LABEL}>Leaves</div>
            <GuardWebState id={iface.endState} {...(states ? { states } : {})} />
          </>
        )}
      </div>
    </div>
  );
}
