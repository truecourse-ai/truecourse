/**
 * THE SESSIONS STORE — a run's record and its sessions' transcripts.
 *
 * Every run is a row (`activity_runs`) with an append-only journal of activity
 * events (`activity_events`): the run record's every state, and one entry per
 * transcript event. That is what the Agent page reads and follows, and what
 * `runAgentLoop` persists through. The seam exists because `@truecourse/core`
 * cannot depend on `@truecourse/data-store`; boot installs the Postgres backend
 * over it.
 *
 * Each run also gets a LOCAL SCRATCH DIRECTORY under the runtime dir
 * ({@link sessionRunDir}). Nothing durable lives there: it carries the live
 * progress a driver reports between committed events — what a session is
 * waiting on right now — and the provider state the Agent SDK mirrors for a
 * parked session. A run whose directory is gone replays from the journal.
 */

import path from 'node:path';
import {
  type ChecklistItem,
  type RunError,
  type RunRecord,
  type RunStatus,
  type SessionCommand,
  type SessionEvent,
  type SessionPersistence,
} from '@truecourse/agent-loop';
import { compactRunSnapshots, type ActivityEvent } from '@truecourse/shared/activity-stream';
import { getRuntimeDir } from '../config/runtime-dir.js';

/**
 * The key a WORKSPACE's own runs are recorded under — the Document scan belongs
 * to a workspace, not to any repository, so it has no `owner/repo` to key by.
 * The grammar lives here because this store is what addresses by it.
 */
export function workspaceSessionsKey(workspaceOrgId: string): string {
  return `workspace:${workspaceOrgId}`;
}

/** Is this a workspace run key rather than a repository's `owner/repo`? */
export function isWorkspaceSessionsKey(key: string): boolean {
  return key.startsWith('workspace:');
}

/** The workspace a run key names, or null when the key names a repository. */
export function workspaceOfSessionsKey(key: string): string | null {
  return isWorkspaceSessionsKey(key) ? key.slice('workspace:'.length) : null;
}

/** One run key as one safe directory segment. */
function scratchName(key: string): string {
  return key.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 120);
}

/** Where a repository's or workspace's run scratch lives. */
export function sessionsDir(repoKey: string): string {
  return path.join(getRuntimeDir(), 'sessions', scratchName(repoKey));
}

/** One run's scratch directory. */
export function sessionRunDir(repoKey: string, command: SessionCommand, runId: string): string {
  return path.join(sessionsDir(repoKey), command, runId);
}

/** What a run is opened with. */
export interface CreateSessionRunOptions {
  command: SessionCommand;
  gitRef: string;
  now?: () => Date;
}

/**
 * Payload of the `onRunStarted` hook every agentic in-process command offers:
 * fired the moment the run record exists, before any session runs.
 */
export interface SessionRunStartedInfo {
  command: SessionCommand;
  runId: string;
  /** The run's local scratch directory. */
  dir: string;
}

/**
 * A run record safe to serialize to a browser: `endpoint` (carries the session
 * API token) and `pid` stripped. Every dashboard surface reads runs through
 * this shape.
 */
export type PublicRunRecord = Omit<RunRecord, 'endpoint' | 'pid'>;

export function toPublicRunRecord(record: RunRecord): PublicRunRecord {
  const { endpoint: _endpoint, pid: _pid, ...pub } = record;
  return pub;
}

