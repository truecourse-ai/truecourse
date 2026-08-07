/**
 * The Journeys tab's LEFT PANEL — the code-derived catalog, grouped by surface
 * (a driver-registry id) with a sticky header per group. Each row is one journey:
 * its id, its entry descriptor, and how many FLOWS use it (the reverse index —
 * realized or matched-but-blocked; zero means code the spec never mentions, the
 * future infer signal).
 *
 * The list — its search, its grouping chrome, its preview/pin rows and the
 * scroll-to-selection a cross-navigation jump needs — is the shared
 * {@link EntityList}; this file is the journey ROW and how journeys group.
 */

import type { GuardJourneyRow } from '@truecourse/shared';
import { guardDriver, journeyEntryLabel } from '@truecourse/shared';
import { EntityList, type EntityListGroup } from '@/components/ui/entity-list';
import { HoverPopover } from '@/components/ui/hover-popover';

/**
 * The flow-count hint. A count of zero means NO flow references the journey at
 * all — the honest "code the spec never mentions". A journey used only by flows
 * that matched but could not be authored still counts, and says so.
 */
function usageHint(journey: GuardJourneyRow): string {
  const n = journey.flows.length;
  if (n === 0) return 'No flow uses this journey — code the spec never mentions.';
  const blocked = journey.flows.filter((f) => !f.realized).length;
  if (blocked === 0) return `Used by ${n} flow(s).`;
  if (blocked === n) return `Used by ${n} flow(s) — all blocked before a test could be written.`;
  return `Used by ${n} flow(s); ${blocked} blocked before a test could be written.`;
}

/** One journey per surface group, in first-seen order. */
function bySurface(journeys: GuardJourneyRow[]): EntityListGroup<GuardJourneyRow>[] {
  const groups = new Map<string, GuardJourneyRow[]>();
  for (const j of journeys) {
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

export function GuardJourneysPanel({
  journeys,
  loading,
  error,
  activeId,
  onOpen,
}: {
  journeys: GuardJourneyRow[];
  loading: boolean;
  error: string | null;
  activeId: string | null;
  onOpen: (id: string, pinned: boolean) => void;
}) {
  return (
    <EntityList<GuardJourneyRow>
      label="Journey catalog"
      items={journeys}
      group={bySurface}
      itemId={(j) => j.id}
      activeId={activeId}
      onOpen={onOpen}
      loading={loading}
      error={error}
      search={{
        placeholder: 'Search journeys…',
        ariaLabel: 'Search journeys',
        match: (j, q) => `${j.id} ${j.title} ${journeyEntryLabel(j.entry)}`.toLowerCase().includes(q),
      }}
      noMatch="No journeys match this search."
      // The MAIN pane carries the single Map CTA — the panel stays quiet.
      emptyText="No journeys mapped yet."
      renderRow={(journey) => (
        <>
          <div className="flex w-full items-center gap-2">
            <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-foreground">{journey.id}</span>
            <HoverPopover portal width="narrow" content={usageHint(journey)}>
              <span
                className={`shrink-0 text-[10px] ${
                  journey.flows.length === 0 ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'
                }`}
              >
                {journey.flows.length} flow{journey.flows.length === 1 ? '' : 's'}
              </span>
            </HoverPopover>
          </div>
          <span className="w-full truncate text-[11px] text-muted-foreground">{journey.title}</span>
        </>
      )}
    />
  );
}
