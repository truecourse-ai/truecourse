/**
 * Background-job + notification stores (Postgres, workspace-scoped).
 *
 * `JobStore` tracks the lifecycle of an enqueued job (the `jobs` row) for the
 * UI — graphile-worker owns execution/retries, this owns the user-facing status
 * + progress. Single-flight is enforced by the partial unique index on
 * `(workspace_org_id, key) WHERE status IN ('queued','running')`: `create()`
 * surfaces that as `ActiveJobExistsError` so the route can 409 a concurrent sync.
 *
 * `NotificationStore` is the durable feed (the `notifications` row) shown in the
 * bell + notifications page — the source of truth for history (SSE is only live
 * push). A job holds ONE row there: the row it posts when it begins is the row
 * `moveStarted` settles. Both are constructed directly by the jobs runner.
 */

import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { jobs, notifications, type Db } from '@truecourse/db';
import type {
  JobView,
  JobPauseReason,
  JobStatus,
  NotificationLevel,
  NotificationView,
} from '@truecourse/shared';

/** Thrown by `JobStore.create` when an active job already holds the (org, key). */
export class ActiveJobExistsError extends Error {
  readonly existing: JobView;
  constructor(existing: JobView) {
    super('an active job already exists for this key');
    this.name = 'ActiveJobExistsError';
    this.existing = existing;
  }
}

type JobRow = typeof jobs.$inferSelect;

/**
 * A reaped in-flight job, as returned by {@link JobStore.interruptOrphaned}: enough
 * for boot recovery to settle what the dead run left dangling (the chain link
 * it was about to enqueue, from the stored `payload`).
 */
export interface OrphanedJob {
  id: string;
  workspaceOrgId: string;
  type: string;
  key: string | null;
  payload: Record<string, unknown> | null;
}

function toJobView(r: JobRow): JobView {
  return {
    id: r.id,
    workspaceOrgId: r.workspaceOrgId,
    type: r.type,
    key: r.key,
    status: r.status as JobStatus,
    progress: { current: r.progressCurrent, total: r.progressTotal, message: r.progressMessage },
    result: r.result ?? null,
    error: r.error,
    pauseReason: (r.pauseReason as JobPauseReason | null) ?? null,
    createdAt: r.createdAt,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
  };
}

/** A paused row nothing has carried on yet — what a grant still has to start. */
const STILL_WAITING = sql`${jobs.result}->>'resumedAs' is null`;

/** A paused job, with everything re-enqueuing it needs. */
export interface PausedJob {
  id: string;
  workspaceOrgId: string;
  type: string;
  key: string | null;
  payload: Record<string, unknown> | null;
  reason: JobPauseReason | null;
  pausedAt: string | null;
}

export class JobStore {
  constructor(private readonly db: Db) {}

  /**
   * Create a `queued` job. Throws `ActiveJobExistsError` (carrying the existing
   * active job) when `key` is already held by a `queued|running` job — the
   * partial unique index is the race-proof single-flight guard. `payload` is the
   * enqueue request (persisted for boot recovery — see {@link OrphanedJob}).
   */
  async create(input: {
    org: string;
    type: string;
    key?: string | null;
    payload?: Record<string, unknown> | null;
  }): Promise<JobView> {
    const now = new Date().toISOString();
    const row = {
      id: randomUUID(),
      workspaceOrgId: input.org,
      type: input.type,
      key: input.key ?? null,
      payload: input.payload ?? null,
      status: 'queued' as const,
      progressCurrent: 0,
      progressTotal: 0,
      progressMessage: null,
      result: null,
      error: null,
      createdAt: now,
      startedAt: null,
      finishedAt: null,
    };
    try {
      const [inserted] = await this.db.insert(jobs).values(row).returning();
      return toJobView(inserted);
    } catch (err) {
      // 23505 = unique_violation on jobs_active_key_uniq → a sync is already
      // active. drizzle may wrap the driver error, so check `.cause` too.
      const code =
        (err as { code?: string }).code ?? (err as { cause?: { code?: string } }).cause?.code;
      if (code === '23505' && input.key) {
        const existing = await this.getActiveByKey(input.org, input.key);
        if (existing) throw new ActiveJobExistsError(existing);
      }
      throw err;
    }
  }

