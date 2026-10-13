/**
 * Postgres run snapshots and their ordered activity journal. Tool output can
 * reach both transcripts and run metadata (checklist facts, titles, errors),
 * so both are stored as serialized JSON strings inside JSONB envelopes. This
 * preserves NUL and lone UTF-16 surrogates that JSONB cannot hold directly.
 * Status/start time and transcript sequence stay searchable outside the
 * payload. Readers also accept existing inline records and journal entries.
 */
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gt, inArray, notInArray, sql, getTableColumns } from 'drizzle-orm';
import { activityRuns, activityEvents, type Db, type Pool, type PoolClient } from '@truecourse/db';
import {
  SessionRunNotFoundError, parseSessionRunCursor, sessionRunDir, toPublicRunRecord,
  type CreateSessionRunOptions, type TranscriptPageOptions, type TranscriptPage, type ActivityPage, type RepoRunRecord, type SessionRunBackend, type SessionRunQuery, type SessionRunStore,
} from '@truecourse/core/lib/sessions-store';
import { publishActivityProgress, publishCommittedActivity, readActivityEvents, retireActivityProgress } from '@truecourse/core/lib/activity-journal';
import { ActivityEventSchema, type ActivityEvent, type ActivityEventBody } from '@truecourse/shared/activity-stream';
import type { SessionRunStore as Store } from '@truecourse/core/lib/sessions-store';

type Record = ReturnType<Store['record']>;
type Command = Record['command'];
type Event = ReturnType<Store['persistence']['readEvents']>[number];
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Only the fields queried by SQL remain outside the lossless payload. */
function encodeRunRecord(record: Record): { [key: string]: unknown } {
  return {
    status: record.status, startedAt: record.startedAt,
    recordEncoding: 'json-v1', recordJson: JSON.stringify(toPublicRunRecord(record)),
  };
}

function decodeRunRecord(record: { [key: string]: unknown }): Record {
  if (record.recordEncoding === 'json-v1') {
    if (typeof record.recordJson !== 'string') throw new Error('Invalid stored activity run');
    return JSON.parse(record.recordJson) as Record;
  }
  return clone(record) as Record;
}

function encodeActivityBody(body: ActivityEventBody): { [key: string]: unknown } {
  if (body.kind === 'run') return { kind: body.kind, run: encodeRunRecord(body.run) };
  return {
    kind: body.kind, sessionId: body.sessionId, event: { seq: body.event.seq },
    eventEncoding: 'json-v1', eventJson: JSON.stringify(body.event),
  };
}

function decodeActivityEvent(body: { [key: string]: unknown }, cursor: number): ActivityEvent {
  if (body.kind === 'run' && body.run && typeof body.run === 'object') {
    return ActivityEventSchema.parse({ ...body, run: decodeRunRecord(body.run as { [key: string]: unknown }), cursor });
  }
  if (body.kind === 'session-event' && body.eventEncoding === 'json-v1') {
    if (typeof body.eventJson !== 'string') throw new Error('Invalid stored activity transcript');
    return ActivityEventSchema.parse({ ...body, event: JSON.parse(body.eventJson), cursor });
  }
  return ActivityEventSchema.parse({ ...body, cursor });
}

/** Ordered asynchronous writes behind the pipeline's synchronous progress callbacks.
 * A job MUST await flush before settling. Publication happens after commit.
 */
export class PgSessionRunStore implements SessionRunBackend {
  private readonly owner = randomUUID();
  private readonly live = new Map<string, SessionRunStore>();
  private readonly watchers = new Map<string, Set<() => void>>();
  private readonly runListeners = new Set<(repoKey: string, runId: string) => void>();
  private listener: PoolClient | undefined;
  private connecting = false;
  private retry: ReturnType<typeof setTimeout> | undefined;
  constructor(private readonly db: Db, private readonly notificationPool?: Pool) {}