/** A live handle on one run's records — the shell writes through it. */
export interface SessionRunStore {
  readonly runId: string;
  /** Stable local run path for file history or provider scratch state. Postgres history is not stored here. */
  readonly dir: string;
  record(): RunRecord;
  /** Drain ordered async writes before the owning job settles. */
  flush?(): Promise<void>;
  subscribeActivity?(notify: () => void): () => void;
  readActivity?(after: number): Promise<import('@truecourse/shared/activity-stream').ActivityEvent[]>;
  /** One bounded slice of the journal, so a reader pages a long run instead of
   *  loading every event to show its first screen. */
  readActivityPage?(after: number, limit: number): Promise<ActivityEvent[]>;
  /** The same cursor window, omitting superseded run snapshots before transfer. */
  readCompactActivityPage?(after: number, limit: number): Promise<ActivityPage>;
  validateActivityCursor?(after: number): Promise<void>;
  /** Dashboard reads load only this session; synchronous persistence reads belong to live writers. */
  readTranscript?(sessionId: string, since: number): Promise<SessionEvent[]>;
  readTranscriptPage?(sessionId: string, options: TranscriptPageOptions): Promise<TranscriptPage>;
  setGitRef?(gitRef: string): void;
  /** What `runAgentLoop` persists through. */
  readonly persistence: SessionPersistence;
  /** Advertise the live session API (URL + token, never a bare port). */
  setEndpoint(endpoint: { url: string; token: string }): void;
  /**
   * Record what the run's sessions run on: the transport mode plus the
   * driver's own attribution. Written after creation for the same reason the
   * endpoint is — the driver is built against the run's directory, so it
   * cannot exist before the record does. Never credentials.
   */
  setLlm(llm: NonNullable<RunRecord['llm']>): void;
  /**
   * Stamp the run's phase checklist — one block of the same vocabulary its
   * sessions' outcomes use. Written several times a second while a run moves,
   * so it replaces the FIRST `checklist` block IN PLACE (inserting one at the
   * front when the run has none) and leaves every other block untouched: a
   * progress rewrite must never clobber what another writer said. The
   * dashboard needs it because phases that are not sessions (spec scan
   * discovers and tags docs long before its first session exists) can only be
   * seen through the record.
   */
  setChecklist(items: ChecklistItem[]): void;
  /**
   * Why the run is failing. Stamped by whoever knows — the start-time LLM
   * checks stamp theirs before the first session exists, so a run that never
   * got off the ground still says why.
   */
  setError(error: RunError): void;
  /** Terminal write: stamps `finishedAt` and drops the dead endpoint. */
  finish(status: Exclude<RunStatus, 'running'>, opts?: { error?: RunError }): void;
}

/** A run record carrying the repository it belongs to: what a listing that
 *  spans a workspace's repositories returns. */
export type RepoRunRecord = RunRecord & { repoKey: string };

/**
 * How a cross-repository listing narrows and pages. The order is newest first
 * (`startedAt` descending, `runId` ascending as the tiebreak), and `before` is
 * the cursor of the last run of the previous page.
 */
export interface SessionRunQuery {
  command?: SessionCommand;
  status?: RunStatus;
  /** Narrow to one run, whichever repository holds it. */
  runId?: string;
  limit: number;
  before?: string;
}

/** The paging key of a run in the newest-first order. */
export function sessionRunCursor(run: { startedAt: string; runId: string }): string {
  return `${run.startedAt}|${run.runId}`;
}

/** null for anything that is not a cursor this store minted. */
export function parseSessionRunCursor(cursor: string): { startedAt: string; runId: string } | null {
  const at = cursor.indexOf('|');
  if (at <= 0 || at === cursor.length - 1) return null;
  return { startedAt: cursor.slice(0, at), runId: cursor.slice(at + 1) };
}

/** One page of a run's journal. `nextCursor` is what resumes the read; `done`
 *  means the page reached the end of the journal as it stands. */
export interface ActivityPage {
  events: ActivityEvent[];
  nextCursor: number;
  done: boolean;
}

/** Where runs and their transcripts are kept. */
export interface SessionRunBackend {
  subscribeRepo(repoKey: string, notify: () => void): () => void;
  create(repoKey: string, opts: CreateSessionRunOptions): Promise<SessionRunStore>;
  open(repoKey: string, command: SessionCommand, runId: string): Promise<SessionRunStore>;
  /**
   * Take a settled run back over and carry it on: the record reads `running`
   * again, this process holds the writer's lease, and everything already in
   * the journal stands. What a resumed job writes lands in the conversation it
   * stopped in rather than a second one beside it.
   */
  resume(repoKey: string, command: SessionCommand, runId: string): Promise<SessionRunStore>;
  list(repoKey: string, command?: SessionCommand): Promise<RunRecord[]>;
  listForRepos(repoKeys: string[], opts: SessionRunQuery): Promise<RepoRunRecord[]>;
}

