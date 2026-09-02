/**
 * The Interfaces tab's LEFT PANEL — SCREENS, OPERATIONS AND COMMANDS, one flat
 * row each.
 *
 * The panel is a SKIM. Nothing here expands, nothing nests, and no row hides
 * another: a reader picking what to open should be able to see the whole surface
 * at once, and every fold is a thing they have to open before they can. What a
 * row is comes from the surface, because the three surfaces are three different
 * kinds of thing (see `lib/interface-pom.ts`):
 *
 *   web   one row per SCREEN — a top-level place — carrying how many interfaces
 *         are on it, its own and every part's. A panel or dialog is not a row: it
 *         has no address, and the pane reads it on the screen it is part of.
 *   api   one row per OPERATION — a method and a path, which is the thing a
 *         caller calls. The REST NOUN is not a row: it is the ORDER (an
 *         endpoint's operations stay adjacent, sorted GET · HEAD · POST · PUT ·
 *         PATCH · DELETE) and the "also on this endpoint" line on the page. The
 *         method leads the row in its own colour, because "what does this do to
 *         the thing" is the whole question a path list is asked.
 *   cli   one row per COMMAND. A command group is a prefix its members already
 *         spell, so a group row would be the same words twice.
 *
 * A row with NOTHING TO DO is not a destination and is not shown — a screen no
 * task acts on. On api it is the ENDPOINT that can be empty, and an empty
 * endpoint has no row to drop in the first place, so it is counted straight off
 * the catalog. Either way the tally is said out loud under the rows ("1 screen
 * with nothing to do hidden", "2 endpoints with no operations hidden"), so a
 * reader can tell an empty catalog from a filtered one.
 *
 * Two kinds of row are not places:
 *
 *  - the RECIPE rows the panel opens with — the preparation THAT surface runs on
 *    (cli's build and entrypoint, the api server, the web block). Preparation is
 *    per-surface, so there is one per surface, together at the top, before the
 *    catalog. The narrowing that applies to the catalog applies to them.
 *  - the ENTRIES row of a surface: ONE row standing for every member that acts at
 *    no place at all — every `web` entry point, in practice, since a task that
 *    OPENS a screen acts before there is a place to act at. It reads as a row
 *    like the screens beside it (a name and a tally, its hint saying what an
 *    entry IS), and opens onto the page that lists them. A subordinate GROUP of
 *    title rows would make three tasks read as a fourth kind of thing in a panel
 *    of screens. Only a SCREENS surface has one:
 *    where the row is the interface, a member with no place is simply its own row.
 *
 * The list — its search, its surface filter, its grouping chrome, its recipe rows
 * and the scroll-to-selection a cross-navigation jump needs — is the shared
 * {@link EntityList}; this file is the ROW of each shape and the counting around
 * it.
 */

import { useCallback, useMemo } from 'react';
import { Hammer } from 'lucide-react';
import type { GuardDriverId, GuardInterfaceRow, InterfaceResource } from '@truecourse/shared';
import { GUARD_DRIVERS, guardDriver } from '@truecourse/shared';
import {
  EntityList,
  entityRowClass,
  type EntityListGroup,
  type FilterOption,
} from '@/components/ui/entity-list';
import { HoverPopover } from '@/components/ui/hover-popover';
import { GuardMethodLabel } from './GuardMethodLabel';
import {
  ENTRIES_PLACE,
  buildCommands,
  buildEndpoints,
  buildOperations,
  buildScreens,
  commandHaystack,
  looseEntries,
  memberHaystack,
  operationHaystack,
  placeSelectionId,
  screenHaystack,
  surfaceShape,
  type PomCommand,
  type PomOperation,
  type PomScreen,
  type PomSurfaceShape,
} from '@/lib/interface-pom';

/**
 * What the WAYS IN row holds, at the one place a reader meets it. Its members act
 * at no place because they run BEFORE any screen is open — each one navigates to
 * an address, and where it lands is the screen a scenario carries on from.
 */