  /** Is anything still reading announcements? The LISTEN connection lives
   *  exactly as long as this is true. */
  private get watched(): boolean {
    return this.watchers.size > 0 || this.runListeners.size > 0;
  }

  private async listen(): Promise<void> {
    if (!this.notificationPool || this.listener || this.connecting || !this.watched) return;
    this.connecting = true;
    try {
      const client = await this.notificationPool.connect();
      this.listener = client;
      const lost = () => {
        if (this.listener !== client) return;
        this.listener = undefined;
        client.release(true);
        for (const callbacks of this.watchers.values()) for (const notify of callbacks) notify();
        this.scheduleListen();
      };
      client.on('error', lost);
      client.on('end', lost);
      client.on('notification', notification => {
        if (notification.channel !== 'truecourse_activity' || !notification.payload) return;
        try {
          const { repoKey, runId, owner } = JSON.parse(notification.payload) as { repoKey: string; runId: string; owner?: string };
          if (owner !== this.owner) this.announce(repoKey, runId);
        } catch { /* Ignore foreign payloads on this channel. */ }
      });
      await client.query('LISTEN truecourse_activity');
      if (!this.watched && this.listener === client) { this.listener = undefined; client.release(true); return; }
      // Cover the gap before LISTEN and any connection recovery.
      for (const callbacks of this.watchers.values()) for (const notify of callbacks) notify();
    } catch {
      if (this.listener) { this.listener.release(true); this.listener = undefined; }
      this.scheduleListen();
    } finally { this.connecting = false; }
  }

  private scheduleListen(): void {
    if (this.retry || !this.watched) return;
    this.retry = setTimeout(() => { this.retry = undefined; void this.listen(); }, 1000);
    this.retry.unref();
  }

  private announce(repoKey: string, runId: string, includeRun = true): void {
    for (const key of [`repo:${repoKey}`, ...(includeRun ? [`run:${runId}`] : [])]) for (const notify of this.watchers.get(key) ?? []) notify();
    for (const notify of this.runListeners) notify(repoKey, runId);
  }

  subscribeRepo(repoKey: string, notify: () => void): () => void { return this.subscribe(`repo:${repoKey}`, notify); }

  /** Every record write, whichever run it belongs to and whichever process
   *  made it. The server relays these onto the workspace's live stream, which
   *  is the only signal a run with no repository room ever gets. */
  subscribeRuns(notify: (repoKey: string, runId: string) => void): () => void {
    this.runListeners.add(notify);
    void this.listen();
    return () => {
      this.runListeners.delete(notify);
      this.releaseIdleListener();
    };
  }

  private subscribe(runId: string, notify: () => void): () => void {
    let callbacks = this.watchers.get(runId);
    if (!callbacks) { callbacks = new Set(); this.watchers.set(runId, callbacks); }
    callbacks.add(notify); void this.listen();
    return () => {
      callbacks.delete(notify);
      if (!callbacks.size) this.watchers.delete(runId);
      this.releaseIdleListener();
    };
  }

  private releaseIdleListener(): void {
    if (this.watched) return;
    if (this.retry) { clearTimeout(this.retry); this.retry = undefined; }
    if (this.listener) { const client = this.listener; this.listener = undefined; client.release(true); }
  }

