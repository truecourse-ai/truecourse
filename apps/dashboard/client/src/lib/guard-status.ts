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
  /**
   * One-line explainer for a status whose NAME alone doesn't say what happened
   * (stale/orphaned: the scenario never executed). Rendered inline under the
   * Runs-list group header and as the badge tooltip; absent for self-evident
   * statuses (pass/fail/…).
   */
  hint?: string;
}

const GREY_BAND = 'border-slate-400/60 bg-muted/40';
const DRIVER_BAND = 'border-dashed border-slate-400/50 bg-muted/25';
const GREY_BADGE = 'bg-muted text-muted-foreground';

/**
 * The "awaiting driver" rows (api/web/tui/library today), one per non-runnable driver in
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
    hint: 'The bound spec text changed since generation — not run. Regenerate to re-anchor.',
  },
  orphaned: {
    label: 'Orphaned',
    group: 'stale',
    band: 'border-amber-500 bg-amber-500/10',
    dot: 'bg-amber-500',
    badge: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
    hint: 'The bound spec section no longer exists — not run. Regenerate to re-anchor.',
  },
  guarded: {
    label: 'Guarded (no run)',
    group: 'guarded',
    band: 'border-sky-500/50 bg-sky-500/[0.07]',
    dot: 'bg-sky-500',
    badge: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
  },
  ...AWAITING_DRIVER_META,
  // A birth finding on a section that committed NOTHING — a pending human decision,
  // tinted like a problem (red) but distinct from a run `fail` (nothing committed
  // ran). A section that committed scenarios AND has a finding paints by its outcome.
  finding: {
    label: 'Finding',
    group: 'gap',
    band: 'border-red-500/50 bg-red-500/[0.07]',
    dot: 'bg-red-500',
    badge: 'bg-red-500/15 text-red-600 dark:text-red-400',
  },
  // Generate tried to author a scenario here and failed (its only record is
  // authoring errors). Red like a problem, but a DISTINCT label from the run
  // `Error` badge — nothing ran, generate crashed while authoring.
  'authoring-error': {
    label: 'Authoring error',
    group: 'gap',
    band: 'border-red-500/50 bg-red-500/[0.07]',
    dot: 'bg-red-500',
    badge: 'bg-red-500/15 text-red-600 dark:text-red-400',
    hint: 'Generate tried to author a scenario here and failed — re-run generate to retry.',
  },
  'blocked-on': { label: 'Blocked on', group: 'gap', band: GREY_BAND, dot: 'bg-slate-400', badge: GREY_BADGE },
  untestable: { label: 'Untestable', group: 'gap', band: GREY_BAND, dot: 'bg-slate-400', badge: GREY_BADGE },
  'no-claim': { label: 'No claim', group: 'gap', band: GREY_BAND, dot: 'bg-slate-400', badge: GREY_BADGE },
  // The user dismissed this claim's finding (won't-fix / noise) — an honest,
  // muted status, never a fail. Its own zinc tint separates it from the "can't
  // test" gaps (untestable / no-claim / blocked-on).
  dismissed: {
    label: 'Dismissed',
    group: 'gap',
    band: 'border-zinc-400/50 bg-zinc-400/[0.07]',
    dot: 'bg-zinc-400',
    badge: 'bg-zinc-400/15 text-zinc-600 dark:text-zinc-400',
  },
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
  'finding',
  'authoring-error',
  ...awaitingDriverIds,
  'blocked-on',
  'untestable',
  'no-claim',
  'dismissed',
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