export const ENTRIES_HINT =
  'Tasks that open this surface at an address, before any screen is open. A scenario starts at one of these, then acts on the screen it lands on.';

export const GUARD_RECIPE_HINT =
  'How guard prepares this repo before a test runs on this surface — the build, the entrypoint, the servers and datastores it starts. Discovered once at setup, reused by every run.';

/**
 * One row of the panel — a screen, an operation, a command, or the surface's
 * ENTRIES: the one row that stands for every member acting at no place at all.
 */
type PanelRow =
  | { kind: 'screen'; screen: PomScreen }
  | { kind: 'operation'; operation: PomOperation }
  | { kind: 'command'; command: PomCommand }
  | { kind: 'entries'; surface: string; members: readonly GuardInterfaceRow[] };

function rowId(row: PanelRow): string {
  if (row.kind === 'screen') return row.screen.id;
  if (row.kind === 'operation') return row.operation.id;
  if (row.kind === 'command') return row.command.id;
  // The entries row IS its selection: the surface's placeless address.
  return placeSelectionId(row.surface, ENTRIES_PLACE);
}

function rowSurface(row: PanelRow): string {
  if (row.kind === 'screen') return row.screen.surface;
  if (row.kind === 'operation') return row.operation.surface;
  if (row.kind === 'command') return row.command.surface;
  return row.surface;
}

function rowHaystack(row: PanelRow): string {
  if (row.kind === 'screen') return screenHaystack(row.screen);
  if (row.kind === 'operation') return operationHaystack(row.operation);
  if (row.kind === 'command') return commandHaystack(row.command);
  // One row standing for many: it must answer for every member it holds, or
  // searching a task by name would lose the row that opens onto it.
  return row.members.map(memberHaystack).join(' ');
}

/**
 * Has this row anything to do? A screen no task acts on is a catalog fact with no
 * destination behind it — counted, never listed. An operation and a command ARE
 * their one interface, and an entries row is only built when it holds members, so
 * those always have.
 */
function rowHasWork(row: PanelRow): boolean {
  return row.kind === 'screen' ? row.screen.count > 0 : true;
}

/** The surface's own word — "CLI", "Web" — from the driver registry. */
function surfaceLabel(surface: string): string {
  return guardDriver(surface)?.label ?? surface;
}

interface Noun {
  one: string;
  many: string;
}

/** What a row of this surface IS, for the count line. */
const ROW_NOUN: Record<PomSurfaceShape, Noun> = {
  screens: { one: 'screen', many: 'screens' },
  operations: { one: 'operation', many: 'operations' },
  commands: { one: 'command', many: 'commands' },
};

/** What a SCREEN row holds — the second half of its count line. */
const SCREEN_MEMBER_NOUN: Noun = { one: 'interface', many: 'interfaces' };

/** What an operation row is served BY — the thing its count line counts across. */
const ENDPOINT_NOUN: Noun = { one: 'endpoint', many: 'endpoints' };

/** What the tally UNDER the rows counts — a screen, or (on api) an endpoint. */
const HIDDEN_NOUN: Record<PomSurfaceShape, Noun> = {
  screens: ROW_NOUN.screens,
  operations: ENDPOINT_NOUN,
  commands: ROW_NOUN.commands,
};

/**
 * Why the things under the list are not listed, in the surface's own words — a
 * screen has nothing to DO on it, an endpoint serves no OPERATION. A command row
 * is its own interface and can never be empty, so its phrase never renders.
 */
const HIDDEN_PHRASE: Record<PomSurfaceShape, string> = {
  screens: 'with nothing to do hidden',
  operations: 'with no operations hidden',
  commands: 'hidden',
};

function plural(n: number, noun: Noun): string {
  return `${n} ${n === 1 ? noun.one : noun.many}`;
}

/** How many interfaces a row holds — an operation and a command are one. */
function rowHolds(row: PanelRow): number {
  if (row.kind === 'screen') return row.screen.count;
  if (row.kind === 'entries') return row.members.length;
  return 1;
}

