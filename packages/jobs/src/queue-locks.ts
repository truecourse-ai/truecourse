/**
 * Boot recovery for graphile's OWN locks — the other half of the reap in
 * `createJobs.start()`.
 *
 * A job that names a queue holds that queue for the length of its run: graphile
 * locks the queue row when it claims the job and releases it when the job
 * completes or fails. A process killed mid-run releases neither, and graphile's
 * own sweep only clears locks older than FOUR HOURS — so after a crash the
 * workspace's heavy queue would stay locked, and every heavy job enqueued until
 * then would sit queued behind a run that no longer exists.
 *
 * So the boot that fails the orphaned job rows also frees the locks those dead
 * runs left, on the same assumption `failOrphaned` already makes: the worker is
 * in-process, so a restart abandoned everything that was running. The unlocked
 * jobs themselves stay unrunnable (they are enqueued `maxAttempts: 1`, so a
 * claimed job has already spent its attempt); what comes back is the queue.
 *
 * Best-effort and schema-guarded: before the first `run()` there is no
 * `graphile_worker` schema to read, and a failure here must not stop the worker
 * from starting.
 */

import { sql } from 'drizzle-orm';
import type { Db } from '@truecourse/db';
import { log } from '@truecourse/core/lib/logger';

function rowsOf(result: unknown): Record<string, unknown>[] {
  const rows = (result as { rows?: unknown }).rows;
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
}

/**
 * Release every graphile job/queue lock held by a worker of a previous process.
 * Returns the number of worker ids unlocked (0 when there is nothing to do).
 */
export async function releaseAbandonedQueueLocks(db: Db): Promise<number> {
  try {
    const [installed] = rowsOf(
      await db.execute(sql`select to_regclass('graphile_worker.jobs') is not null as installed`),
    );
    if (!installed?.installed) return 0;
    const workerIds = rowsOf(
      await db.execute(
        sql`select distinct locked_by from graphile_worker.jobs where locked_by is not null`,
      ),
    )
      .map((row) => row.locked_by)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    if (workerIds.length === 0) return 0;
    // `sql.param` so the ids travel as ONE array parameter (a bare array is
    // expanded into a tuple, which is not a text[]).
    await db.execute(
      sql`select graphile_worker.force_unlock_workers(${sql.param(workerIds)}::text[])`,
    );
    log.info(`[jobs] released the queue locks of ${workerIds.length} abandoned worker(s)`);
    return workerIds.length;
  } catch (err) {
    log.warn(`[jobs] could not release abandoned queue locks: ${(err as Error).message}`);
    return 0;
  }
}
