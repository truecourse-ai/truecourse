/**
 * Background-job + notification contracts shared by every server and client.
 *
 * Long-running work (spec scan, guard setup, connector sync) runs in a
 * Postgres-backed queue off the request path. The browser learns about progress
 * and outcomes over a single SSE stream (`/api/events`); these types are the
 * wire shapes for that stream, the jobs API, and the durable notifications feed.
 */

// --- Jobs -----------------------------------------------------------

/**
 * `cancelled` is a deliberate stop (a disconnect, a superseding request), not a
 * failure: no error is recorded and no notification is posted. `interrupted` is
 * what a job and its run BOTH become when the process running them died — the
 * boot sweep settles the pair with one word, so a restart never reads as the
 * work having failed.
 */
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';

/** Open job-type vocabulary — `context.sync`, `context.scan`, `repo.guard-*` today. */
export type JobType = string;

/** A single phase in a job's stepped checklist. */
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
  /**
   * Human display title for the progress popup, carried on the live event so the
   * client never hard-codes a type→label map. Optional: DB-fetched rows (initial
   * load / reconnect) omit it, and the client falls back to its own label map.
   */
  title?: string;
  /** Single-flight / UI-mapping key, e.g. `context.sync:<sourceId>`. */
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

/** `started` is the row a run posts the moment it can be watched; the rest are how it settled. */
export type NotificationLevel = 'started' | 'info' | 'success' | 'warning' | 'error';

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

// --- SSE event stream (`GET /api/events`) ------------------------

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

/**
 * The workspace's Context changed — a source was added, synced, paused or
 * removed, or a repository's links were replaced. Workspace-scoped like every
 * frame on this stream, so the Context pages re-read without a repo room.
 */
export interface ContextChangedEvent {
  type: 'context.changed';
  /** What changed, so a listener can narrow its re-read. */
  change: 'sources' | 'documents' | 'bindings';
  /** The source it happened to, when it was one source. */
  sourceId?: string;
  /** The repository whose links changed, for a `bindings` change. */
  repoFullName?: string;
}

/**
 * One run's record was written — a session started or settled, a step's detail
 * moved, the run itself finished. Workspace-scoped like every frame here, which
 * is how a run of the WORKSPACE (a Document scan, which belongs to no
 * repository and has no socket room) reaches the page watching it.
 */
export interface RunChangedEvent {
  type: 'run.changed';
  runId: string;
  /** The key the run lives under: a repository's `owner/repo`, or `workspace:<org>`. */
  repoKey: string;
}

export type ServerEvent =
  | JobProgressEvent
  | NotificationEvent
  | ContextChangedEvent
  | RunChangedEvent;

// --- API response shapes --------------------------------------------

export interface JobsResponse {
  jobs: JobView[];
}

export interface NotificationsResponse {
  notifications: NotificationView[];
  unreadCount: number;
}