  async create(repoKey: string, opts: CreateSessionRunOptions): Promise<SessionRunStore> {
    await this.reconcile([repoKey]);
    const record: Record = {
      command: opts.command, runId: randomUUID(), gitRef: opts.gitRef,
      ...(opts.pullRequest ? { pullRequest: opts.pullRequest } : {}),
      startedAt: (opts.now?.() ?? new Date()).toISOString(), status: 'running', sessions: [], activityStream: 'ai-sdk-v1',
    };
    await this.db.transaction(async tx => {
      await tx.insert(activityRuns).values({
        runId: record.runId, repoKey, command: record.command, record: encodeRunRecord(record), nextCursor: 1,
        owner: this.owner, leaseUntil: sql`CURRENT_TIMESTAMP + interval '60 seconds'`,
      });
      await tx.insert(activityEvents).values({ runId: record.runId, cursor: 0, body: encodeActivityBody({ kind: 'run', run: record }) });
      await tx.execute(sql`SELECT pg_notify('truecourse_activity', ${JSON.stringify({ repoKey, runId: record.runId, owner: this.owner })})`);
    });
    const run = this.handle(repoKey, record);
    this.live.set(record.runId, run);
    this.announce(repoKey, record.runId, false);
    publishCommittedActivity(run.dir, { cursor: 0, kind: 'run', run: clone(record) });
    return run;
  }

  /**
   * Carry a settled run on. The record goes back to `running` and this process
   * takes the writer's lease in ONE transaction, so the write guard every later
   * event passes ("a terminal run takes no running state") sees a live run
   * rather than the one it stopped as. The journal, the sessions it already
   * parked and the checklist all stand: a resume continues the conversation.
   */
  async resume(repoKey: string, command: Command, runId: string): Promise<SessionRunStore> {
    await this.reconcile([repoKey]);
    const resumed = await this.db.transaction(async tx => {
      const [row] = await tx.select().from(activityRuns).where(and(eq(activityRuns.repoKey, repoKey), eq(activityRuns.command, command), eq(activityRuns.runId, runId))).for('update');
      if (!row) throw new SessionRunNotFoundError();
      const record = decodeRunRecord(row.record);
      record.status = 'running';
      delete record.finishedAt; delete record.error;
      await tx.update(activityRuns).set({
        record: encodeRunRecord(record), nextCursor: row.nextCursor + 1,
        owner: this.owner, leaseUntil: sql`CURRENT_TIMESTAMP + interval '60 seconds'`,
      }).where(eq(activityRuns.runId, runId));
      await tx.insert(activityEvents).values({ runId, cursor: row.nextCursor, body: encodeActivityBody({ kind: 'run', run: record }) });
      await tx.execute(sql`SELECT pg_notify('truecourse_activity', ${JSON.stringify({ repoKey, runId, owner: this.owner })})`);
      return { record, cursor: row.nextCursor };
    });
    this.live.delete(runId);
    const run = this.handle(repoKey, resumed.record);
    this.live.set(runId, run);
    this.announce(repoKey, runId, false);
    publishCommittedActivity(run.dir, { cursor: resumed.cursor, kind: 'run', run: toPublicRunRecord(clone(resumed.record) as Record) });
    return run;
  }

  async open(repoKey: string, command: Command, runId: string): Promise<SessionRunStore> {
    await this.reconcile([repoKey]);
    const [row] = await this.db.select().from(activityRuns).where(and(eq(activityRuns.repoKey, repoKey), eq(activityRuns.command, command), eq(activityRuns.runId, runId)));
    if (!row) throw new SessionRunNotFoundError();
    const live = this.live.get(runId);
    if (live && (row.record.status === 'running' || live.record().status === row.record.status)) { await live.flush?.(); return live; }
    if (live) this.live.delete(runId);
    return this.handle(repoKey, decodeRunRecord(row.record), false);
  }

