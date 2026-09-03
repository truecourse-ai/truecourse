/**
 * The EE half of the PR run timeline: answer core's `GuardGateHeadsLookup` seam
 * (see `@truecourse/core/lib/guard-gate-pending`) from the gate-run records —
 * the PR's distinct head SHAs, newest-first. `readGuardHistoryForPr` joins each
 * head to its stored guard run, so the dashboard's PR Runs picker lists one run
 * per pushed head, never the repo baseline history.
 *
 * Best-effort: a store failure resolves to no heads (the picker shows its empty
 * line) — a read surface must never fail the view. The record scan is bounded
 * (records are repo-wide, newest-first); a PR whose pushes fell off the window
 * loses only its oldest timeline entries, never the current head.
 */

import { log } from '@truecourse/core/lib/logger';
import type { GuardGateHeadsLookup } from '@truecourse/core/lib/guard-gate-pending';
import type { GateStore } from '@truecourse/github-app';

/** Repo-wide record window scanned per lookup (newest-first). */
const RUN_RECORD_WINDOW = 200;

export function createGuardGateHeadsLookup(store: GateStore): GuardGateHeadsLookup {
  return async (repoKey, prNumber) => {
    try {
      const runs = await store.listRuns(repoKey, RUN_RECORD_WINDOW);
      const heads: string[] = [];
      for (const r of runs) {
        if (r.prNumber !== prNumber) continue;
        if (!heads.includes(r.headSha)) heads.push(r.headSha);
      }
      return heads;
    } catch (err) {
      log.warn(
        `[github-app] guard gate heads lookup failed for ${repoKey}#${prNumber}: ${(err as Error).message}`,
      );
      return [];
    }
  };
}
