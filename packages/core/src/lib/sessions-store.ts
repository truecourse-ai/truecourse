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
  type RunProgressStep,
  type RunRecord,
  type RunStatus,
  type SessionCommand,
  type SessionEvent,
  type SessionIndexEntry,
  type SessionPersistence,
} from '@truecourse/agent-loop';
import { getRepoTruecourseDir } from '../config/paths.js';
import { atomicWriteJson } from './atomic-write.js';

export function sessionsDir(repoDir: string): string {
  return path.join(getRepoTruecourseDir(repoDir), 'sessions');
}

/**
 * Payload of the `onRunStarted` hook every agentic in-process command offers:
 * fired the moment `createSessionRun` returns, before any session runs. The
 * CLI prints the dashboard "watch live" deep link from it.
 */
export interface SessionRunStartedInfo {
  command: SessionCommand;
  runId: string;
  /** The run directory, `<repo>/.truecourse/sessions/<command>/<runId>`. */
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
  /** The run directory, `<repo>/.truecourse/sessions/<command>/<runId>`. */
  readonly dir: string;
  record(): RunRecord;
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
   * Mirror the run-level phase checklist into the record, so a dashboard
   * watching the run sees progress from phases that are not sessions (spec
   * scan discovers and tags docs long before its first session exists).
   */
  setProgress(steps: RunProgressStep[]): void;
  /** Terminal write: stamps `finishedAt` and drops the dead endpoint. */
  finish(status: Exclude<RunStatus, 'running'>): void;
}

export function createSessionRun(
  repoDir: string,
  opts: { command: SessionCommand; gitRef: string; now?: () => Date },
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
  };
  const dir = sessionRunDir(repoDir, opts.command, runId);
  fs.mkdirSync(dir, { recursive: true });
  atomicWriteJson(path.join(dir, 'run.json'), record);
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
  const write = (): void => atomicWriteJson(runJsonPath, record);

  return {
    runId: record.runId,
    dir,
    record: () => record,
    persistence: {
      appendEvent(sessionId, event) {
        fs.appendFileSync(transcriptPath(dir, sessionId), JSON.stringify(event) + '\n');
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
    setProgress(steps) {
      record.progress = steps;
      write();
    },
    finish(status) {
      record.status = status;
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
    atomicWriteJson(path.join(sessionRunDir(repoDir, run.command, run.runId), 'run.json'), run);
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