  async list(repoKey: string, command?: Command): Promise<Record[]> {
    await this.reconcile([repoKey]);
    const rows = await this.db.select().from(activityRuns).where(and(eq(activityRuns.repoKey, repoKey), command ? eq(activityRuns.command, command) : undefined));
    return rows.map(row => decodeRunRecord(row.record)).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  /**
   * Every named repository's runs as one newest-first page: one query over
   * `repo_key`, ordered by the record's `startedAt` with the run id as the
   * tiebreak, and `before` as the keyset cursor of the previous page's last
   * row. Every repository is swept in ONE pass, for the same reason `list`
   * sweeps: a listing must never show a dead run as running. The index re-reads
   * on every job event, so the sweep is one transaction however many
   * repositories a workspace has.
   */
  async listForRepos(repoKeys: string[], opts: SessionRunQuery): Promise<RepoRunRecord[]> {
    if (!repoKeys.length) return [];
    await this.reconcile(repoKeys);
    let before: { startedAt: string; runId: string } | undefined;
    if (opts.before !== undefined) {
      const parsed = parseSessionRunCursor(opts.before);
      if (!parsed) throw new Error('Invalid session run cursor');
      before = parsed;
    }
    const startedAt = sql`${activityRuns.record}->>'startedAt'`;
    const rows = await this.db.select().from(activityRuns).where(and(
      inArray(activityRuns.repoKey, repoKeys),
      opts.command ? eq(activityRuns.command, opts.command) : undefined,
      opts.runId ? eq(activityRuns.runId, opts.runId) : undefined,
      opts.status ? sql`${activityRuns.record}->>'status' = ${opts.status}` : undefined,
      before ? sql`(${startedAt} < ${before.startedAt} OR (${startedAt} = ${before.startedAt} AND ${activityRuns.runId} > ${before.runId}))` : undefined,
    )).orderBy(sql`${startedAt} desc`, asc(activityRuns.runId)).limit(opts.limit);
    return rows.map(row => ({ ...decodeRunRecord(row.record), repoKey: row.repoKey }));
  }

  /**
   * The BOOT SWEEP over every repository at once: a process that died left its
   * runs `running` on a lease nobody renews, and the job rows beside them are
   * settled `interrupted` by the same boot. Called once, before anything reads.
   */
  async reconcileAll(): Promise<void> {
    return this.reconcile(null);
  }

  /** A lease is machine-independent; a reused PID cannot keep a dead run alive.
   *  Every named repository (or every repository, for `null`) is swept in one
   *  transaction; each recovered row publishes and notifies under the repository
   *  that owns it. A run this process is still writing is never swept: its
   *  writer is alive, however late a stalled database made its renewal. */
  private async reconcile(repoKeys: string[] | null): Promise<void> {
    if (repoKeys !== null && !repoKeys.length) return;
    const recovered: { repoKey: string; event: ActivityEvent }[] = [];
    await this.db.transaction(async tx => {
      const writing = [...this.live.keys()];
      const rows = await tx.select().from(activityRuns).where(and(
        repoKeys === null ? undefined : inArray(activityRuns.repoKey, repoKeys),
        sql`${activityRuns.record}->>'status' = 'running'`,
        sql`${activityRuns.leaseUntil} < CURRENT_TIMESTAMP`,
        writing.length ? notInArray(activityRuns.runId, writing) : undefined,
      )).for('update');
      for (const row of rows) {
        const record = decodeRunRecord(row.record);
        record.status = 'interrupted'; record.finishedAt = new Date().toISOString();
        delete record.endpoint; delete record.pid;
        for (const session of record.sessions) if (session.status === 'running' || session.status === 'waiting') session.status = 'parked';
        await tx.update(activityRuns).set({ record: encodeRunRecord(record), owner: null, leaseUntil: null, nextCursor: row.nextCursor + 1 }).where(eq(activityRuns.runId, row.runId));
        await tx.insert(activityEvents).values({ runId: row.runId, cursor: row.nextCursor, body: encodeActivityBody({ kind: 'run', run: record }) });
        await tx.execute(sql`SELECT pg_notify('truecourse_activity', ${JSON.stringify({ repoKey: row.repoKey, runId: row.runId, owner: this.owner })})`);
        recovered.push({ repoKey: row.repoKey, event: { cursor: row.nextCursor, kind: 'run', run: record } });
      }
    });
    for (const { repoKey, event } of recovered) {
      if (event.kind !== 'run') continue;
      publishCommittedActivity(sessionRunDir(repoKey, event.run.command, event.run.runId), event);
      this.announce(repoKey, event.run.runId, false);
    }
  }

  private async validateCursor(runId: string, after: number): Promise<void> {
    if (after >= 0) {
      const [cursor] = await this.db.select({ cursor: activityEvents.cursor }).from(activityEvents).where(and(eq(activityEvents.runId, runId), eq(activityEvents.cursor, after)));
      if (!cursor) throw new Error('Activity cursor is not a record boundary');
    }
  }

  private async readEvents(runId: string, after: number, limit?: number): Promise<ActivityEvent[]> {
    await this.validateCursor(runId, after);
    const query = this.db.select().from(activityEvents).where(and(eq(activityEvents.runId, runId), gt(activityEvents.cursor, after))).orderBy(asc(activityEvents.cursor));
    const rows = await (limit === undefined ? query : query.limit(limit));
    return rows.map(row => decodeActivityEvent(row.body, row.cursor));
  }

  private async readTranscript(runId: string, sessionId: string, since: number): Promise<Event[]> {
    const rows = await this.db.select().from(activityEvents).where(and(
      eq(activityEvents.runId, runId),
      sql`${activityEvents.body}->>'kind' = 'session-event'`,
      sql`${activityEvents.body}->>'sessionId' = ${sessionId}`,
      since >= 0 ? sql`(${activityEvents.body}->'event'->>'seq')::bigint > ${since}` : undefined,
    )).orderBy(asc(activityEvents.cursor));
    return rows.map(row => {
      const entry = decodeActivityEvent(row.body, row.cursor);
      if (entry.kind !== 'session-event') throw new Error('Expected a session transcript event');
      return entry.event;
    });
  }

  private async readTranscriptPage(runId: string, sessionId: string, options: TranscriptPageOptions): Promise<TranscriptPage> {
    const seq = sql`(${activityEvents.body}->'event'->>'seq')::bigint`;
    const rows = await this.db.select().from(activityEvents).where(and(
      eq(activityEvents.runId, runId),
      sql`${activityEvents.body}->>'kind' = 'session-event'`,
      sql`${activityEvents.body}->>'sessionId' = ${sessionId}`,
      options.before === undefined ? undefined : sql`${seq} < ${options.before}`,
      options.since === undefined ? undefined : sql`${seq} > ${options.since}`,
    )).orderBy(options.since === undefined ? desc(activityEvents.cursor) : asc(activityEvents.cursor)).limit(options.limit + 1);
    const events = rows.slice(0, options.limit).map(row => {
      const decoded = decodeActivityEvent(row.body, row.cursor);
      if (decoded.kind !== 'session-event') throw new Error('Expected transcript event');
      return decoded.event;
    });
    return { events: events.sort((a, b) => a.seq - b.seq), hasMore: rows.length > options.limit };
  }

  private async readCompactPage(runId: string, after: number, limit: number): Promise<ActivityPage> {
    await this.validateCursor(runId, after);
    // Select the cursor window first. Only fetch bodies that the conversation
    // uses: thousands of run snapshots can dwarf the entire transcript.
    const result = await this.db.execute(sql`
      WITH page AS MATERIALIZED (
        SELECT cursor, body->>'kind' AS kind FROM ${activityEvents}
        WHERE run_id = ${runId} AND cursor > ${after} ORDER BY cursor LIMIT ${limit}
      )
      SELECT e.cursor, e.body, (SELECT count(*) FROM page) AS page_count
      FROM ${activityEvents} e JOIN page p ON e.cursor = p.cursor
      WHERE e.run_id = ${runId}
        AND (p.kind IS DISTINCT FROM 'run' OR p.cursor = (SELECT max(cursor) FROM page WHERE kind = 'run'))
      ORDER BY e.cursor
    `);
    const rows = result.rows as { cursor: string | number; body: { [key: string]: unknown }; page_count: string | number }[];
    const events = rows.map(row => decodeActivityEvent(row.body, Number(row.cursor)));
    return {
      events,
      nextCursor: events.at(-1)?.cursor ?? after,
      done: Number(rows[0]?.page_count ?? 0) < limit,
    };
  }

  private handle(repoKey: string, record: Record, owned = true): SessionRunStore {
    const dir = sessionRunDir(repoKey, record.command, record.runId);
    const transcripts = new Map<string, Event[]>();
    let pending = Promise.resolve();
    let failure: unknown;
    const failed = new Set<(error: unknown) => void>();
    // The writer stops for good: nothing more is renewed or written, the run is
    // this process's no longer (so a sweep may take it), and whoever owns the
    // work is told once, so it stops rather than running on unrecorded.
    const fail = (error: unknown) => {
      if (failure) return;
      failure = error ?? new Error('Activity writer failed');
      clearInterval(heartbeat);
      this.live.delete(record.runId);
      for (const notify of failed) notify(failure);
    };
    const flush = async () => { await pending; if (failure) throw failure; };
    // A reader waits for the writes ahead of it and reads what was stored. That
    // the writer has failed is the owning job's to hear, never a reader's.
    const drain = () => pending;
    // Only adjacent checklist updates can replace one another. Transcript and
    // lifecycle events are ordering barriers and are always persisted.
    let checklistTail: { value: ActivityEventBody; state?: Record } | undefined;
    const enqueue = (body: ActivityEventBody, snapshot?: Record, coalesce = false) => {
      // These are progress callbacks, called from wherever the work happens to
      // be. A failed writer drops what it is handed: the failure reaches the
      // job through `onFailure` and `flush`, not through whoever reported next.
      if (failure) return;
      const value = clone(body);
      // The live progress this event supersedes goes NOW, in the driver's own
      // order: the commit lands later, after the driver may already have
      // reported what it is waiting on next.
      retireActivityProgress(dir, value);
      const state = snapshot && value.kind === 'run' ? value.run as Record : undefined;
      if (coalesce && checklistTail) {
        checklistTail.value = value;
        checklistTail.state = state;
        return;
      }
      const queued = { value, state };
      checklistTail = coalesce ? queued : undefined;
      pending = pending.then(async () => {
        if (checklistTail === queued) checklistTail = undefined;
        if (failure) return;
        const { value, state } = queued;
        const event = await this.db.transaction(async tx => {
          const [row] = await tx.select().from(activityRuns).where(and(eq(activityRuns.runId, record.runId), eq(activityRuns.repoKey, repoKey))).for('update');
          if (!row) throw new Error('Session run was removed');
          // The fence is the OWNER. A lease that ran out lets another process
          // take the run, and taking it clears or replaces the owner; until one
          // does, a writer that was only late is still the writer.
          if (owned && row.owner !== this.owner) throw new Error('Activity writer lost its lease');
          if (!owned && row.record.status === 'running') throw new Error('Activity writer does not own this run');
          if (row.record.status !== 'running' && state?.status === 'running') throw new Error('Activity run is already terminal');
          await tx.insert(activityEvents).values({ runId: record.runId, cursor: row.nextCursor, body: encodeActivityBody(value) });
          await tx.update(activityRuns).set({
            nextCursor: row.nextCursor + 1,
            ...(state ? { record: encodeRunRecord(state) } : {}),
            ...(state && state.status !== 'running' ? { owner: null, leaseUntil: null } : {}),
          }).where(eq(activityRuns.runId, record.runId));
          await tx.execute(sql`SELECT pg_notify('truecourse_activity', ${JSON.stringify({ repoKey, runId: record.runId, owner: this.owner })})`);
          return { ...value, cursor: row.nextCursor } as ActivityEvent;
        });
        publishCommittedActivity(dir, event);
        this.announce(repoKey, record.runId, false);
        if (value.kind === 'run' && value.run.status !== 'running') { clearInterval(heartbeat); this.live.delete(record.runId); }
      }).catch(fail);
    };
    // Renewed by ownership, like the write guard: a renewal a stalled database
    // delivered late still renews, unless the run was taken in the meantime.
    const heartbeat = setInterval(() => {
      if (!owned || failure) return;
      void this.db.update(activityRuns).set({ leaseUntil: sql`CURRENT_TIMESTAMP + interval '60 seconds'` }).where(and(eq(activityRuns.runId, record.runId), eq(activityRuns.owner, this.owner))).returning({ id: activityRuns.runId }).then(rows => {
        if (!rows.length && record.status === 'running') throw new Error('Activity writer lost its lease');
      }).catch(fail);
    }, 20_000);
    heartbeat.unref();
    if (!owned) clearInterval(heartbeat);
    const write = (coalesce = false) => enqueue({ kind: 'run', run: toPublicRunRecord(record) }, record, coalesce);
    return {
      runId: record.runId, dir, record: () => record, flush,
      onFailure: notify => { failed.add(notify); if (failure) notify(failure); return () => { failed.delete(notify); }; },
      subscribeActivity: notify => this.subscribe(`run:${record.runId}`, notify),
      readActivity: async after => { await drain(); await this.reconcile([repoKey]); return this.readEvents(record.runId, after); },
      readActivityPage: async (after, limit) => { await drain(); await this.reconcile([repoKey]); return this.readEvents(record.runId, after, limit); },
      readCompactActivityPage: async (after, limit) => { await drain(); await this.reconcile([repoKey]); return this.readCompactPage(record.runId, after, limit); },
      validateActivityCursor: async after => { await drain(); await this.validateCursor(record.runId, after); },
      readTranscript: async (sessionId, since) => { await drain(); return this.readTranscript(record.runId, sessionId, since); },
      readTranscriptPage: async (sessionId, options) => { await drain(); return this.readTranscriptPage(record.runId, sessionId, options); },
      setGitRef(gitRef) { record.gitRef = gitRef; write(); },
      setEndpoint(endpoint) { record.endpoint = endpoint; write(); },
      setLlm(llm) { record.llm = llm; write(); },
      setChecklist(items) {
        const blocks = record.display?.blocks ?? [];
        const at = blocks.findIndex(block => block.kind === 'checklist');
        const checklist = { kind: 'checklist' as const, items };
        record.display = { blocks: at < 0 ? [checklist, ...blocks] : blocks.map((block, i) => i === at ? checklist : block) };
        write(true);
      },
      setError(error) { record.error = error; write(); },
      finish(status, options) {
        record.status = status; record.finishedAt = new Date().toISOString(); delete record.endpoint;
        if (options?.error) record.error = options.error;
        // A pause is a stop the run is carried on from, so its live sessions are
        // parked rather than left reading as running — the same word the boot
        // sweep gives the sessions of a run a dead process abandoned.
        if (status === 'paused') {
          for (const session of record.sessions) {
            if (session.status === 'running' || session.status === 'waiting') session.status = 'parked';
          }
        }
        write();
      },
      persistence: {
        flush,
        publishProgress(sessionId, progress) { if (record.status === 'running') publishActivityProgress(dir, sessionId, progress); },
        appendEvent(sessionId, event) {
          const events = transcripts.get(sessionId) ?? []; events.push(clone(event)); transcripts.set(sessionId, events);
          enqueue({ kind: 'session-event', sessionId, event });
        },
        updateIndex(entry) {
          const i = record.sessions.findIndex(s => s.sessionId === entry.sessionId);
          if (i < 0) record.sessions.push(entry); else record.sessions[i] = entry;
          write();
        },
        readEvents: sessionId => {
          if (!owned) throw new Error('Reopened Postgres runs require readStoredTranscript for asynchronous transcript reads');
          return clone(transcripts.get(sessionId) ?? []);
        },
      },
    };
  }
}
