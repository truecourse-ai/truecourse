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
 * push). Both are constructed directly by the jobs runner.
 */

import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import {
  jobs,
  notifications,
  pendingBaselines,
  pendingGuardBaselines,
  guardBackfillMarkers,
  type Db,
} from '@truecourse/db';
import type { JobView, JobStatus, NotificationLevel, NotificationView } from '@truecourse/shared';

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
 * A reaped in-flight job, as returned by {@link JobStore.failOrphaned}: enough
 * for boot recovery to settle side effects the dead run left dangling (e.g.
 * complete a `guard.gate`'s stranded PR Check from the stored `payload`).
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
    createdAt: r.createdAt,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
  };
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
   * job. Mark every `queued|running` row `failed` so the unique key is freed and
   * a stale "Syncing…" button clears. Returns the reaped jobs (id, type, stored
   * payload) so the caller can settle what the dead runs left dangling.
   */
  async failOrphaned(): Promise<OrphanedJob[]> {
    const now = new Date().toISOString();
    return this.db
      .update(jobs)
      .set({ status: 'failed', error: 'interrupted by server restart', finishedAt: now })
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

/** A deferred baseline enqueue (the full request, minus the added job id). */
export interface PendingBaselineInput {
  repoFullName: string;
  installationId: number;
  defaultBranch: string;
  commitSha: string;
  workspaceOrgId: string;
  force?: boolean;
  quiet?: boolean;
}

/** A stored pending row — the request as recorded, plus when it was last set. */
export interface PendingBaselineView {
  repoFullName: string;
  installationId: number;
  defaultBranch: string;
  commitSha: string;
  workspaceOrgId: string;
  force: boolean;
  quiet: boolean;
  updatedAt: string;
}

type PendingBaselineRow = typeof pendingBaselines.$inferSelect;

function toPendingView(r: PendingBaselineRow): PendingBaselineView {
  return {
    repoFullName: r.repoFullName,
    installationId: r.installationId,
    defaultBranch: r.defaultBranch,
    commitSha: r.commitSha,
    workspaceOrgId: r.workspaceOrgId,
    force: r.force,
    quiet: r.quiet,
    updatedAt: r.updatedAt,
  };
}

/**
 * The coalesce-then-rerun buffer behind `enqueueBaseline`. One row per repo (the
 * PK): when a scan is already in flight, the follow-up push is recorded here and
 * replayed when the running scan settles — so a second quick merge is never lost.
 * `upsert` = latest wins; `take`/`drain` are read-and-delete (replay is one-shot).
 */
export class PendingBaselineStore {
  constructor(private readonly db: Db) {}

  /** Record (or replace) the repo's pending follow-up baseline — latest wins. */
  async upsert(input: PendingBaselineInput): Promise<void> {
    const row = {
      repoFullName: input.repoFullName,
      installationId: input.installationId,
      defaultBranch: input.defaultBranch,
      commitSha: input.commitSha,
      workspaceOrgId: input.workspaceOrgId,
      force: input.force ?? false,
      quiet: input.quiet ?? false,
      updatedAt: new Date().toISOString(),
    };
    await this.db
      .insert(pendingBaselines)
      .values(row)
      .onConflictDoUpdate({
        target: pendingBaselines.repoFullName,
        set: {
          installationId: row.installationId,
          defaultBranch: row.defaultBranch,
          commitSha: row.commitSha,
          workspaceOrgId: row.workspaceOrgId,
          force: row.force,
          quiet: row.quiet,
          updatedAt: row.updatedAt,
        },
      });
  }

  /** Read-and-delete the repo's pending row (atomic), or null if none. */
  async take(repoFullName: string): Promise<PendingBaselineView | null> {
    const [row] = await this.db
      .delete(pendingBaselines)
      .where(eq(pendingBaselines.repoFullName, repoFullName))
      .returning();
    return row ? toPendingView(row) : null;
  }

  /** Read-and-delete every pending row — boot recovery after a crash. */
  async drain(): Promise<PendingBaselineView[]> {
    const rows = await this.db.delete(pendingBaselines).returning();
    return rows.map(toPendingView);
  }
}

/** A deferred guard-baseline enqueue (the full request, minus the added job id). */
export interface PendingGuardBaselineInput {
  repoFullName: string;
  installationId: number;
  defaultBranch: string;
  commitSha: string;
  workspaceOrgId: string;
}

/** A stored pending guard-baseline row — the request plus when it was last set. */
export interface PendingGuardBaselineView extends PendingGuardBaselineInput {
  updatedAt: string;
}

type PendingGuardBaselineRow = typeof pendingGuardBaselines.$inferSelect;

function toPendingGuardView(r: PendingGuardBaselineRow): PendingGuardBaselineView {
  return {
    repoFullName: r.repoFullName,
    installationId: r.installationId,
    defaultBranch: r.defaultBranch,
    commitSha: r.commitSha,
    workspaceOrgId: r.workspaceOrgId,
    updatedAt: r.updatedAt,
  };
}

/**
 * The coalesce-then-rerun buffer behind `enqueueGuardBaseline` — the guard
 * analogue of {@link PendingBaselineStore}. One row per repo (the PK): when a
 * baseline run is already in flight, the follow-up refresh is recorded here and
 * replayed when the running run settles, so a rapid second merge is never lost.
 * `upsert` = latest wins; `take`/`drain` are read-and-delete (replay is one-shot).
 */
export class PendingGuardBaselineStore {
  constructor(private readonly db: Db) {}

  /** Record (or replace) the repo's pending follow-up guard baseline — latest wins. */
  async upsert(input: PendingGuardBaselineInput): Promise<void> {
    const row = {
      repoFullName: input.repoFullName,
      installationId: input.installationId,
      defaultBranch: input.defaultBranch,
      commitSha: input.commitSha,
      workspaceOrgId: input.workspaceOrgId,
      updatedAt: new Date().toISOString(),
    };
    await this.db
      .insert(pendingGuardBaselines)
      .values(row)
      .onConflictDoUpdate({
        target: pendingGuardBaselines.repoFullName,
        set: {
          installationId: row.installationId,
          defaultBranch: row.defaultBranch,
          commitSha: row.commitSha,
          workspaceOrgId: row.workspaceOrgId,
          updatedAt: row.updatedAt,
        },
      });
  }

  /** Read-and-delete the repo's pending row (atomic), or null if none. */
  async take(repoFullName: string): Promise<PendingGuardBaselineView | null> {
    const [row] = await this.db
      .delete(pendingGuardBaselines)
      .where(eq(pendingGuardBaselines.repoFullName, repoFullName))
      .returning();
    return row ? toPendingGuardView(row) : null;
  }

  /** Read-and-delete every pending row — boot recovery after a crash. */
  async drain(): Promise<PendingGuardBaselineView[]> {
    const rows = await this.db.delete(pendingGuardBaselines).returning();
    return rows.map(toPendingGuardView);
  }
}

/**
 * The deploy-time guard-backfill marker store (one row per repo the backfill has
 * processed). `mark` is idempotent (`onConflictDoNothing`); `isMarked` gates the
 * one-time enqueue so a re-deploy skips an already-backfilled repo entirely — the
 * durable analogue of a run-once flag that survives restarts.
 */
export class GuardBackfillMarkerStore {
  constructor(private readonly db: Db) {}

  /** Whether the repo was already processed by a prior backfill. */
  async isMarked(repoFullName: string): Promise<boolean> {
    const [row] = await this.db
      .select({ repoFullName: guardBackfillMarkers.repoFullName })
      .from(guardBackfillMarkers)
      .where(eq(guardBackfillMarkers.repoFullName, repoFullName))
      .limit(1);
    return !!row;
  }

  /** Record the repo as backfilled — idempotent (a re-mark is a no-op). */
  async mark(repoFullName: string): Promise<void> {
    await this.db
      .insert(guardBackfillMarkers)
      .values({ repoFullName, markedAt: new Date().toISOString() })
      .onConflictDoNothing({ target: guardBackfillMarkers.repoFullName });
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
