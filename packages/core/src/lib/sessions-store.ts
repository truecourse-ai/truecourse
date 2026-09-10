/**
 * The OSS file sessions store: one directory per
 * run at `.truecourse/sessions/<command>/<runId>/` — gitignored entirely —
 * holding `run.json` (the run record + session index) and one transcript
 * jsonl per session. `run.json` writes are atomic; transcripts are plain
 * appends (one JSON line per event), so the dashboard watcher can tail them
 * and a crash can at worst truncate the final line, which reads tolerate.
 *
 * The `SessionPersistence` each run exposes is what `runAgentLoop` consumes;
 * EE implements the same interface over its runs/transcript-events tables.
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  RunRecordSchema,
  type ChecklistItem,
  type DisplayBlock,
  type RunError,
  type RunRecord,
  type RunStatus,
  type SessionCommand,
  type SessionEvent,
  type SessionIndexEntry,
  type SessionPersistence,
} from '@truecourse/agent-loop';
import type { ActivityEvent } from '@truecourse/shared/activity-stream';
import { getRepoTruecourseDir } from '../config/paths.js';
import { atomicWriteJson } from './atomic-write.js';
import { appendActivityEvent, publishActivityProgress, readActivityEvents, validateActivityCursor } from './activity-journal.js';

/**
 * Where a repo's sessions live. The default is the repo tree
 * (`<repo>/.truecourse/sessions`); a server whose repos are opaque identities
 * rather than checked-out paths (the DB-backed dashboard, where the working
 * tree is an ephemeral per-run clone) installs a resolver that maps the repo
 * key to a persistent server-side directory instead — transcripts must outlive
 * the clone, and the run watcher needs a stable path to tail.
 */
export type SessionsRootResolver = (repoDirOrKey: string) => string;

const defaultSessionsRoot: SessionsRootResolver = (repoDir) =>
  path.join(getRepoTruecourseDir(repoDir), 'sessions');

let activeSessionsRoot: SessionsRootResolver = defaultSessionsRoot;

export function setSessionsRootResolver(resolver: SessionsRootResolver): void {
  activeSessionsRoot = resolver;
}

export function resetSessionsRootResolver(): void {
  activeSessionsRoot = defaultSessionsRoot;
}

export function sessionsDir(repoDir: string): string {
  return activeSessionsRoot(repoDir);
}

/**
 * Payload of the `onRunStarted` hook every agentic in-process command offers:
 * fired the moment `createSessionRun` returns, before any session runs. The
 * CLI prints the dashboard "watch live" deep link from it.
 */
