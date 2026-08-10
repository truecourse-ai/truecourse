/**
 * The Interfaces tab's LEFT PANEL — the code-derived catalog, grouped by surface
 * (a driver-registry id) and, inside a surface, by FAMILY (the catalog's `group`:
 * the `rules` command tree, the `analyses` route family), with a sticky header per
 * group. Each row is one interface: its id, its entry descriptor, and how many
 * FLOWS use it (the reverse index — realized or matched-but-blocked; zero means
 * code the spec never mentions, the future infer signal).
 *
 * The list — its search, its grouping chrome, its preview/pin rows and the
 * scroll-to-selection a cross-navigation jump needs — is the shared
 * {@link EntityList}; this file is the interface ROW and how interfaces group.
 */

import type { GuardInterfaceRow } from '@truecourse/shared';
import { guardDriver, interfaceEntryLabel } from '@truecourse/shared';
import { EntityList, type EntityListGroup } from '@/components/ui/entity-list';
import { HoverPopover } from '@/components/ui/hover-popover';

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
      label: guardDriver(surface)?.label ?? surface,
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
  onOpen,
}: {
  interfaces: GuardInterfaceRow[];
  loading: boolean;
  error: string | null;
  activeId: string | null;
  onOpen: (id: string, pinned: boolean) => void;
}) {
  return (
    <EntityList<GuardInterfaceRow>
      label="Interface catalog"
      items={interfaces}
      group={bySurface}
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
      noMatch="No interfaces match this search."
      // The MAIN pane carries the single Map CTA — the panel stays quiet.
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
