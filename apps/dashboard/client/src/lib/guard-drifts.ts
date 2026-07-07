/**
 * Client-side guard drift shaping — the read-only labels/formatters the drifts
 * view uses. The ordering composition itself (`orderGuardDrifts`, `GUARD_DRIFT_ORDER`)
 * lives ONCE in `@truecourse/shared` and is re-exported here so the dashboard and
 * `truecourse guard drifts` can never diverge — no mirrored copy.
 */

import type { GuardOutcome, GuardRunEnvelope } from '@truecourse/shared';

export { GUARD_DRIFT_ORDER, orderGuardDrifts } from '@truecourse/shared';

/**
 * Every run outcome in tally display order (pass first, then the drift tiers) —
 * the single ordering the left run-summary aside and the main-pane run overview
 * both read, so their tallies never diverge.
 */
export const GUARD_OUTCOMES: readonly GuardOutcome[] = ['pass', 'fail', 'error', 'stale', 'orphaned'];

/** A run envelope's `branch @ commit8` reference line, empty when neither is set. */
export function guardRunRef(env: GuardRunEnvelope): string {
  return [env.branch, env.commit ? env.commit.slice(0, 8) : null].filter(Boolean).join(' @ ');
}

/** The trailing heading of a section anchor (`cli/version` → `version`). */
export function sectionLeaf(anchor: string): string {
  return anchor.split('/').pop() || anchor;
}

/** File name of a repo-relative doc path (`docs/spec.md` → `spec.md`). */
export function docBasename(ref: string): string {
  return ref.split('/').pop() || ref;
}

/** A compact fingerprint for display (`sha256:9f2c…` → `9f2c…`, first 12 chars). */
export function shortFingerprint(fp: string): string {
  return fp.replace(/^sha256:/, '').slice(0, 12);
}

/** A short run id for the history rows (the store id is already short-uuid'd). */
export function shortRunId(runId: string): string {
  return runId.length > 20 ? `${runId.slice(0, 20)}…` : runId;
}

/**
 * A millisecond duration, human-readable: sub-second stays exact ms ("873ms"),
 * under a minute reads as one-decimal seconds ("15.6s"), and a minute or more
 * reads minutes + zero-padded seconds ("2m 05s"). Rounding total seconds before
 * the split avoids a "1m 60s" carry. Exact ms belongs in a tooltip where the
 * precision still matters.
 */
export function formatGuardDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

/** Locale short date+time for a run/generate timestamp. */
export function formatGuardTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} ${d.toLocaleTimeString(
    undefined,
    { hour: '2-digit', minute: '2-digit' },
  )}`;
}
