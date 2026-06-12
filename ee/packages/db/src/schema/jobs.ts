/**
 * Background jobs + notifications for the hosted edition.
 *
 * Long-running work (connector sync today; analyze/verify/gate later) is enqueued
 * to a Postgres-backed queue (graphile-worker) and tracked here in `jobs` — a
 * UI-facing status row (graphile-worker's own tables aren't meant for app
 * queries). `notifications` is the durable feed shown in the bell/notifications
 * page; it is the source of truth for history (SSE/NOTIFY is only the live push).
 *
 * Both are workspace-scoped by `workspace_org_id` (the WorkOS organization id,
 * the same convention as `gh_repos`/`knowledge_documents`).
 *
 * Single-flight: at most ONE active (`queued`|`running`) job per (org, key) is
 * enforced by a PARTIAL UNIQUE INDEX, so a concurrent sync fails fast instead of
 * queueing a duplicate. The index predicate is added by the migration (drizzle's
 * `.where()` on a unique index emits `WHERE …`).
 */

import { pgTable, text, integer, jsonb, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });

export const jobs = pgTable(
  'jobs',
  {
    id: text('id').primaryKey(),
    workspaceOrgId: text('workspace_org_id').notNull(),
    /** Open vocabulary, e.g. 'knowledge.sync'. */
    type: text('type').notNull(),
    /** Single-flight / UI-mapping key, e.g. 'knowledge.sync:confluence'. Null ⇒ no single-flight. */
    key: text('key'),
    /** 'queued' | 'running' | 'succeeded' | 'failed'. */
    status: text('status').notNull(),
    progressCurrent: integer('progress_current').notNull().default(0),
    progressTotal: integer('progress_total').notNull().default(0),
    progressMessage: text('progress_message'),
    /** Type-specific success payload, e.g. `{ synced: 4 }`. */
    result: jsonb('result').$type<unknown>(),
    error: text('error'),
    createdAt: ts('created_at').notNull(),
    startedAt: ts('started_at'),
    finishedAt: ts('finished_at'),
  },
  (t) => [
    index('jobs_org_idx').on(t.workspaceOrgId),
    // At most one active job per (org, key). The partial predicate means a second
    // /sync while one is queued/running violates this and is rejected (409).
    uniqueIndex('jobs_active_key_uniq')
      .on(t.workspaceOrgId, t.key)
      .where(sql`status in ('queued','running')`),
  ],
);

export const notifications = pgTable(
  'notifications',
  {
    id: text('id').primaryKey(),
    workspaceOrgId: text('workspace_org_id').notNull(),
    /** Free-form category, e.g. 'knowledge.sync'. */
    kind: text('kind').notNull(),
    /** 'info' | 'success' | 'error'. */
    level: text('level').notNull(),
    title: text('title').notNull(),
    body: text('body'),
    /** Small structured payload, e.g. `{ jobId, synced }`. */
    data: jsonb('data').$type<Record<string, unknown>>(),
    readAt: ts('read_at'),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [index('notifications_org_created_idx').on(t.workspaceOrgId, t.createdAt)],
);
