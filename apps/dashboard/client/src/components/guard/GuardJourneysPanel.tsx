/**
 * The Journeys tab's LEFT PANEL — the code-derived catalog, grouped by surface
 * (a driver-registry id) with a sticky header per group. Each row is one journey:
 * its id, its entry descriptor, and how many FLOWS use it (the reverse index —
 * realized or matched-but-blocked; zero means code the spec never mentions, the
 * future infer signal). Rows are
 * previewable: single-click previews the sequence diagram, double-click pins, and
 * a journey opened from somewhere else (a flow's journey chip, a deep link)
 * scrolls its row into view — the cross-navigation rule every panel follows.
 */

import { useMemo, useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import type { GuardJourneyRow } from '@truecourse/shared';
import { guardDriver, journeyEntryLabel } from '@truecourse/shared';
import { HoverPopover } from '@/components/ui/hover-popover';
import { useScrollToSelected } from '@/hooks/useScrollToSelected';

const SELECT =
  'rounded border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary';

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
  if (blocked === n) return `Used by ${n} flow(s) — all blocked before a scenario could be written.`;
  return `Used by ${n} flow(s); ${blocked} blocked before a scenario could be written.`;
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
  const [search, setSearch] = useState('');

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const visible = journeys.filter(
      (j) => !q || `${j.id} ${j.title} ${journeyEntryLabel(j.entry)}`.toLowerCase().includes(q),
    );
    const bySurface = new Map<string, GuardJourneyRow[]>();
    for (const j of visible) {
      const list = bySurface.get(j.type) ?? [];
      list.push(j);
      bySurface.set(j.type, list);
    }
    return [...bySurface.entries()];
  }, [journeys, search]);

  // A journey opened from a flow arrives selected but off-screen — bring the row
  // to the user. Same mechanism in every guard panel.
  const rowRefs = useScrollToSelected<HTMLButtonElement>(activeId, [groups]);

  if (loading && journeys.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (error && journeys.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-sm text-muted-foreground">
        <AlertCircle className="h-5 w-5 text-destructive" />
        <span>{error}</span>
      </div>
    );
  }
  if (journeys.length === 0) {
    // The MAIN pane carries the single Map CTA — the panel stays quiet.
    return (
      <div className="flex h-full items-center justify-center px-4">
        <p className="text-center text-xs text-muted-foreground">No journeys mapped yet.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 border-b border-border p-2">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search journeys…"
          aria-label="Search journeys"
          className={`${SELECT} w-full`}
        />
      </div>

      {/* Down only — every row line truncates, so sideways scroll is never right. */}
      {groups.length === 0 ? (
        <div className="px-3 py-6 text-center text-xs text-muted-foreground">No journeys match this search.</div>
      ) : (
        <div
          className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden"
          role="list"
          aria-label="Journey catalog"
        >
          {groups.map(([surface, rows]) => (
            <div key={surface}>
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <span>
                  {guardDriver(surface)?.label ?? surface}
                  {rows[0]?.source ? ` · ${rows[0].source}` : ''}
                </span>
                <span>{rows.length}</span>
              </div>
              {rows.map((journey) => (
                <button
                  key={journey.id}
                  ref={rowRefs.set(journey.id)}
                  type="button"
                  role="listitem"
                  onClick={() => onOpen(journey.id, false)}
                  onDoubleClick={() => onOpen(journey.id, true)}
                  title={`${journey.title} — click to preview, double-click to pin`}
                  className={`flex w-full flex-col items-start gap-0.5 border-b border-border/60 px-3 py-2 text-left transition-colors ${
                    activeId === journey.id ? 'bg-primary/10' : 'hover:bg-muted/40'
                  }`}
                >
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
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
