/**
 * Client-side shaping of the last-generate report (`guard/result.json`) for the
 * report view. Pure functions that recompute exactly what `composeGuardStatus`
 * derives, so the report view and the status summary never tell different
 * stories, the client can't import core, so this mirrors that composition and
 * is unit-tested.
 */

import {
  awaitingDriverIds,
  emptyGapDisplayTotals,
  gapDisplayKind,
  parseBlockedOnCapabilities,
} from '@truecourse/shared';
import type {
  GuardCoverageGap,
  GuardGapDisplayKind,
  GuardGenerateError,
  GuardGenerateReport,
} from '@truecourse/shared';

/** Changed sections split the way the generate report counts them. */
export interface GuardSettledCounts {
  /** Sections whose spec content changed since the last generate. */
  changed: number;
  /** Changed sections that recorded a scenario or gap (accounted for). */
  settled: number;
  /** Changed sections that re-attempt next run (a birth finding or authoring error). */
  unsettled: number;
  /** Sections skipped because their spec content was unchanged. */
  unchanged: number;
}

/**
 * Settled / unsettled split, identical to `composeGuardStatus`.
 *
 * A COMMITTED failing test settles its section: guard commits every test it
 * authors, so the section has its measurement and the measurement is red, there
 * is nothing to re-attempt. Only work that left NOTHING behind is unsettled: a
 * fidelity rejection (judged an invalid measurement, never committed), an
 * authoring error, and, on reports written before failing tests were committed -
 * a birth failure that withheld its scenario (no `committed` flag).
 */
export function settledCounts(report: GuardGenerateReport): GuardSettledCounts {
  const unsettled = new Set<string>();
  for (const f of report.birthFindings) {
    if (f.committed) continue;
    unsettled.add(`${f.doc}\0${f.anchor}`);
  }
  for (const e of report.errors) unsettled.add(`${e.doc}\0${e.anchor}`);
  return {
    changed: report.sectionsChanged,
    settled: Math.max(0, report.sectionsChanged - unsettled.size),
    unsettled: unsettled.size,
    unchanged: report.skippedUnchanged,
  };
}

/** Display order: blocked-on first, then the awaiting drivers (registry-derived),
 *  then the residual kinds (dismissed, a user choice, last). A new driver slots
 *  in without touching this list. */
const GAP_KINDS: readonly GuardGapDisplayKind[] = ['blocked-on', ...awaitingDriverIds, 'untestable', 'no-claim', 'dismissed'];

/** Coverage gaps grouped by display kind (every kind present, zero when none). An
 *  awaiting-driver gap counts under its driver id so the drivers stay separate. */
export function gapsByKind(gaps: readonly GuardCoverageGap[]): Record<GuardGapDisplayKind, number> {
  const out = emptyGapDisplayTotals();
  for (const g of gaps) {
    const kind = gapDisplayKind(g);
    if (kind) out[kind]++;
  }
  return out;
}

/** Gap kinds with a non-zero count, in severity-ish display order. */
export function nonZeroGapKinds(byKind: Record<GuardGapDisplayKind, number>): { kind: GuardGapDisplayKind; count: number }[] {
  return GAP_KINDS.filter((k) => byKind[k] > 0).map((kind) => ({ kind, count: byKind[kind] }));
}

/** One capability's `blocked-on` gap count. */
export interface BlockedOnEntry {
  capability: string;
  count: number;
}

/**
 * Tally capability nouns across many blocked-on gaps, one increment per
 * (gap, capability), descending by count then name.
 */
export function tallyCapabilities(capabilityLists: Iterable<readonly string[]>): BlockedOnEntry[] {
  const tally: Record<string, number> = {};
  for (const caps of capabilityLists) {
    for (const cap of caps) tally[cap] = (tally[cap] ?? 0) + 1;
  }
  return Object.entries(tally)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([capability, count]) => ({ capability, count }));
}

/**
 * The FULL per-capability `blocked-on` tally over a generate report's coverage
 * gaps, descending by count then name.
 */
export function blockedOnTally(gaps: readonly GuardCoverageGap[]): BlockedOnEntry[] {
  return tallyCapabilities(
    gaps.filter((g) => g.kind === 'blocked-on').map((g) => parseBlockedOnCapabilities(g.reason)),
  );
}

/** Fold a raw error message to a coarse pattern so near-identical ones group. */
function errorPattern(message: string): string {
  const collapsed = message.replace(/\s+/g, ' ').trim();
  const folded = collapsed.replace(/["'`][^"'`]*["'`]/g, '…').replace(/\b\d+\b/g, 'N');
  return folded.length > 100 ? `${folded.slice(0, 100)}…` : folded;
}

/**
 * One flow's authoring errors, deduped with an attempt count, the detail read.
 * Authoring re-asks, and a flow authored on two surfaces errors once per surface,
 * so the raw list is N near-identical entries; folding them by message pattern
 * turns that into "what went wrong" plus "how many times it was tried".
 */
export interface GuardAuthoringAttempts {
  /** A representative FULL message for the pattern, verbatim, never truncated. */
  message: string;
  /** How many error entries folded into it. */
  attempts: number;
}

/**
 * A flow's authoring errors for one surface, deduped by message pattern in
 * first-seen order. Run refusals and birth errors are excluded, neither means
 * "no test could be written". `surface` narrows to the errors recorded for it,
 * keeping the un-surfaced ones (older reports recorded none) so nothing is lost.
 */
export function collapseAuthoringAttempts(
  errors: readonly GuardGenerateError[],
  surface?: string,
): GuardAuthoringAttempts[] {
  const groups = new Map<string, GuardAuthoringAttempts>();
  for (const e of errors) {
    if (e.kind !== undefined && e.kind !== 'authoring') continue;
    if (surface !== undefined && e.surface !== undefined && e.surface !== surface) continue;
    const key = errorPattern(e.message);
    const g = groups.get(key);
    if (g) g.attempts++;
    else groups.set(key, { message: e.message, attempts: 1 });
  }
  return [...groups.values()];
}