/**
 * The surfaces present, in registry order — the outer grouping level, and the
 * order everything under it inherits. A surface the driver registry does not
 * name still gets its rows shown, at the end: an unknown driver is a catalog
 * fact, and dropping it would hide code.
 */
function orderSurfaces(present: Iterable<string>): string[] {
  const seen = new Set(present);
  const registry = GUARD_DRIVERS.map((d) => d.id as string).filter((id) => seen.has(id));
  return [...registry, ...[...seen].filter((id) => !registry.includes(id))];
}

/** The screen's tally — zero never renders (the row is hidden), so it always counts. */
function screenHint(screen: PomScreen): string {
  const parts = screen.parts.length - 1;
  const on = parts === 0 ? '' : ` across it and ${plural(parts, { one: 'part', many: 'parts' })}`;
  return `${plural(screen.count, SCREEN_MEMBER_NOUN)} on this screen${on}.`;
}

/** How many endpoints a surface has, split by whether anything serves them. */
interface EndpointTally {
  served: number;
  empty: number;
}

export function GuardInterfacesPanel({
  interfaces,
  resources,
  loading,
  error,
  activeId,
  surfaces,
  onSurfaces,
  hasRecipe = false,
  recipeSurface = null,
  onToggleRecipe,
  onOpen,
}: {
  interfaces: GuardInterfaceRow[];
  /** The catalog's resource registry, per area — the places this panel reads. */
  resources?: Record<string, InterfaceResource[]>;
  loading: boolean;
  error: string | null;
  /** The selected ROW, as `<surface>:<placeId|slug>` — see `placeSelectionId`. */
  activeId: string | null;
  /** The surfaces the list is narrowed to; empty = every surface. */
  surfaces: readonly string[];
  onSurfaces: (next: string[]) => void;
  /**
   * The repo has a `recipe.json`. False (never discovered) hides the per-surface
   * openers entirely — an opener onto nothing is not a destination.
   */
  hasRecipe?: boolean;
  /** The surface whose recipe the main pane is showing — that opener reads pressed. */
  recipeSurface?: string | null;
  onToggleRecipe?: (surface: GuardDriverId) => void;
  /** Open a row; `member` also expands (and scrolls to) one interface on it. */
  onOpen: (selection: string, pinned: boolean, member?: string) => void;
}) {
  // Every row of every surface, built once per catalog, plus the ENDPOINT tally
  // an api surface counts out under its rows (an empty endpoint has no row, so
  // it cannot be derived from the rows the narrowing leaves standing). The rows a
  // narrowing drops are dropped by EntityList; nothing is rebuilt for it.
  const { rows, endpoints } = useMemo<{ rows: PanelRow[]; endpoints: Map<string, EndpointTally> }>(() => {
    const out: PanelRow[] = [];
    const tally = new Map<string, EndpointTally>();
    const present = orderSurfaces([
      ...interfaces.map((iface) => iface.type as string),
      ...Object.keys(resources ?? {}),
    ]);
    for (const surface of present) {
      const places = resources?.[surface] ?? [];
      const shape = surfaceShape(surface);
      if (shape === 'commands') {
        for (const command of buildCommands(surface, interfaces)) out.push({ kind: 'command', command });
        continue;
      }
      if (shape === 'operations') {
        for (const operation of buildOperations(surface, places, interfaces)) {
          out.push({ kind: 'operation', operation });
        }
        const served = buildEndpoints(surface, places, interfaces).filter((e) => e.members.length > 0);
        tally.set(surface, { served: served.length, empty: places.length - served.length });
        continue;
      }
      // Entries first: what OPENS the surface reads before what is inside it —
      // ONE row for all of them, because they are one destination, not many.
      const entries = looseEntries(surface, places, interfaces);
      if (entries.length > 0) out.push({ kind: 'entries', surface, members: entries });
      for (const screen of buildScreens(surface, places, interfaces)) out.push({ kind: 'screen', screen });
    }
    return { rows: out, endpoints: tally };
  }, [interfaces, resources]);

  // What the search reads, per row: a row matches on its OWN words and on
  // everything it holds — looking for a task must find the screen it is on.
  const haystacks = useMemo(() => new Map(rows.map((row) => [rowId(row), rowHaystack(row)])), [rows]);

  // The catalog counted once, by INTERFACES — the chip answers "how much code is
  // on this surface", which is what a reader is choosing between. Only surfaces
  // this catalog HAS get a chip: a driver with no code behind it is engine
  // knowledge, not user information.
  const options = useMemo<FilterOption[]>(
    () =>
      GUARD_DRIVERS.map((d) => d.id as string)
        .map((surface) => ({
          key: surface,
          label: surfaceLabel(surface),
          count: interfaces.filter((j) => j.type === surface).length,
        }))
        .filter((o) => o.count > 0),
    [interfaces],
  );

  // The recipe rows, one per surface the catalog is showing, TOGETHER at the top
  // of the list: a headerless group whose rows are the openers. They are rows of
  // this list, not buttons floating above it — same wrapper, same paint, same
  // hover — because the only thing that sets them apart is what they open.
  const recipeRows = useCallback(
    (shown: readonly string[]): EntityListGroup<PanelRow> | null => {
      if (!hasRecipe || !onToggleRecipe || shown.length === 0) return null;
      return {
        key: '',
        label: '',
        lead: (
          <>
            {shown.map((surface) => {
              const open = recipeSurface === surface;
              return (
                <div key={surface} role="listitem">
                  <button
                    type="button"
                    aria-pressed={open}
                    onClick={() => onToggleRecipe(surface as GuardDriverId)}
                    className={entityRowClass({ active: open })}
                  >
                    <HoverPopover portal width="wide" align="start" content={GUARD_RECIPE_HINT}>
                      <span className="flex items-center gap-2 text-[12px] text-foreground">
                        <Hammer className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        {surfaceLabel(surface)} recipe
                      </span>
                    </HoverPopover>
                  </button>
                </div>
              );
            })}
          </>
        ),
      };
    },
    [hasRecipe, recipeSurface, onToggleRecipe],
  );

  /**
   * The surface outside, its rows inside — flat, in catalog order, the surface's
   * ENTRIES row first. It is a row like any other rather than a subordinate
   * group of its own, which would make three tasks read as a fourth kind of
   * thing in a panel of screens. The rows with nothing to do are counted out
   * under the group rather than listed.
   */
  const group = useCallback(
    (visible: PanelRow[]) => {
      const groups = orderSurfaces(visible.map(rowSurface)).map((surface): EntityListGroup<PanelRow> => {
        const mine = visible.filter((row) => rowSurface(row) === surface);
        const shown = mine.filter(rowHasWork);
        const shape = surfaceShape(surface);
        // On a places surface the hidden things are the rows this list dropped;
        // on an operations surface the hidden thing is an ENDPOINT, which never
        // had a row — it is a catalog fact, counted off the catalog.
        const hidden = shape === 'operations' ? endpoints.get(surface)?.empty ?? 0 : mine.length - shown.length;
        return {
          key: surface,
          label: surfaceLabel(surface),
          count: shown.length,
          items: shown,
          ...(hidden > 0
            ? {
                footer: (
                  <div className="px-3 py-1.5 text-[10px] text-muted-foreground">
                    {plural(hidden, HIDDEN_NOUN[shape])} {HIDDEN_PHRASE[shape]}
                  </div>
                ),
              }
            : {}),
        };
      });
      // The surfaces the catalog is SHOWING, in the order it shows them — so the
      // filter (and the search) narrows the recipe rows by the same rule it
      // narrows the rows underneath them.
      const recipes = recipeRows(groups.map((g) => g.key));
      return recipes ? [recipes, ...groups] : groups;
    },
    [endpoints, recipeRows],
  );

  /**
   * The count line, in the surface's own words. One surface open reads as the
   * mock does — the rows, then what they are of ("5 screens · 55 interfaces",
   * "32 operations across 20 endpoints"); several open read as one segment each,
   * because a single "interfaces" total across three different kinds of row says
   * nothing a reader can use.
   */
  const countLine = useMemo(() => {
    const kept = surfaces.length === 0 ? rows : rows.filter((row) => surfaces.includes(rowSurface(row)));
    const segments = orderSurfaces(kept.map(rowSurface)).map((surface) => {
      const mine = kept.filter((row) => rowSurface(row) === surface);
      return {
        surface,
        shape: surfaceShape(surface),
        // The entries row is not a SCREEN, so it is not counted as one — but what
        // it holds is counted below, because those are interfaces like any other.
        rows: mine.filter((row) => row.kind !== 'entries' && rowHasWork(row)).length,
        // A hidden row holds nothing by definition, so this is the surface's whole
        // catalog — the entries included, since they are interfaces too.
        holds: mine.reduce((n, row) => n + rowHolds(row), 0),
      };
    });
    const only = segments.length === 1 ? segments[0] : undefined;
    if (only) {
      // A command row IS its interface — saying both numbers would say it twice.
      if (only.shape === 'commands') return plural(only.holds, ROW_NOUN.commands);
      if (only.shape === 'operations') {
        const served = endpoints.get(only.surface)?.served ?? 0;
        return `${plural(only.rows, ROW_NOUN.operations)} across ${plural(served, ENDPOINT_NOUN)}`;
      }
      return `${plural(only.rows, ROW_NOUN.screens)} · ${plural(only.holds, SCREEN_MEMBER_NOUN)}`;
    }
    if (segments.length === 0) return null;
    return segments.map((s) => plural(s.rows, ROW_NOUN[s.shape])).join(' · ');
  }, [endpoints, rows, surfaces]);

  return (
    <EntityList<PanelRow>
      label="Interface catalog"
      items={rows}
      group={group}
      itemId={rowId}
      // The entries row carries the surface's placeless address, so the selection
      // paints and scrolls it like any other row — no member-level special case.
      activeId={activeId}
      {...(countLine ? { countLine } : {})}
      onOpen={(id, pinned) => onOpen(id, pinned)}
      loading={loading}
      error={error}
      search={{
        placeholder: 'Search interfaces…',
        ariaLabel: 'Search interfaces',
        match: (row, q) => (haystacks.get(rowId(row)) ?? '').includes(q),
      }}
      filter={{
        label: 'Drivers',
        ariaLabel: 'Filter by driver',
        options,
        selected: surfaces,
        onChange: onSurfaces,
        multi: true,
        match: (row, key) => rowSurface(row) === key,
      }}
      noMatch="No interfaces match these filters."
      // The MAIN pane says what an empty catalog means — the panel stays quiet.
      emptyText="No interfaces mapped yet."
      renderRow={(row) => {
        if (row.kind === 'entries') {
          return (
            <div className="flex w-full items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[12px] text-foreground">Ways in</span>
              <HoverPopover portal width="wide" content={ENTRIES_HINT}>
                <span className="shrink-0 text-[10px] text-muted-foreground">{row.members.length}</span>
              </HoverPopover>
            </div>
          );
        }
        if (row.kind === 'command') {
          return (
            <span className="w-full truncate font-mono text-[11px] text-foreground">{row.command.label}</span>
          );
        }
        if (row.kind === 'operation') {
          return (
            <div className="flex w-full items-center gap-2">
              <GuardMethodLabel method={row.operation.method} fixed />
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground">
                {row.operation.path}
              </span>
            </div>
          );
        }
        return (
          <div className="flex w-full items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-[12px] text-foreground">
              {row.screen.place.title}
            </span>
            <HoverPopover portal width="narrow" content={screenHint(row.screen)}>
              <span className="shrink-0 text-[10px] text-muted-foreground">{row.screen.count}</span>
            </HoverPopover>
          </div>
        );
      }}
    />
  );
}
