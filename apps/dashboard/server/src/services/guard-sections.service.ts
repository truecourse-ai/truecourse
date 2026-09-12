/**
 * The section-history backfill, one boot sweep.
 *
 * A stored baseline run carries a SECTION SUMMARY: what every section of the
 * documents its scenario set covered was worth when it ran. Runs persisted
 * before summaries existed carry none, and Home's trend cannot invent one, so
 * the sweep derives each missing summary once, from the run's own stored
 * snapshot against the scenario set and report the store holds at its commit.
 *
 * A run whose summary cannot be derived (the documents it named are no longer
 * readable, the scenario set is gone) is logged and left without one. It stays
 * out of history, which is the honest answer: the sweep runs again on the next
 * boot and will write it if the inputs come back.
 */

import { log } from '@truecourse/core/lib/logger';
import { readRegistry } from '@truecourse/core/config/registry';
import { readGuardHistory, readGuardRun, readGuardRunSections } from '@truecourse/core/lib/guard-store';
import { recordGuardRunSections } from '../jobs/materialize-guard.js';

export interface GuardSectionsBackfill {
  /** Baseline runs found without a summary. */
  missing: number;
  written: number;
  /** Runs whose summary could not be derived; they stay out of history. */
  skipped: number;
}

/** Derive the missing section summaries of every registered repository's baseline runs. */
export async function backfillGuardRunSections(): Promise<GuardSectionsBackfill> {
  const outcome: GuardSectionsBackfill = { missing: 0, written: 0, skipped: 0 };
  let entries;
  try {
    entries = await readRegistry();
  } catch (err) {
    log.warn(`[Guard] the section backfill could not read the registry: ${(err as Error).message}`);
    return outcome;
  }

  for (const entry of entries) {
    try {
      const [history, stored] = await Promise.all([
        readGuardHistory(entry.path),
        readGuardRunSections(entry.path),
      ]);
      const have = new Set(stored.map((run) => run.runId));
      for (const run of history.runs) {
        if (have.has(run.runId)) continue;
        outcome.missing++;
        const latest = await readGuardRun(entry.path, run.runId);
        if (!latest) {
          log.warn(
            `[Guard] ${entry.name} run ${run.runId} has no stored snapshot to derive sections from`,
          );
          outcome.skipped++;
          continue;
        }
        if (await recordGuardRunSections(entry.path, latest)) outcome.written++;
        else outcome.skipped++;
      }
    } catch (err) {
      log.warn(
        `[Guard] the section backfill for ${entry.name} failed: ${(err as Error).message}`,
      );
    }
  }

  if (outcome.missing > 0) {
    log.info(
      `[Guard] section history backfilled: ${outcome.written} written, ${outcome.skipped} without a derivable summary`,
    );
  }
  return outcome;
}