  /**
   * Claim a queued job. Returns null when the row is no longer `queued` — it was
   * cancelled (or already claimed) between the enqueue and the worker picking it
   * up — so the harness can skip the body instead of running work nobody wants.
   */
  async markRunning(id: string): Promise<JobView | null> {
    const [row] = await this.db
      .update(jobs)
      .set({ status: 'running', startedAt: new Date().toISOString() })
      .where(and(eq(jobs.id, id), eq(jobs.status, 'queued')))
      .returning();
    return row ? toJobView(row) : null;
  }

  async setProgress(id: string, p: { current: number; total: number; message?: string | null }): Promise<JobView | null> {
    return this.update(id, {
      progressCurrent: p.current,
      progressTotal: p.total,
      progressMessage: p.message ?? null,
    });
  }

  async markSucceeded(id: string, result: unknown): Promise<JobView | null> {
    return this.update(id, { status: 'succeeded', result, finishedAt: new Date().toISOString() });
  }

  async markFailed(id: string, error: string): Promise<JobView | null> {
    return this.update(id, { status: 'failed', error, finishedAt: new Date().toISOString() });
  }

  /**
   * Stop a job part-way with nothing wrong: it is out of credits, and the work
   * it has not done is still to do. The row settles `paused` — terminal, so the
   * single-flight key frees and the job can be enqueued again — carrying the
   * reason and, merged onto the payload it was created with, whatever pointer
   * the body says a resume must start from. No error is recorded: a pause is
   * not a failure.
   */
  async markPaused(
    id: string,
    input: { reason: JobPauseReason; resume?: Record<string, unknown> },
  ): Promise<JobView | null> {
    const resume = input.resume ?? {};
    const [row] = await this.db
      .update(jobs)
      .set({
        status: 'paused',
        pauseReason: input.reason,
        finishedAt: new Date().toISOString(),
        payload: sql`coalesce(${jobs.payload}, '{}'::jsonb) || ${JSON.stringify(resume)}::jsonb`,
      })
      .where(and(eq(jobs.id, id), inArray(jobs.status, ['queued', 'running'])))
      .returning();
    return row ? toJobView(row) : null;
  }

  /**
   * The workspace's paused jobs, OLDEST FIRST — the order they stopped in is the
   * order a grant carries them on in. A row that already carried on names the
   * job it became in `result`, and is not offered again.
   */
  async listPaused(org: string): Promise<PausedJob[]> {
    const rows = await this.db
      .select()
      .from(jobs)
      .where(and(eq(jobs.workspaceOrgId, org), eq(jobs.status, 'paused'), STILL_WAITING))
      .orderBy(asc(jobs.finishedAt), asc(jobs.createdAt));
    return rows.map((row) => ({
      id: row.id,
      workspaceOrgId: row.workspaceOrgId,
      type: row.type,
      key: row.key,
      payload: row.payload,
      reason: (row.pauseReason as JobPauseReason | null) ?? null,
      pausedAt: row.finishedAt,
    }));
  }

  /** How many paused jobs each of these workspaces is holding. */
  async pausedCounts(orgs: readonly string[]): Promise<Map<string, number>> {
    if (orgs.length === 0) return new Map();
    const rows = await this.db
      .select({ org: jobs.workspaceOrgId, count: sql<number>`count(*)::int` })
      .from(jobs)
      .where(and(inArray(jobs.workspaceOrgId, [...orgs]), eq(jobs.status, 'paused'), STILL_WAITING))
      .groupBy(jobs.workspaceOrgId);
    return new Map(rows.map((row) => [row.org, row.count]));
  }

