// PREVIEW (UI mock, fake data): delete when the one-product dashboard lands. See docs/ONE_PRODUCT_PLAN.md §3.5.
// Copied from the agentic branch's apps/dashboard/client/src/lib/guard-status.ts; delete with the preview.
/**
 * COLOUR for a guard section-coverage status, the single source the doc coverage
 * surface, the totals strip, and the section detail all read so a status always
 * renders with the same paint.
 *
 * WORDS are not here: `label` and `hint` are derived from the one status
 * vocabulary (`guard-flow-status.ts`), so a state can never wear two names, the
 * coverage legend and a flow chip say the same thing about `blocked-on`
 * ("Blocked"), and a test locks the two modules together over every status. There
 * is likewise no ordering here: the ONE worst-first order is
 * `GUARD_COVERAGE_STATUS_PRECEDENCE`, and the five-word chips read
 * `GUARD_COVERAGE_PLAIN_ORDER`.
 *
 * `band` is the left-edge highlight applied over the doc, every status has one,
 * because every section now carries a status. `dot`/`badge` are the compact swatch
 * + pill variants. All colours are opacity-based so they read in both light and
 * dark themes, matching the Spec conflict-band idiom (`border-<c>-500 bg-<c>-500/10`).
 *
 * FOUR COLOURS, and only these four. Amber and orange are BANNED across every
 * guard surface (a style sweep fails the build if one returns), they read as a
 * third severity between red and green, and guard has no such thing:
 *
 *   RED    something is wrong and someone must fix it, `fail`, `error`, and
 *          `authoring-error` (our engine failing to do its job);
 *   GREEN  proven, `pass`, and `guarded` (proven by an earlier execution);
 *   BLUE   NOT YET, and someone can move it, the Blocked tier a user can clear
 *          (`blocked`, `needs-setup`, `blocked-on`, `no-interface`, `unguarded`) plus
 *          `never-run`, which is the same shape of fact;
 *   GREY   nothing to act on, the settled non-testables (`unrealizable`,
 *          `untestable`, `no-claim`, `dismissed`), the drivers we haven't built
 *          yet, and the two UNKNOWNS (`stale`, `orphaned`): a bind that no longer
 *          holds was never executed, so it is not a verdict of any colour.
 */

import { awaitingDriverIds } from '@/preview/vendor/shared';
import type { GuardAwaitingDriverId, GuardSectionCoverageStatus } from '@/preview/vendor/shared';
import {
  guardStatusHint,
  guardStatusLabel,
  type GuardFlowPlainStatus,
} from '@/preview/vendor/lib/guard-flow-status';

/** The paint half of a status, the words arrive from the vocabulary module. */
interface GuardStatusColour {
  /** Left-edge band classes (appended after `border-l-4`). */
  band: string;
  /** Small swatch colour for the totals strip / legend dot. */
  dot: string;
  /** Pill classes for the status badge. */
  badge: string;
}