export class SessionRunNotFoundError extends Error {
  constructor() { super('Session run not found'); }
}

let backend: SessionRunBackend | undefined;

export function setSessionRunBackend(value: SessionRunBackend | undefined): void { backend = value; }

function store(): SessionRunBackend {
  if (!backend) throw new Error('No session run store installed (boot did not run installDbStores).');
  return backend;
}

export async function createStoredSessionRun(repoKey: string, opts: CreateSessionRunOptions): Promise<SessionRunStore> {
  return store().create(repoKey, opts);
}
export async function openStoredSessionRun(repoKey: string, command: SessionCommand, runId: string): Promise<SessionRunStore> {
  return store().open(repoKey, command, runId);
}
/** Carry a settled run on: see {@link SessionRunBackend.resume}. */
export async function resumeStoredSessionRun(repoKey: string, command: SessionCommand, runId: string): Promise<SessionRunStore> {
  return store().resume(repoKey, command, runId);
}
export async function listStoredSessionRuns(repoKey: string, command?: SessionCommand): Promise<RunRecord[]> {
  return store().list(repoKey, command);
}

/** Every named repository's runs as one newest-first page. */
export async function listStoredSessionRunsForRepos(
  repoKeys: string[],
  opts: SessionRunQuery,
): Promise<RepoRunRecord[]> {
  if (opts.before !== undefined && !parseSessionRunCursor(opts.before)) {
    throw new Error('Invalid session run cursor');
  }
  return repoKeys.length ? store().listForRepos(repoKeys, opts) : [];
}

export async function readStoredActivity(run: SessionRunStore, after = -1): Promise<ActivityEvent[]> {
  if (!run.readActivity) throw new Error('This run store does not read its activity journal.');
  return run.readActivity(after);
}

/** One page of the journal past `after`. */
export async function readStoredActivityPage(
  run: SessionRunStore,
  after: number,
  limit: number,
  compact = false,
): Promise<ActivityPage> {
  if (compact && run.readCompactActivityPage) return run.readCompactActivityPage(after, limit);
  const events = run.readActivityPage
    ? await run.readActivityPage(after, limit)
    : (await readStoredActivity(run, after)).slice(0, limit);
  const last = events[events.length - 1];
  return {
    events: compact ? compactRunSnapshots(events) : events,
    nextCursor: last ? last.cursor : after,
    done: events.length < limit,
  };
}

export async function validateStoredActivityCursor(run: SessionRunStore, after: number): Promise<void> {
  if (run.validateActivityCursor) return run.validateActivityCursor(after);
}

export async function readStoredTranscript(run: SessionRunStore, sessionId: string, since = -1): Promise<SessionEvent[]> {
  if (run.readTranscript) return run.readTranscript(sessionId, since);
  const events = run.persistence.readEvents(sessionId);
  return since >= 0 ? events.filter(event => event.seq > since) : events;
}

/** Follow a repository's runs: fires whenever one of them is written. */
export function subscribeStoredSessionRuns(repoKey: string, notify: () => void): () => void {
  return store().subscribeRepo(repoKey, notify);
}

/** Initial/older pages read backwards; live catch-up reads forwards after since. */
export interface TranscriptPageOptions { limit: number; before?: number; since?: number }
export interface TranscriptPage { events: SessionEvent[]; hasMore: boolean }
export async function readStoredTranscriptPage(run: SessionRunStore, sessionId: string, options: TranscriptPageOptions): Promise<TranscriptPage> {
  if (run.readTranscriptPage) return run.readTranscriptPage(sessionId, options);
  const events = (await readStoredTranscript(run, sessionId, options.since ?? -1))
    .filter(e => options.before === undefined || e.seq < options.before).sort((a, b) => a.seq - b.seq);
  return { events: options.since === undefined ? events.slice(-options.limit) : events.slice(0, options.limit), hasMore: events.length > options.limit };
}