  /** Name the job a paused row carried on as, so it is never resumed twice. */
  async markResumed(id: string, resumedAs: string): Promise<void> {
    await this.db
      .update(jobs)
      .set({ result: { resumedAs } })
      .where(and(eq(jobs.id, id), eq(jobs.status, 'paused')));
  }

  /**
   * Stop a job deliberately (a disconnect, a superseding request). Only an
   * ACTIVE row moves — a job that already settled keeps its outcome — so the
   * single-flight key frees without rewriting history. Returns null when there
   * was nothing active to cancel.
   */
  async markCancelled(id: string): Promise<JobView | null> {
    const [row] = await this.db
      .update(jobs)
      .set({ status: 'cancelled', finishedAt: new Date().toISOString() })
      .where(and(eq(jobs.id, id), inArray(jobs.status, ['queued', 'running'])))
      .returning();
    return row ? toJobView(row) : null;
  }

  private async update(id: string, set: Partial<JobRow>): Promise<JobView | null> {
    const [row] = await this.db.update(jobs).set(set).where(eq(jobs.id, id)).returning();
    return row ? toJobView(row) : null;
  }

  /** Fetch by id; pass `org` to scope (the route does, so one org can't read another's job). */
  async get(id: string, org?: string): Promise<JobView | null> {
    const where = org ? and(eq(jobs.id, id), eq(jobs.workspaceOrgId, org)) : eq(jobs.id, id);
    const [row] = await this.db.select().from(jobs).where(where).limit(1);
    return row ? toJobView(row) : null;
  }

  /** The active (`queued|running`) job holding (org, key), if any. */
  async getActiveByKey(org: string, key: string): Promise<JobView | null> {
    const [row] = await this.db
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.workspaceOrgId, org),
          eq(jobs.key, key),
          inArray(jobs.status, ['queued', 'running']),
        ),
      )
      .limit(1);
    return row ? toJobView(row) : null;
  }

  /** All active jobs for a workspace (optionally filtered by type) — seeds the UI's "Syncing" state. */
  async listActive(org: string, type?: string): Promise<JobView[]> {
    const where = type
      ? and(eq(jobs.workspaceOrgId, org), eq(jobs.type, type), inArray(jobs.status, ['queued', 'running']))
      : and(eq(jobs.workspaceOrgId, org), inArray(jobs.status, ['queued', 'running']));
    const rows = await this.db.select().from(jobs).where(where).orderBy(desc(jobs.createdAt));
    return rows.map(toJobView);
  }

  async listForOrg(org: string, limit = 50): Promise<JobView[]> {
    const rows = await this.db
      .select()
      .from(jobs)
      .where(eq(jobs.workspaceOrgId, org))
      .orderBy(desc(jobs.createdAt))
      .limit(limit);
    return rows.map(toJobView);
  }

  /**
   * Cross-org job list for the Admin console (operator only). `org` is an
   * OPTIONAL filter — omit for all workspaces, set to scope to one.
   */
  async listAll(
    filters: { org?: string; type?: string; status?: JobStatus; limit?: number } = {},
  ): Promise<JobView[]> {
    const conds: SQL[] = [];
    if (filters.org) conds.push(eq(jobs.workspaceOrgId, filters.org));
    if (filters.type) conds.push(eq(jobs.type, filters.type));
    if (filters.status) conds.push(eq(jobs.status, filters.status));
    const rows = await this.db
      .select()
      .from(jobs)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(jobs.createdAt))
      .limit(filters.limit ?? 100);
    return rows.map(toJobView);
  }

  /**
   * Boot recovery: the in-process worker means a restart abandons any in-flight
   * job. Mark every `queued|running` row `interrupted` — the same word its run
   * record gets — so the unique key is freed and a stale "Syncing…" button
   * clears. Returns the reaped jobs (id, type, stored payload) so the caller can
   * settle what the dead runs left dangling.
   */
  async interruptOrphaned(): Promise<OrphanedJob[]> {
    const now = new Date().toISOString();
    return this.db
      .update(jobs)
      .set({ status: 'interrupted', error: 'interrupted by a server restart', finishedAt: now })
      .where(inArray(jobs.status, ['queued', 'running']))
      .returning({
        id: jobs.id,
        workspaceOrgId: jobs.workspaceOrgId,
        type: jobs.type,
        key: jobs.key,
        payload: jobs.payload,
      });
  }
}

