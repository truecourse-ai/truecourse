/**
 * The Interfaces tab's LEFT PANEL — the code-derived catalog, grouped by surface
 * (a driver-registry id) with a sticky header per group. Each row is one interface:
 * its id, its entry descriptor, and how many FLOWS use it (the reverse index —
 * realized or matched-but-blocked; zero means code the spec never mentions, the
 * future infer signal).
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

/** One interface per surface group, in first-seen order. */
function bySurface(interfaces: GuardInterfaceRow[]): EntityListGroup<GuardInterfaceRow>[] {
  const groups = new Map<string, GuardInterfaceRow[]>();
  for (const j of interfaces) {
    const list = groups.get(j.type) ?? [];
    list.push(j);
    groups.set(j.type, list);
  }
  return [...groups.entries()].map(([surface, rows]) => ({
    key: surface,
    label: `${guardDriver(surface)?.label ?? surface}${rows[0]?.source ? ` · ${rows[0].source}` : ''}`,
    count: rows.length,
    items: rows,
  }));
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