export interface SessionRunStartedInfo {
  command: SessionCommand;
  runId: string;
  /** Stable local run path for file history or provider scratch state. Postgres history is not stored here. */
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

export function sessionRunDir(repoDir: string, command: SessionCommand, runId: string): string {
  return path.join(sessionsDir(repoDir), command, runId);
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
  validateActivityCursor?(after: number): Promise<void>;
  /** Dashboard reads load only this session; synchronous persistence reads belong to live writers. */
  readTranscript?(sessionId: string, since: number): Promise<SessionEvent[]>;
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

export function createSessionRun(
  repoDir: string,
  opts: { command: SessionCommand; gitRef: string; now?: () => Date; activityStream?: boolean },
): SessionRunStore {
  // Starting a run is the boot the sweep belongs to: before this
  // process writes a new record, every run left `running` by a process that
  // is gone gets the honest status. Runs of THIS process are untouched — its
  // pid is alive — so a concurrent run is never mistaken for a corpse.
  reconcileSessionsStore(repoDir);
  const startedAt = (opts.now?.() ?? new Date()).toISOString();
  const runId = `${startedAt.replace(/[:.]/g, '-').replace(/-\d{3}Z$/, 'Z')}_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
  const record: RunRecord = {
    command: opts.command,
    runId,
    gitRef: opts.gitRef,
    startedAt,
    status: 'running',
    pid: process.pid,
    sessions: [],
    ...(opts.activityStream ? { activityStream: 'ai-sdk-v1' as const } : {}),
  };
  const dir = sessionRunDir(repoDir, opts.command, runId);
  fs.mkdirSync(dir, { recursive: true });
  atomicWriteJson(path.join(dir, 'run.json'), record);
  if (record.activityStream) appendActivityEvent(dir, { kind: 'run', run: toPublicRunRecord(record) });
  return openRun(dir, record);
}

/** Reopen an existing run (resume, post-mortem reads). Throws if absent. */
export function openSessionRun(
  repoDir: string,
  command: SessionCommand,
  runId: string,
): SessionRunStore {
  const dir = sessionRunDir(repoDir, command, runId);
  const record = RunRecordSchema.parse(
    JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf-8')),
  );
  return openRun(dir, record);
}

function openRun(dir: string, record: RunRecord): SessionRunStore {
  const runJsonPath = path.join(dir, 'run.json');
  const write = (): void => {
    atomicWriteJson(runJsonPath, record);
    if (record.activityStream) appendActivityEvent(dir, { kind: 'run', run: toPublicRunRecord(record) });
  };

  return {
    runId: record.runId,
    dir,
    record: () => record,
    setGitRef(gitRef) { record.gitRef = gitRef; write(); },
    persistence: {
      ...(record.activityStream ? {
        publishProgress: (sessionId: string, progress: import('@truecourse/agent-loop').SessionProgress) => {
          if (record.status === 'running') publishActivityProgress(dir, sessionId, progress);
        },
      } : {}),
      appendEvent(sessionId, event) {
        fs.appendFileSync(transcriptPath(dir, sessionId), JSON.stringify(event) + '\n');
        if (record.activityStream) appendActivityEvent(dir, { kind: 'session-event', sessionId, event });
      },
      updateIndex(entry: SessionIndexEntry) {
        const i = record.sessions.findIndex((s) => s.sessionId === entry.sessionId);
        if (i === -1) record.sessions.push(entry);
        else record.sessions[i] = entry;
        write();
      },
      readEvents(sessionId) {
        return readTranscript(transcriptPath(dir, sessionId));
      },
    },
    setEndpoint(endpoint) {
      record.endpoint = endpoint;
      write();
    },
    setLlm(llm) {
      record.llm = llm;
      write();
    },
    setChecklist(items) {
      const blocks = record.display?.blocks ?? [];
      const checklist: DisplayBlock = { kind: 'checklist', items };
      const at = blocks.findIndex((block) => block.kind === 'checklist');
      record.display = {
        blocks: at === -1 ? [checklist, ...blocks] : blocks.map((b, i) => (i === at ? checklist : b)),
      };
      write();
    },
    setError(error) {
      record.error = error;
      write();
    },
    finish(status, opts) {
      record.status = status;
      if (opts?.error) record.error = opts.error;
      record.finishedAt = new Date().toISOString();
      delete record.endpoint;
      write();
    },
  };
}

function transcriptPath(dir: string, sessionId: string): string {
  // Session ids are minted by us (uuids), but keep filenames safe anyway.
  return path.join(dir, `${sessionId.replace(/[^A-Za-z0-9._-]/g, '_')}.jsonl`);
}

/** Repair a crash between a transcript/snapshot write and its journal append. */
export function recoverSessionActivity(run: SessionRunStore): void {
  if (!run.record().activityStream) return;
  const journal = readActivityEvents(run.dir);
  const seen = new Map<string, Set<number>>();
  let lastRun: PublicRunRecord | undefined;
  for (const entry of journal) {
    if (entry.kind === 'run') lastRun = entry.run;
    else {
      const seqs = seen.get(entry.sessionId) ?? new Set<number>();
      seqs.add(entry.event.seq); seen.set(entry.sessionId, seqs);
    }
  }
  for (const name of fs.readdirSync(run.dir)) {
    if (!name.endsWith('.jsonl') || name === 'activity.jsonl') continue;
    const sessionId = name.slice(0, -6);
    for (const event of run.persistence.readEvents(sessionId)) {
      if (!seen.get(sessionId)?.has(event.seq)) appendActivityEvent(run.dir, { kind: 'session-event', sessionId, event });
    }
  }
  const current = toPublicRunRecord(run.record());
  if (JSON.stringify(lastRun) !== JSON.stringify(current)) appendActivityEvent(run.dir, { kind: 'run', run: current });
}

/**
 * Read a transcript back. A crash mid-append can truncate the FINAL line —
 * that one is dropped (the per-session `seq` makes the gap detectable); a
 * malformed line anywhere else is real corruption and throws.
 */
function readTranscript(filePath: string): SessionEvent[] {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const lines = raw.split('\n').filter((line) => line.trim() !== '');
  const events: SessionEvent[] = [];
  for (let i = 0; i < lines.length; i++) {
    try {
      events.push(JSON.parse(lines[i]) as SessionEvent);
    } catch (err) {
      if (i === lines.length - 1) break; // crash-truncated final line
      throw new Error(`corrupt transcript line ${i} in ${filePath}: ${String(err)}`);
    }
  }
  return events;
}

/**
 * List every run record, newest first (optionally one command's) — swept
 * first, so a listing never shows a run as `running` on a dead process's
 * memory. The sweep needs the whole store, so the command filter narrows the
 * RESULT, not the read.
 */
export function listSessionRuns(repoDir: string, command?: SessionCommand): RunRecord[] {
  const runs = readSessionRuns(repoDir);
  // Mutates the records in place, so the listing shows the swept status
  // without a second read.
  sweepRuns(repoDir, runs, defaultIsProcessAlive);
  return (command ? runs.filter((run) => run.command === command) : runs).sort((a, b) =>
    b.startedAt.localeCompare(a.startedAt),
  );
}

/** Every run record on disk, unswept and unsorted. */
function readSessionRuns(repoDir: string): RunRecord[] {
  const root = sessionsDir(repoDir);
  const runs: RunRecord[] = [];
  for (const cmd of listDirs(root)) {
    for (const runId of listDirs(path.join(root, cmd))) {
      const runJson = path.join(root, cmd, runId, 'run.json');
      try {
        runs.push(RunRecordSchema.parse(JSON.parse(fs.readFileSync(runJson, 'utf-8'))));
      } catch {
        // a half-created or foreign directory is not a run
      }
    }
  }
  return runs;
}

function listDirs(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

/**
 * The boot reconciliation sweep: a run left `running` by a dead
 * process is marked `interrupted`, its dead endpoint dropped, and its
 * `running`/`waiting` sessions marked `parked` — resumable from their
 * persisted transcripts, never "running" on a dead process's memory.
 */
export function reconcileSessionsStore(
  repoDir: string,
  opts?: { isProcessAlive?: (pid: number) => boolean },
): { interrupted: RunRecord[] } {
  const isAlive = opts?.isProcessAlive ?? defaultIsProcessAlive;
  return { interrupted: sweepRuns(repoDir, readSessionRuns(repoDir), isAlive) };
}

/** The sweep itself, over records already read — mutated in place and, when
 *  they changed, written back. */
function sweepRuns(
  repoDir: string,
  runs: readonly RunRecord[],
  isAlive: (pid: number) => boolean,
): RunRecord[] {
  const interrupted: RunRecord[] = [];
  for (const run of runs) {
    if (run.status !== 'running') continue;
    if (run.pid !== undefined && isAlive(run.pid)) continue;
    run.status = 'interrupted';
    run.finishedAt = new Date().toISOString();
    delete run.endpoint;
    for (const session of run.sessions) {
      if (session.status === 'running' || session.status === 'waiting') {
        session.status = 'parked';
      }
    }
    const dir = sessionRunDir(repoDir, run.command, run.runId);
    atomicWriteJson(path.join(dir, 'run.json'), run);
    if (run.activityStream) appendActivityEvent(dir, { kind: 'run', run: toPublicRunRecord(run) });
    interrupted.push(run);
  }
  return interrupted;
}

function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
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

/** Dashboard storage boundary. File-mode callers retain the synchronous store. */
export interface SessionRunBackend {
  subscribeRepo(repoKey: string, notify: () => void): () => void;
  create(repoKey: string, opts: Parameters<typeof createSessionRun>[1]): Promise<SessionRunStore>;
  open(repoKey: string, command: SessionCommand, runId: string): Promise<SessionRunStore>;
  list(repoKey: string, command?: SessionCommand): Promise<RunRecord[]>;
  listForRepos(repoKeys: string[], opts: SessionRunQuery): Promise<RepoRunRecord[]>;
}
export class SessionRunNotFoundError extends Error {
  constructor() { super('Session run not found'); }
}
let backend: SessionRunBackend | undefined;
export function setSessionRunBackend(value: SessionRunBackend | undefined): void { backend = value; }
export async function createStoredSessionRun(repoKey: string, opts: Parameters<typeof createSessionRun>[1]): Promise<SessionRunStore> {
  return backend && !path.isAbsolute(repoKey) ? backend.create(repoKey, opts) : createSessionRun(repoKey, opts);
}
export async function openStoredSessionRun(repoKey: string, command: SessionCommand, runId: string): Promise<SessionRunStore> {
  if (backend && !path.isAbsolute(repoKey)) return backend.open(repoKey, command, runId);
  try { return openSessionRun(repoKey, command, runId); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new SessionRunNotFoundError();
    throw error;
  }
}
export async function listStoredSessionRuns(repoKey: string, command?: SessionCommand): Promise<RunRecord[]> {
  return backend && !path.isAbsolute(repoKey) ? backend.list(repoKey, command) : listSessionRuns(repoKey, command);
}

/**
 * Every repository's runs as one newest-first page. A backend key (a repo
 * identity, never a path) is answered by one backend query; a path is the file
 * store's own listing, swept as it reads. The merged result is ordered and
 * paged here, so a mixed workspace pages exactly like a homogeneous one.
 */
export async function listStoredSessionRunsForRepos(
  repoKeys: string[],
  opts: SessionRunQuery,
): Promise<RepoRunRecord[]> {
  const hosted = backend ? repoKeys.filter((key) => !path.isAbsolute(key)) : [];
  const stored = new Set(hosted);
  const runs: RepoRunRecord[] = hosted.length ? [...(await backend!.listForRepos(hosted, opts))] : [];
  for (const key of repoKeys) {
    if (stored.has(key)) continue;
    for (const run of listSessionRuns(key, opts.command)) runs.push({ ...run, repoKey: key });
  }
  return pageSessionRuns(runs, opts);
}

/** The shared ordering and paging of a cross-repository listing. */
function pageSessionRuns(runs: RepoRunRecord[], opts: SessionRunQuery): RepoRunRecord[] {
  let before: { startedAt: string; runId: string } | undefined;
  if (opts.before !== undefined) {
    const parsed = parseSessionRunCursor(opts.before);
    if (!parsed) throw new Error('Invalid session run cursor');
    before = parsed;
  }
  return runs
    .filter((run) => {
      if (opts.command && run.command !== opts.command) return false;
      if (opts.status && run.status !== opts.status) return false;
      if (opts.runId && run.runId !== opts.runId) return false;
      if (!before) return true;
      return run.startedAt < before.startedAt
        || (run.startedAt === before.startedAt && run.runId > before.runId);
    })
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt) || a.runId.localeCompare(b.runId))
    .slice(0, opts.limit);
}

export async function readStoredActivity(run: SessionRunStore, after = -1) {
  if (run.readActivity) return run.readActivity(after);
  return readActivityEvents(run.dir, after);
}

/** One page of the journal past `after`. A store with no bounded read answers
 *  from the tail it already reads, which is the file journal's own slice. */
export async function readStoredActivityPage(
  run: SessionRunStore,
  after: number,
  limit: number,
): Promise<ActivityPage> {
  const events = run.readActivityPage
    ? await run.readActivityPage(after, limit)
    : (await readStoredActivity(run, after)).slice(0, limit);
  const last = events[events.length - 1];
  return { events, nextCursor: last ? last.cursor : after, done: events.length < limit };
}

export async function validateStoredActivityCursor(run: SessionRunStore, after: number): Promise<void> {
  if (run.validateActivityCursor) return run.validateActivityCursor(after);
  validateActivityCursor(run.dir, after);
}

export async function readStoredTranscript(run: SessionRunStore, sessionId: string, since = -1): Promise<SessionEvent[]> {
  if (run.readTranscript) return run.readTranscript(sessionId, since);
  const events = run.persistence.readEvents(sessionId);
  return since >= 0 ? events.filter(event => event.seq > since) : events;
}

/** undefined means the caller should watch the file store. */
export function subscribeStoredSessionRuns(repoKey: string, notify: () => void): (() => void) | undefined {
  return backend && !path.isAbsolute(repoKey) ? backend.subscribeRepo(repoKey, notify) : undefined;
}