type NotificationRow = typeof notifications.$inferSelect;

function toNotificationView(r: NotificationRow): NotificationView {
  return {
    id: r.id,
    kind: r.kind,
    level: r.level as NotificationLevel,
    title: r.title,
    body: r.body,
    data: r.data ?? null,
    readAt: r.readAt,
    createdAt: r.createdAt,
  };
}

export class NotificationStore {
  constructor(private readonly db: Db) {}

  async add(input: {
    org: string;
    kind: string;
    level: NotificationLevel;
    title: string;
    body?: string | null;
    data?: Record<string, unknown> | null;
  }): Promise<NotificationView> {
    const [row] = await this.db
      .insert(notifications)
      .values({
        id: randomUUID(),
        workspaceOrgId: input.org,
        kind: input.kind,
        level: input.level,
        title: input.title,
        body: input.body ?? null,
        data: input.data ?? null,
        readAt: null,
        createdAt: new Date().toISOString(),
      })
      .returning();
    return toNotificationView(row);
  }

  /**
   * Move the row a job posted when it began onto how it settled — the same row,
   * now carrying the settlement's level, wording, merged payload and time, so
   * the feed shows one entry per job rather than a Started stranded beside a
   * Done. Null when the job posted no started row: the caller inserts instead.
   */
  async moveStarted(input: {
    org: string;
    jobId: string;
    kind: string;
    level: NotificationLevel;
    title: string;
    body?: string | null;
    data?: Record<string, unknown> | null;
  }): Promise<NotificationView | null> {
    const [row] = await this.db
      .update(notifications)
      .set({
        kind: input.kind,
        level: input.level,
        title: input.title,
        body: input.body ?? null,
        data: sql`coalesce(${notifications.data}, '{}'::jsonb) || ${JSON.stringify(input.data ?? {})}::jsonb`,
        // The feed is newest first and the settlement is news: the row is as
        // new, and as unread, as what it now carries.
        createdAt: new Date().toISOString(),
        readAt: null,
      })
      .where(
        and(
          eq(notifications.workspaceOrgId, input.org),
          eq(notifications.level, 'started'),
          sql`${notifications.data}->>'jobId' = ${input.jobId}`,
        ),
      )
      .returning();
    return row ? toNotificationView(row) : null;
  }

  async listForOrg(org: string, opts: { limit?: number } = {}): Promise<NotificationView[]> {
    const rows = await this.db
      .select()
      .from(notifications)
      .where(eq(notifications.workspaceOrgId, org))
      .orderBy(desc(notifications.createdAt))
      .limit(opts.limit ?? 100);
    return rows.map(toNotificationView);
  }

  async unreadCount(org: string): Promise<number> {
    const [row] = await this.db
      .select({ c: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.workspaceOrgId, org), isNull(notifications.readAt)));
    return row?.c ?? 0;
  }

  async markRead(org: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db
      .update(notifications)
      .set({ readAt: new Date().toISOString() })
      .where(and(eq(notifications.workspaceOrgId, org), inArray(notifications.id, ids)));
  }

  async markAllRead(org: string): Promise<void> {
    await this.db
      .update(notifications)
      .set({ readAt: new Date().toISOString() })
      .where(and(eq(notifications.workspaceOrgId, org), isNull(notifications.readAt)));
  }
}
