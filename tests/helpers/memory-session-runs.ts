/**
 * A `SessionRunBackend` held in memory — the test double every suite that
 * CREATES a run installs.
 *
 * Production has one backend, Postgres (`PgSessionRunStore`). A test that only
 * needs a run to exist so the engine can write a record and a transcript into
 * it gets that here, with the same handle shape and the same activity journal
 * (the journal is a real file under the run's scratch dir, exactly as a hosted
 * run keeps it, so the live-progress paths are exercised too).
 */

import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import type {
  RunRecord,
  SessionCommand,
  SessionEvent,
  SessionIndexEntry,
} from '@truecourse/agent-loop';
import type { ActivityEvent } from '@truecourse/shared/activity-stream';
import {
  parseSessionRunCursor,
  sessionRunDir,
  setSessionRunBackend as setSessionRunBackendByPackage,
  SessionRunNotFoundError,
  toPublicRunRecord,
  type CreateSessionRunOptions,
  type RepoRunRecord,
  type SessionRunBackend,
  type SessionRunQuery,
  type SessionRunStore,
} from '@truecourse/core/lib/sessions-store';
import {
  appendActivityEvent,
  publishActivityProgress,
  readActivityEvents,
  validateActivityCursor,
} from '@truecourse/core/lib/activity-journal';
import { setSessionRunBackend as setSessionRunBackendBySource } from '../../packages/core/src/lib/sessions-store';

interface Held {
  repoKey: string;
  record: RunRecord;
  handle: SessionRunStore;
  transcripts: Map<string, SessionEvent[]>;
}

export class MemorySessionRunStore implements SessionRunBackend {
  private readonly runs = new Map<string, Held>();
  private readonly watchers = new Map<string, Set<() => void>>();

  subscribeRepo(repoKey: string, notify: () => void): () => void {
    const set = this.watchers.get(repoKey) ?? new Set();
    set.add(notify);
    this.watchers.set(repoKey, set);
    return () => set.delete(notify);
  }

  private announce(repoKey: string): void {
    for (const notify of this.watchers.get(repoKey) ?? []) notify();
  }

  async create(repoKey: string, opts: CreateSessionRunOptions): Promise<SessionRunStore> {
    const record: RunRecord = {
      command: opts.command,
      runId: randomUUID(),
      gitRef: opts.gitRef,
      startedAt: (opts.now?.() ?? new Date()).toISOString(),
      status: 'running',
      sessions: [],
      activityStream: 'ai-sdk-v1',
    };
    const dir = sessionRunDir(repoKey, record.command, record.runId);
    fs.mkdirSync(dir, { recursive: true });
    const transcripts = new Map<string, SessionEvent[]>();
    const held: Held = { repoKey, record, transcripts, handle: null as unknown as SessionRunStore };
    const write = (): void => {
      appendActivityEvent(dir, { kind: 'run', run: toPublicRunRecord(record) });
      this.announce(repoKey);
    };
    held.handle = {
      runId: record.runId,
      dir,
      record: () => record,
      persistence: {
        // Live progress between committed events — the journal holds it exactly
        // as a hosted run does, and an accepted event retires it.
        publishProgress(sessionId, progress) {
          if (record.status === 'running') publishActivityProgress(dir, sessionId, progress);
        },
        appendEvent(sessionId, event) {
          const events = transcripts.get(sessionId) ?? [];
          events.push(event);
          transcripts.set(sessionId, events);
          appendActivityEvent(dir, { kind: 'session-event', sessionId, event });
        },
        updateIndex(entry: SessionIndexEntry) {
          const at = record.sessions.findIndex((s) => s.sessionId === entry.sessionId);
          if (at === -1) record.sessions.push(entry);
          else record.sessions[at] = entry;
          write();
        },
        readEvents(sessionId) {
          return transcripts.get(sessionId) ?? [];
        },
      },
      readActivity: async (after: number): Promise<ActivityEvent[]> => readActivityEvents(dir, after),
      // A reconnect cursor is checked against the journal before anything is
      // streamed, exactly as the Postgres backend checks it against the row.
      validateActivityCursor: async (after: number): Promise<void> => validateActivityCursor(dir, after),
      setGitRef(gitRef) {
        record.gitRef = gitRef;
        write();
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
        const at = blocks.findIndex((block) => block.kind === 'checklist');
        const checklist = { kind: 'checklist' as const, items };
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
    this.runs.set(record.runId, held);
    write();
    return held.handle;
  }

  async open(repoKey: string, command: SessionCommand, runId: string): Promise<SessionRunStore> {
    const held = this.runs.get(runId);
    if (!held || held.repoKey !== repoKey || held.record.command !== command) {
      throw new SessionRunNotFoundError();
    }
    return held.handle;
  }

  async list(repoKey: string, command?: SessionCommand): Promise<RunRecord[]> {
    return [...this.runs.values()]
      .filter((h) => h.repoKey === repoKey && (!command || h.record.command === command))
      .map((h) => h.record)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  async listForRepos(repoKeys: string[], opts: SessionRunQuery): Promise<RepoRunRecord[]> {
    const keys = new Set(repoKeys);
    // `before` is a cursor in THIS order — newest first, ties by run id — so a
    // page starts at the first run that sorts strictly after it.
    const before = opts.before ? parseSessionRunCursor(opts.before) : null;
    const after = (run: RepoRunRecord): boolean =>
      before == null
      || run.startedAt < before.startedAt
      || (run.startedAt === before.startedAt && run.runId > before.runId);
    return [...this.runs.values()]
      .filter((h) => keys.has(h.repoKey))
      .map((h) => ({ ...h.record, repoKey: h.repoKey }))
      .filter((run) => (!opts.command || run.command === opts.command)
        && (!opts.status || run.status === opts.status)
        && (!opts.runId || run.runId === opts.runId)
        && after(run))
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt) || a.runId.localeCompare(b.runId))
      .slice(0, opts.limit);
  }
}

/**
 * Install the in-memory backend for a suite. Pair with {@link resetSessionRuns}.
 *
 * The seam is installed through BOTH specifiers a test can reach it by — the
 * package (`@truecourse/core/...`, which resolves to the built `dist`) and the
 * source path — because a test imports the code under test either way (some
 * modules, like `services/spec-scan/run`, have no package subpath at all), and
 * the two are separate module instances with separate state.
 */
export function installMemorySessionRuns(): MemorySessionRunStore {
  const store = new MemorySessionRunStore();
  setSessionRunBackendByPackage(store);
  setSessionRunBackendBySource(store);
  return store;
}

export function resetSessionRuns(): void {
  setSessionRunBackendByPackage(undefined);
  setSessionRunBackendBySource(undefined);
}
