/**
 * Presentation metadata for a guard section-coverage status — the single source
 * the doc coverage surface, the totals strip, and the section detail all read so
 * a status always renders with the same colour and label.
 *
 * `band` is the left-edge highlight applied over the doc (empty for `unguarded`,
 * which stays unmarked). `dot`/`badge` are the compact swatch + pill variants.
 * All colours are opacity-based so they read in both light and dark themes,
 * matching the Spec conflict-band idiom (`border-<c>-500 bg-<c>-500/10`).
 */

import { awaitingDriverIds, guardDriver } from '@truecourse/shared';
import type { GuardAwaitingDriverId, GuardSectionCoverageStatus } from '@truecourse/shared';

/** Broad grouping used to order the totals strip and legend. */
export type GuardStatusGroup =
  | 'pass'
  | 'fail'
  | 'stale'
  | 'guarded'
  | 'driver'
  | 'gap'
  | 'unguarded';

export interface GuardStatusMeta {
  label: string;
  group: GuardStatusGroup;
  /** Left-edge band classes (appended after `border-l-4`); empty = no band. */
  band: string;
  /** Small swatch colour for the totals strip / legend dot. */
  dot: string;
  /** Pill classes for the status badge. */
  badge: string;
}

const GREY_BAND = 'border-slate-400/60 bg-muted/40';
const DRIVER_BAND = 'border-dashed border-slate-400/50 bg-muted/25';
const GREY_BADGE = 'bg-muted text-muted-foreground';

/**
 * The "awaiting driver" rows (api/web/tui today), one per non-runnable driver in
 * the registry — its `waitingLabel` is the copy. A new driver adds its row by
 * appearing in the registry; nothing here is hand-maintained.
 */
const AWAITING_DRIVER_META = Object.fromEntries(
  awaitingDriverIds.map((id) => [
    id,
    { label: guardDriver(id)?.waitingLabel ?? id, group: 'driver', band: DRIVER_BAND, dot: 'bg-slate-400', badge: GREY_BADGE },
  ]),
) as Record<GuardAwaitingDriverId, GuardStatusMeta>;

export const GUARD_STATUS_META: Record<GuardSectionCoverageStatus, GuardStatusMeta> = {
  pass: {
    label: 'Passing',
    group: 'pass',
    band: 'border-emerald-500 bg-emerald-500/10',
    dot: 'bg-emerald-500',
    badge: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  },
  fail: {
    label: 'Failing',
    group: 'fail',
    band: 'border-red-500 bg-red-500/10',
    dot: 'bg-red-500',
    badge: 'bg-red-500/15 text-red-600 dark:text-red-400',
  },
  error: {
    label: 'Error',
    group: 'fail',
    band: 'border-red-500 bg-red-500/10',
    dot: 'bg-red-500',
    badge: 'bg-red-500/15 text-red-600 dark:text-red-400',
  },
  stale: {
    label: 'Stale',
    group: 'stale',
    band: 'border-amber-500 bg-amber-500/10',
    dot: 'bg-amber-500',
    badge: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  },
  orphaned: {
    label: 'Orphaned',
    group: 'stale',
    band: 'border-amber-500 bg-amber-500/10',
    dot: 'bg-amber-500',
    badge: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  },
  guarded: {
    label: 'Guarded (no run)',
    group: 'guarded',
    band: 'border-sky-500/50 bg-sky-500/[0.07]',
    dot: 'bg-sky-500',
    badge: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
  },
  ...AWAITING_DRIVER_META,
  'blocked-on': { label: 'Blocked on', group: 'gap', band: GREY_BAND, dot: 'bg-slate-400', badge: GREY_BADGE },
  untestable: { label: 'Untestable', group: 'gap', band: GREY_BAND, dot: 'bg-slate-400', badge: GREY_BADGE },
  'no-claim': { label: 'No claim', group: 'gap', band: GREY_BAND, dot: 'bg-slate-400', badge: GREY_BADGE },
  unguarded: {
    label: 'Unguarded',
    group: 'unguarded',
    band: '',
    dot: 'bg-muted-foreground/40',
    badge: 'bg-muted text-muted-foreground',
  },
};

/** Every status in display order — run outcomes, guarded, awaiting drivers
 *  (registry-derived), gaps, then unguarded. */
export const GUARD_STATUS_ORDER: GuardSectionCoverageStatus[] = [
  'fail',
  'error',
  'stale',
  'orphaned',
  'pass',
  'guarded',
  ...awaitingDriverIds,
  'blocked-on',
  'untestable',
  'no-claim',
  'unguarded',
];

export function guardStatusMeta(status: GuardSectionCoverageStatus): GuardStatusMeta {
  return GUARD_STATUS_META[status];
}

/** The `border-l-4 …` wrapper classes for a banded section, or '' when unmarked. */
export function guardBandClasses(status: GuardSectionCoverageStatus): string {
  const band = GUARD_STATUS_META[status].band;
  return band ? `border-l-4 ${band}` : '';
}
