/**
 * The daily refresh of documentation SITES.
 *
 * A repository source is synced by the event that changes it (a push to its
 * default branch); a site has no such event, so it is swept on a clock: every
 * site whose last sync is older than a day — and that the user has not paused —
 * gets a `context.sync` enqueued.
 *
 * `@truecourse/jobs` has no scheduler of its own (graphile-worker's cron can
 * only insert graphile jobs, which would bypass the tracked row every job here
 * settles), so this is the smallest honest mechanism: an interval on the
 * process, sweeping once an hour and enqueueing what is due. The queue's
 * single-flight key is what makes that safe with several replicas and across
 * restarts — a second enqueue for a source already working is simply lost.
 */

import { log } from '@truecourse/core/lib/logger';
import { listDueContextSites, type DueContextSite } from '@truecourse/data-store';
import type { Db } from '@truecourse/db';
import type { EnqueueResult } from '../jobs/index.js';

/** How stale a site may get before the sweep refreshes it. */
export const CONTEXT_SITE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** How often the sweep looks. Finer than the age, so a site is never a day late. */
export const CONTEXT_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

export interface ContextScheduleDeps {
  /** The sites that are due, oldest first. Production reads Postgres. */
  due?: (before: string) => Promise<DueContextSite[]>;
  /** How a due site is queued. */
  enqueue: (request: {
    workspaceOrgId: string;
    sourceId: string;
    source: 'schedule';
  }) => Promise<EnqueueResult>;
  /** How stale a site may get. Default: a day. */
  maxAgeMs?: number;
  /** How often to look. Default: an hour. */
  intervalMs?: number;
  now?: () => Date;
}

export interface ContextSchedule {
  /** Run one sweep now; returns how many syncs it queued. */
  sweep(): Promise<number>;
  stop(): void;
}

/**
 * Start the sweep. The first pass runs on the next tick, not at boot: a restart
 * loop must not turn into a fetch storm.
 */
export function startContextSyncSchedule(
  db: Db | null,
  deps: ContextScheduleDeps,
): ContextSchedule {
  const due = deps.due ?? ((before: string) => listDueContextSites(db!, before));
  const maxAgeMs = deps.maxAgeMs ?? CONTEXT_SITE_MAX_AGE_MS;
  const intervalMs = deps.intervalMs ?? CONTEXT_SWEEP_INTERVAL_MS;
  const now = deps.now ?? (() => new Date());

  const sweep = async (): Promise<number> => {
    const before = new Date(now().getTime() - maxAgeMs).toISOString();
    const sites = await due(before);
    let queued = 0;
    for (const site of sites) {
      const outcome = await deps.enqueue({
        workspaceOrgId: site.workspaceOrgId,
        sourceId: site.sourceId,
        source: 'schedule',
      });
      if (outcome.status === 'queued') queued += 1;
    }
    if (queued > 0) log.info(`[context] daily sweep queued ${queued} site sync(s)`);
    return queued;
  };

  const timer = setInterval(() => {
    void sweep().catch((err: unknown) => {
      // A sweep that cannot read the database is not fatal: the next tick tries
      // again, and every trigger but this one still works.
      log.warn(`[context] the daily sweep failed: ${(err as Error).message}`);
    });
  }, intervalMs);
  timer.unref?.();

  return { sweep, stop: () => clearInterval(timer) };
}
