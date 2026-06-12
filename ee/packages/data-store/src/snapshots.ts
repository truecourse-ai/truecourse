/**
 * Shared read/write for `verify_snapshots` — the single per-(repo, commit) home
 * for verify state. Both the EE spec store (which routes the `verifyState`
 * artifact here, since it's per-commit, not a spec) and the EE verify store (the
 * seam) write through this, so there's exactly one place that shapes the row.
 */

import { and, eq } from 'drizzle-orm';
import { verifySnapshots, type EeDb } from '@truecourse/ee-db';

// Only the fields this module reads are typed; the full runtime object is stored
// as the `snapshot` jsonb regardless (callers pass a VerifyState / run snapshot).
interface SnapshotState {
  drifts?: Array<{ severity: string }>;
  verifiedAt?: string;
}

/** Drift count + per-severity breakdown, denormalized onto the row for the trend. */
function summarize(drifts: Array<{ severity: string }>): {
  total: number;
  bySeverity: Record<string, number>;
} {
  const bySeverity: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const d of drifts) bySeverity[d.severity] = (bySeverity[d.severity] ?? 0) + 1;
  return { total: drifts.length, bySeverity };
}

export async function writeSnapshot(
  db: EeDb,
  repoKey: string,
  commitSha: string,
  state: SnapshotState,
  opts: { branch?: string | null; markBaseline?: boolean } = {},
): Promise<void> {
  const summary = summarize(state.drifts ?? []);
  const now = new Date().toISOString();
  const branch = opts.branch ?? null;
  // A baseline write marks the row; a later per-commit write (the gate's
  // saveSpec) must NOT clear that mark, so `is_baseline` is in the conflict-set
  // ONLY when this call is the baseline write.
  const set: Record<string, unknown> = {
    branch,
    snapshot: state,
    driftCount: summary.total,
    bySeverity: summary.bySeverity,
    verifiedAt: state.verifiedAt ?? now,
  };
  if (opts.markBaseline) set.isBaseline = true;
  await db
    .insert(verifySnapshots)
    .values({
      repoKey,
      commitSha,
      branch,
      snapshot: state,
      driftCount: summary.total,
      bySeverity: summary.bySeverity,
      isBaseline: opts.markBaseline ?? false,
      verifiedAt: state.verifiedAt ?? now,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: [verifySnapshots.repoKey, verifySnapshots.commitSha],
      set,
    });
}

export async function readSnapshot<T = unknown>(
  db: EeDb,
  repoKey: string,
  commitSha: string,
): Promise<T | null> {
  const rows = await db
    .select({ snapshot: verifySnapshots.snapshot })
    .from(verifySnapshots)
    .where(and(eq(verifySnapshots.repoKey, repoKey), eq(verifySnapshots.commitSha, commitSha)))
    .limit(1);
  return rows[0] ? (rows[0].snapshot as T) : null;
}

export async function deleteSnapshot(db: EeDb, repoKey: string, commitSha: string): Promise<void> {
  await db
    .delete(verifySnapshots)
    .where(and(eq(verifySnapshots.repoKey, repoKey), eq(verifySnapshots.commitSha, commitSha)));
}
