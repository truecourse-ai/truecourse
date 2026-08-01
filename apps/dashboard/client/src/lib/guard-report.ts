/**
 * Client-side shaping of the last-generate report (`guard/result.json`) for the
 * report view. Pure functions that recompute exactly what the CLI summary
 * (`printGuardGenerateSummary`) and `composeGuardStatus` derive, so the dashboard
 * and `truecourse guard status` never tell different stories — the client can't
 * import core, so this mirrors that composition and is unit-tested.
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
  GuardNeedsSetup,
} from '@truecourse/shared';

/** Changed sections split the way the CLI reports them. */
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
 * Settled / unsettled split — identical to `printGuardGenerateSummary`.
 *
 * A COMMITTED failing test settles its section: guard commits every test it
 * authors, so the section has its measurement and the measurement is red — there
 * is nothing to re-attempt. Only work that left NOTHING behind is unsettled: a
 * fidelity rejection (judged an invalid measurement, never committed), an
 * authoring error, and — on reports written before failing tests were committed —
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

/**
 * How many flows the last generate actually WORKED — the total minus the ones it
 * skipped because their inputs hadn't changed. The honest subject of the
 * one-line "last generate" read: the rest of the corpus stood as committed.
 * Null for a report written before flow-keyed generation, which has no such unit.
 */
export function changedFlowCount(report: GuardGenerateReport): number | null {
  return report.flows ? Math.max(0, report.flows.total - report.flows.skipped) : null;
}

/**
 * How much work re-attempts on the next generate — the ONE housekeeping line the
 * overview keeps. Generate works per FLOW, so the flow-keyed count is the honest
 * unit when the report carries one; older reports fall back to the distinct
 * sections their authoring errors deferred.
 */
export function retryPendingCount(report: GuardGenerateReport): number {
  return report.flows ? report.flows.unsettled : deferredSectionCount(report.errors);
}

/** Display order: blocked-on first, then the awaiting drivers (registry-derived),
 *  then the residual kinds (dismissed — a user choice — last). A new driver slots
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
 * Tally capability nouns across many blocked-on sections — one increment per
 * (section, capability) — descending by count then name. The single tally used by
 * both the Coverage totals strip (over the doc's blocked-on sections) and the
 * gaps-based {@link blockedOnTally} (over the generate report), so there is one
 * implementation, not two.
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

/** One providable service and the sections waiting on it (item 65). */
export interface NeedsSetupEntry {
  service: string;
  count: number;
  /** True when the account is ALREADY provided — the gap is stale, re-generate. */
  provided: boolean;
}

/**
 * Tally the SERVICES behind a doc's `needs-setup` sections — one increment per
 * (section, service), still-to-provide first, then descending by count and name.
 * `provided` marks the "setup done" sub-state: nothing to fill in, the flows just
 * need the next `guard generate`. A service that appears in both readings counts
 * as still-to-provide (something is genuinely missing somewhere).
 */
export function tallyNeedsSetup(
  needsSetups: Iterable<GuardNeedsSetup | undefined>,
): NeedsSetupEntry[] {
  const tally = new Map<string, NeedsSetupEntry>();
  const bump = (service: string, provided: boolean): void => {
    const entry = tally.get(service);
    if (!entry) tally.set(service, { service, count: 1, provided });
    else {
      entry.count += 1;
      entry.provided = entry.provided && provided;
    }
  };
  for (const needsSetup of needsSetups) {
    if (!needsSetup) continue;
    for (const service of needsSetup.services) bump(service, false);
    for (const service of needsSetup.provided) bump(service, true);
  }
  return [...tally.values()].sort(
    (a, b) =>
      Number(a.provided) - Number(b.provided) ||
      b.count - a.count ||
      a.service.localeCompare(b.service),
  );
}

/** A section (doc + anchor) whose authoring deferred it to the next generate. */
export interface GuardErrorSectionRef {
  doc: string;
  anchor: string;
}

/**
 * Authoring errors that share a message shape. Unlike findings, these are
 * self-healing — the section stays unsettled and re-attempts next generate — so
 * the group carries a full (untruncated) representative message for diagnosis and
 * the distinct sections it affected, not a raw error count or bare slug list.
 */
export interface GuardErrorGroup {
  /** The normalized message pattern (quoted spans and numbers folded out). */
  pattern: string;
  /** A representative FULL error message for the pattern — shown verbatim, never truncated. */
  message: string;
  /** The distinct sections that hit this pattern. */
  sections: GuardErrorSectionRef[];
}

/** Fold a raw error message to a coarse pattern so near-identical ones group. */
function errorPattern(message: string): string {
  const collapsed = message.replace(/\s+/g, ' ').trim();
  const folded = collapsed.replace(/["'`][^"'`]*["'`]/g, '…').replace(/\b\d+\b/g, 'N');
  return folded.length > 100 ? `${folded.slice(0, 100)}…` : folded;
}

/**
 * The number of DISTINCT sections (doc + anchor) deferred by authoring errors —
 * the honest unit for the "N sections deferred" line (a section that errors under
 * two patterns still counts once).
 */
export function deferredSectionCount(errors: readonly GuardGenerateError[]): number {
  return new Set(errors.map((e) => `${e.doc}\0${e.anchor}`)).size;
}

/**
 * One flow's authoring errors, deduped with an attempt count — the detail read.
 * Authoring re-asks, and a flow authored on two surfaces errors once per surface,
 * so the raw list is N near-identical entries; folding them by message pattern
 * turns that into "what went wrong" plus "how many times it was tried".
 */
export interface GuardAuthoringAttempts {
  /** A representative FULL message for the pattern — verbatim, never truncated. */
  message: string;
  /** How many error entries folded into it. */
  attempts: number;
}

/**
 * A flow's authoring errors for one surface, deduped by message pattern in
 * first-seen order. Run refusals and birth errors are excluded — neither means
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

/** Authoring errors grouped by message pattern, most-affected first. */
export function groupErrorsByPattern(errors: readonly GuardGenerateError[]): GuardErrorGroup[] {
  const groups = new Map<string, { message: string; sections: Map<string, GuardErrorSectionRef> }>();
  for (const e of errors) {
    const key = errorPattern(e.message);
    let g = groups.get(key);
    if (!g) {
      g = { message: e.message, sections: new Map() };
      groups.set(key, g);
    }
    g.sections.set(`${e.doc}\0${e.anchor}`, { doc: e.doc, anchor: e.anchor });
  }
  return [...groups.entries()]
    .map(([pattern, g]) => ({ pattern, message: g.message, sections: [...g.sections.values()] }))
    .sort((a, b) => b.sections.length - a.sections.length || a.pattern.localeCompare(b.pattern));
}
