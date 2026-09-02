/**
 * One surface of a flow as a chip — the unit the Coverage section detail, the
 * Flows list, and the flow detail all render: the driver's label plus what
 * happened there (a run glyph, or — in plain words — what the surface still needs
 * before it can be tested). Both colour and words come from the shared status
 * vocabulary, so a surface chip and a status badge can never disagree; the glyph
 * carries the state without colour.
 *
 * `compact` is the LIST form: the surface's name and run glyph only, and NO hover
 * at all. A list row states one status word; what a surface needs and the
 * generator's reason for it are detail copy, and a popover chasing the cursor
 * across a dense list is noise — the row opens the detail that says all of it.
 * The full chip keeps its hover (portaled, so a chip inside a scrolling pane can
 * never have its popover clipped).
 */

import type { GuardDriverId, GuardFlowGap, GuardSectionCoverageStatus } from '@truecourse/shared';
import { HoverPopover } from '@/components/ui/hover-popover';
import { guardGapNeed, guardStatusLabel, surfaceLabel } from '@/lib/guard-flow-status';
import { guardStatusMeta } from '@/lib/guard-status';

/** The non-colour signal for a surface's run state; gap statuses carry their label instead. */
const GLYPH: Partial<Record<GuardSectionCoverageStatus, string>> = {
  pass: '✓',
  fail: '✗',
  error: '✗',
  stale: '⟳',
  orphaned: '⟳',
  guarded: '●',
};

export interface GuardSurfaceChipData {
  surface?: GuardDriverId;
  status: GuardSectionCoverageStatus;
  gap?: GuardFlowGap;
  interfaceDrifted?: boolean;
}

export function GuardSurfaceChip({
  data,
  compact = false,
}: {
  data: GuardSurfaceChipData;
  /** List form — the surface's name and glyph only, no need text, no reason. */
  compact?: boolean;
}) {
  const meta = guardStatusMeta(data.status);
  const driverLabel = data.surface ? surfaceLabel(data.surface) : 'Test';
  const glyph = GLYPH[data.status];
  const need = data.gap ? guardGapNeed(data.gap) : guardStatusLabel(data.status);
  const text = glyph ? `${driverLabel} ${glyph}` : compact ? driverLabel : `${driverLabel} · ${need}`;

  const chip = (
    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${meta.badge}`}>
      {text}
      {data.interfaceDrifted && (
        <span aria-label="interface drift" className="h-1.5 w-1.5 rounded-full bg-amber-500" />
      )}
    </span>
  );

  // A list chip is silent — the row it sits in is the click target for everything
  // this popover used to say.
  if (compact) return chip;

  return (
    <HoverPopover width="narrow" portal content={data.gap?.reason ?? meta.hint ?? `${driverLabel} — ${need}`}>
      {chip}
    </HoverPopover>
  );
}
