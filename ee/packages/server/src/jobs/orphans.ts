/**
 * Boot-recovery settlement for reaped `guard.gate` jobs. A mid-run process
 * crash kills the job body before its catch can complete the PR's in-progress
 * Check (jobs run maxAttempts:1, so graphile never re-runs it either) — without
 * this, that Check would spin forever. `registerJobs` calls this right after
 * `jobStore.failOrphaned()`, reading each orphan's persisted enqueue payload
 * and completing its Check as the same error-styled failure the crash path
 * posts (a broken gate blocks, never passes silently).
 */

import { postGuardGateErrorCheck, type OctokitClient } from '@truecourse/ee-github-app';
import type { OrphanedJob } from '@truecourse/ee-data-store';
import { log } from '@truecourse/core/lib/logger';
import { GUARD_GATE_TASK } from './constants.js';

export interface SettleOrphanedGuardGatesDeps {
  octokitFor: (installationId: number) => OctokitClient;
}

/** The payload fields the settle needs, if the stored payload carries them. */
function gateTarget(
  payload: Record<string, unknown> | null,
): { repoFullName: string; headSha: string; installationId: number; checkRunId: number | null } | null {
  if (!payload) return null;
  const { repoFullName, headSha, installationId, checkRunId } = payload;
  if (typeof repoFullName !== 'string' || typeof headSha !== 'string' || typeof installationId !== 'number') {
    return null;
  }
  return {
    repoFullName,
    headSha,
    installationId,
    checkRunId: typeof checkRunId === 'number' ? checkRunId : null,
  };
}

/**
 * Complete the stranded PR Check of every reaped `guard.gate` job as the
 * error-styled failure ("no verdict"). Best-effort by design — boot must never
 * be blocked on GitHub: rows without a usable payload are skipped, per-row post
 * failures are logged, and the function never rejects. Returns the count settled.
 */
export async function settleOrphanedGuardGates(
  deps: SettleOrphanedGuardGatesDeps,
  orphans: readonly OrphanedJob[],
): Promise<number> {
  let settled = 0;
  for (const orphan of orphans) {
    if (orphan.type !== GUARD_GATE_TASK) continue;
    const target = gateTarget(orphan.payload);
    if (!target) {
      log.warn(`[ee-jobs] reaped guard.gate ${orphan.id} has no usable payload — its Check cannot be settled`);
      continue;
    }
    try {
      await postGuardGateErrorCheck(deps.octokitFor(target.installationId), target);
      settled++;
    } catch (err) {
      log.warn(
        `[ee-jobs] failed to settle the stranded gate Check for ${target.repoFullName}@${target.headSha}: ${(err as Error).message}`,
      );
    }
  }
  return settled;
}