export interface GuardStatusMeta extends GuardStatusColour {
  /** The legend/chip label, {@link guardStatusLabel}, never re-worded here. */
  label: string;
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
const GAP_COLOUR: GuardStatusColour = {
  band: GREY_BAND,
  dot: 'bg-slate-400',
  badge: GREY_BADGE,
};

/**
 * BLOCKED, the one blue. A state nothing has ruled on yet AND someone can move:
 * register the dependency, provide the account, map the interface, run the tests.
 * It is deliberately the same blue as `never-run` and `guarded`: all of them are
 * "no verdict here yet", and a reader scanning for colour must not read one of
 * them as a result. The WORD tells them apart.
 */
const BLOCKED_COLOUR: GuardStatusColour = {
  band: 'border-sky-500 bg-sky-500/10',
  dot: 'bg-sky-500',
  badge: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
};

/**
 * The "awaiting driver" rows (api/web/tui/library today), one per non-runnable
 * driver in the registry. A new driver adds its row by appearing in the registry;
 * nothing here is hand-maintained.
 */
const AWAITING_DRIVER_COLOUR = Object.fromEntries(
  awaitingDriverIds.map((id) => [
    id,
    { band: DRIVER_BAND, dot: 'bg-slate-400', badge: GREY_BADGE },
  ]),
) as Record<GuardAwaitingDriverId, GuardStatusColour>;

const GUARD_STATUS_COLOUR: Record<GuardSectionCoverageStatus, GuardStatusColour> = {
  pass: {
    band: 'border-emerald-500 bg-emerald-500/10',
    dot: 'bg-emerald-500',
    badge: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  },
  fail: {
    band: 'border-red-500 bg-red-500/10',
    dot: 'bg-red-500',
    badge: 'bg-red-500/15 text-red-600 dark:text-red-400',
  },
  error: {
    band: 'border-red-500 bg-red-500/10',
    dot: 'bg-red-500',
    badge: 'bg-red-500/15 text-red-600 dark:text-red-400',
  },
  // The two UNKNOWNS: the bind no longer holds, so the test was NOT executed and
  // nothing about it was established. Grey, like every other state nothing has
  // ruled on, never a colour that suggests a verdict was reached here.
  stale: GAP_COLOUR,
  orphaned: GAP_COLOUR,
  guarded: {
    band: 'border-sky-500/50 bg-sky-500/[0.07]',
    dot: 'bg-sky-500',
    badge: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
  },
  // Same blue as `guarded`, both are "no verdict yet", and a reader scanning for
  // colour must not read one of them as a result. The label tells them apart.
  'never-run': {
    band: 'border-sky-500/50 bg-sky-500/[0.07]',
    dot: 'bg-sky-500',
    badge: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
  },
  ...AWAITING_DRIVER_COLOUR,
  // Held back on an unregistered supplied dependency, one registration away from
  // a verdict. Blue: a to-do, not a failure and not a mute gap.
  blocked: BLOCKED_COLOUR,
  // The ATTENTION gap: a third party the user can provide today. Blue, not the
  // gaps' grey (it is actionable) and not fail's red (nothing failed).
  'needs-setup': BLOCKED_COLOUR,
  // Generate tried to author a test here and failed. Red like a problem, the
  // engine did not do its job, but its own LABEL, distinct from the run outcome
  // `Error`: nothing ran here, so the two must never read as the same thing.
  'authoring-error': {
    band: 'border-red-500/50 bg-red-500/[0.07]',
    dot: 'bg-red-500',
    badge: 'bg-red-500/15 text-red-600 dark:text-red-400',
  },
  // Named blockers a user can clear, the credentials the recipe wants, the code
  // path nothing maps yet. Blue, and `blocked-on` is what the five-word "Blocked"
  // chip borrows its paint from (see BADGE_SOURCE), so BLOCKED IS BLUE everywhere.
  'blocked-on': BLOCKED_COLOUR,
  'no-interface': BLOCKED_COLOUR,
  // Settled answers: nothing here can be proven, by anybody. Grey, nobody's to-do.
  untestable: GAP_COLOUR,
  'no-claim': GAP_COLOUR,
  unrealizable: GAP_COLOUR,
  // The user dismissed this claim's finding (won't-fix / noise), its own zinc
  // tint separates it from the "can't test" gaps.
  dismissed: {
    band: 'border-zinc-400/50 bg-zinc-400/[0.07]',
    dot: 'bg-zinc-400',
    badge: 'bg-zinc-400/15 text-zinc-600 dark:text-zinc-400',
  },
  // Nothing accounts for this section, a HOLE in the coverage record, which reads
  // "Blocked" like every other unproven state, and paints like one. It is banded
  // rather than left unmarked: an unpainted section is exactly the mute bucket the
  // five-word vocabulary exists to remove.
  unguarded: BLOCKED_COLOUR,
};

/** Paint + the vocabulary's words, per status. */
export const GUARD_STATUS_META = Object.fromEntries(
  (Object.keys(GUARD_STATUS_COLOUR) as GuardSectionCoverageStatus[]).map((status) => {
    const hint = guardStatusHint(status);
    return [
      status,
      { ...GUARD_STATUS_COLOUR[status], label: guardStatusLabel(status), ...(hint ? { hint } : {}) },
    ];
  }),
) as Record<GuardSectionCoverageStatus, GuardStatusMeta>;

export function guardStatusMeta(status: GuardSectionCoverageStatus): GuardStatusMeta {
  return GUARD_STATUS_META[status];
}

/** The coverage status each plain status borrows its colour from. */
const BADGE_SOURCE: Record<GuardFlowPlainStatus, GuardSectionCoverageStatus> = {
  failed: 'fail',
  blocked: 'blocked-on',
  'not-testable': 'untestable',
  'never-run': 'never-run',
  succeeded: 'pass',
};

/** Pill classes for a plain status, the shared status colours, never a new set. */
export function guardFlowStatusBadge(status: GuardFlowPlainStatus): string {
  return GUARD_STATUS_META[BADGE_SOURCE[status]].badge;
}

/** Dot colour for a plain status, the status idiom's carrier (dot + plain word). */
export function guardFlowStatusDot(status: GuardFlowPlainStatus): string {
  return GUARD_STATUS_META[BADGE_SOURCE[status]].dot;
}

/** The `border-l-4 …` wrapper classes for a section's band. */
export function guardBandClasses(status: GuardSectionCoverageStatus): string {
  return `border-l-4 ${GUARD_STATUS_META[status].band}`;
}
