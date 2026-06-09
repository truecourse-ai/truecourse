/**
 * Background-job + notification contracts shared by the ee server and client.
 *
 * Long-running work (connector sync today; analyze/verify/gate later) runs in a
 * Postgres-backed queue off the request path. The browser learns about progress
 * and outcomes over a single SSE stream (`/api/ee/events`); these types are the
 * wire shapes for that stream, the jobs API, and the durable notifications feed.
 *
 * Lives in @truecourse/shared so both sides agree without OSS importing `ee/`.
 */

// --- Jobs -----------------------------------------------------------

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

/** Open job-type vocabulary — `knowledge.sync` first; analyze/verify/gate later. */
export type JobType = string;

/** A single phase in a job's stepped checklist (mirrors the OSS analyze popup). */
export type JobStepStatus = 'pending' | 'active' | 'done' | 'error';
export interface JobStep {
  key: string;
  label: string;
  status: JobStepStatus;
  /** Inline note for the active/done step, e.g. a `3/12` counter. */
  detail?: string;
}

export interface JobProgress {
  current: number;
  total: number;
  message: string | null;
  /**
   * Stepped checklist for the live progress popup. EPHEMERAL — carried on the
   * live SSE `job.progress` event only (the worker attaches it at publish time),
   * never persisted on the `jobs` row. A reconnecting client falls back to
   * `message`/`current`/`total` until the next live emit repopulates the steps.
   */
  steps?: JobStep[];
}

/** A job as the UI sees it (the `jobs` row, minus internals). */
export interface JobView {
  id: string;
  /** Owning workspace (WorkOS org). Surfaced for the cross-org Admin jobs view. */
  workspaceOrgId: string;
  type: JobType;
  /** Single-flight / UI-mapping key, e.g. `knowledge.sync:confluence`. */
  key: string | null;
  status: JobStatus;
  progress: JobProgress;
  /** Type-specific result payload on success (e.g. `{ synced: 4 }`). */
  result: unknown | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

/** `queued` and `running` are the two states a job is "active" in. */
export const ACTIVE_JOB_STATUSES: readonly JobStatus[] = ['queued', 'running'];

export function isActiveJob(status: JobStatus): boolean {
  return status === 'queued' || status === 'running';
}

// --- Notifications --------------------------------------------------

export type NotificationLevel = 'info' | 'success' | 'warning' | 'error';

/** A durable feed entry (the `notifications` row). Source of truth for history. */
export interface NotificationView {
  id: string;
  kind: string;
  level: NotificationLevel;
  title: string;
  body: string | null;
  /** Small structured payload, e.g. `{ jobId, synced }`. */
  data: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}

// --- SSE event stream (`GET /api/ee/events`) ------------------------

/** Live progress for an in-flight job — ephemeral, drives a live toast. */
export interface JobProgressEvent {
  type: 'job.progress';
  job: JobView;
}

/** A durable notification just landed — toast + prepend to the feed. */
export interface NotificationEvent {
  type: 'notification';
  notification: NotificationView;
  /** The job this notification concluded (so the client can clear it from activeJobs). */
  jobId: string | null;
}

export type ServerEvent = JobProgressEvent | NotificationEvent;

// --- API response shapes --------------------------------------------

export interface JobsResponse {
  jobs: JobView[];
}

export interface NotificationsResponse {
  notifications: NotificationView[];
  unreadCount: number;
}
