/**
 * The Interfaces tab's LEFT PANEL — the code-derived catalog, grouped by surface
 * (a driver-registry id) and, inside a surface, by FAMILY (the catalog's `group`:
 * the `rules` command tree, the `analyses` route family), with a sticky header per
 * group. Each row is one interface: its id, its entry descriptor, and how many
 * FLOWS use it (the reverse index — realized or matched-but-blocked; zero means
 * code the spec never mentions, the future infer signal).
 *
 * The one thing here that is not an interface is the RECIPE: the panel opens with
 * one row per surface — the preparation THAT surface runs on (cli's build and
 * entrypoint, the api server, the web block). Preparation is per-surface, so
 * there is a row per surface; they sit TOGETHER at the top, before the catalog,
 * so reading one is a single move rather than a hunt down the groups. The
 * narrowing that applies to the catalog applies to them: a panel filtered to one
 * surface offers that surface's recipe alone.
 *
 * The list — its search, its surface filter, its grouping chrome, its preview/pin
 * rows and the scroll-to-selection a cross-navigation jump needs — is the shared
 * {@link EntityList}; this file is the interface ROW and how interfaces group.
 */

import { useCallback, useMemo } from 'react';
import { Hammer } from 'lucide-react';
import type { GuardDriverId, GuardInterfaceRow } from '@truecourse/shared';
import { GUARD_DRIVERS, guardDriver, interfaceEntryLabel } from '@truecourse/shared';
import {
  EntityList,
  entityRowClass,
  type EntityListGroup,
  type FilterOption,
} from '@/components/ui/entity-list';
import { HoverPopover } from '@/components/ui/hover-popover';

export const GUARD_RECIPE_HINT =
  'How guard prepares this repo before a test runs on this surface — the build, the entrypoint, the servers and datastores it starts. Discovered once at setup, reused by every run.';

/**
 * The flow-count hint. A count of zero means NO flow references the interface at
 * all — the honest "code the spec never mentions". An interface used only by flows
 * that matched but could not be authored still counts, and says so.
 */
function usageHint(iface: GuardInterfaceRow): string {
  const n = iface.flows.length;
  if (n === 0) return 'No flow uses this interface — code the spec never mentions.';
  const blocked = iface.flows.filter((f) => !f.realized).length;
  if (blocked === 0) return `Used by ${n} flow(s).`;
  if (blocked === n) return `Used by ${n} flow(s) — all blocked before a test could be written.`;
  return `Used by ${n} flow(s); ${blocked} blocked before a test could be written.`;
}

/** Bucket rows by a key, keeping both the buckets and their rows in first-seen order. */
function bucket(
  rows: GuardInterfaceRow[],
  keyOf: (row: GuardInterfaceRow) => string | undefined,
): Map<string, GuardInterfaceRow[]> {
  const buckets = new Map<string, GuardInterfaceRow[]>();
  for (const row of rows) {
    const key = keyOf(row);
    if (key === undefined) continue;
    const list = buckets.get(key) ?? [];
    list.push(row);
    buckets.set(key, list);
  }
  return buckets;
}

/** The surface's own word — "CLI", "Web" — from the driver registry. */
function surfaceLabel(surface: string): string {
  return guardDriver(surface)?.label ?? surface;
}

/**
 * The surface outside, the FAMILY inside — both in first-seen order, so the panel
 * reads in the catalog's own order. Family is scoped to the surface, as the catalog
 * scopes it: a cli `rules` tree and an api `rules` route family are two families.
 * An entry the derivation left ungrouped belongs to no family and is not invented
 * one — it sits at its surface's top under no header at all.
 *
 * The two levels never wear the same chrome: the surface keeps the full-weight
 * sticky header, the family is `subordinate` — quieter and indented — and its rows
 * indent to it, so surface > family > interface reads at a glance.
 */
function bySurface(interfaces: GuardInterfaceRow[]): EntityListGroup<GuardInterfaceRow>[] {
  return [...bucket(interfaces, (j) => j.type).entries()].map(([surface, rows]) => {
    const group: EntityListGroup<GuardInterfaceRow> = {
      key: surface,
      label: surfaceLabel(surface),
      count: rows.length,
    };
    const families = bucket(rows, (j) => j.group);
    if (families.size === 0) return { ...group, items: rows };
    const loose = rows.filter((j) => !j.group);
    return {
      ...group,
      groups: [
        ...(loose.length > 0 ? [{ key: '', label: '', items: loose }] : []),
        ...[...families.entries()].map(([family, items]) => ({
          key: family,
          label: family,
          subordinate: true,
          items,
        })),
      ],
    };
  });
}

export function GuardInterfacesPanel({
  interfaces,
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
  loading: boolean;
  error: string | null;
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
  onOpen: (id: string, pinned: boolean) => void;
}) {
  // The catalog counted once, by the same predicate that narrows it — a chip can
  // never promise rows the list won't show. Only surfaces this catalog HAS get a
  // chip: a driver with no code behind it is engine knowledge, not user information.
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
  // Memoized with the grouping below so the list is not re-grouped every render.
  const recipeRows = useCallback(
    (shown: readonly string[]): EntityListGroup<GuardInterfaceRow> | null => {
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

  const group = useCallback(
    (rows: GuardInterfaceRow[]) => {
      const groups = bySurface(rows);
      // The surfaces the catalog is SHOWING, in the order it shows them — so the
      // filter (and the search) narrows the recipe rows by the same rule it
      // narrows the rows underneath them.
      const recipes = recipeRows(groups.map((g) => g.key));
      return recipes ? [recipes, ...groups] : groups;
    },
    [recipeRows],
  );

  return (
    <EntityList<GuardInterfaceRow>
      label="Interface catalog"
      items={interfaces}
      group={group}
      itemId={(j) => j.id}
      // An entry in a family sits under its family header; one in no family stays
      // at the surface's own edge.
      activeId={activeId}
      onOpen={onOpen}
      loading={loading}
      error={error}
      search={{
        placeholder: 'Search interfaces…',
        ariaLabel: 'Search interfaces',
        match: (j, q) => `${j.id} ${j.title} ${interfaceEntryLabel(j.entry)}`.toLowerCase().includes(q),
      }}
      filter={{
        label: 'Surface',
        ariaLabel: 'Filter by surface',
        options,
        selected: surfaces,
        onChange: onSurfaces,
        match: (j, key) => j.type === key,
      }}
      noMatch="No interfaces match these filters."
      // The MAIN pane says what an empty catalog means — the panel stays quiet.
      emptyText="No interfaces mapped yet."
      renderRow={(iface) => (
        <>
          <div className="flex w-full items-center gap-2">
            <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-foreground">{iface.id}</span>
            <HoverPopover portal width="narrow" content={usageHint(iface)}>
              <span
                className={`shrink-0 text-[10px] ${
                  iface.flows.length === 0 ? 'text-foreground' : 'text-muted-foreground'
                }`}
              >
                {iface.flows.length} flow{iface.flows.length === 1 ? '' : 's'}
              </span>
            </HoverPopover>
          </div>
          <span className="w-full truncate text-[11px] text-muted-foreground">{iface.title}</span>
        </>
      )}
    />
  );
}
