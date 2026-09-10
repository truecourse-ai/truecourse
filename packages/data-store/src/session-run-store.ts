import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { and, asc, eq, gt, inArray, sql, getTableColumns } from 'drizzle-orm';
import { activityRuns, activityEvents, type Db, type Pool, type PoolClient } from '@truecourse/db';
import {
  SessionRunNotFoundError, createSessionRun, listSessionRuns, openSessionRun, parseSessionRunCursor,
  sessionRunDir, toPublicRunRecord,
  type RepoRunRecord, type SessionRunBackend, type SessionRunQuery, type SessionRunStore,
} from '@truecourse/core/lib/sessions-store';
import { publishActivityProgress, publishCommittedActivity, readActivityEvents } from '@truecourse/core/lib/activity-journal';
import { ActivityEventSchema, type ActivityEvent, type ActivityEventBody } from '@truecourse/shared/activity-stream';
import type { SessionRunStore as Store } from '@truecourse/core/lib/sessions-store';

type Record = ReturnType<Store['record']>;
type Command = Record['command'];
type Event = ReturnType<Store['persistence']['readEvents']>[number];
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** JSONB cannot represent NUL or lone UTF-16 surrogates from tool/provider
 * output. Store the transcript as serialized JSON text inside the envelope,
 * keeping only the sequence searchable. Decoding restores the exact event.
 * Existing inline events remain readable without rewriting stored history.
 */
function encodeActivityBody(body: ActivityEventBody): { [key: string]: unknown } {
  if (body.kind === 'run') return body;
  return {
    kind: body.kind, sessionId: body.sessionId, event: { seq: body.event.seq },
    eventEncoding: 'json-v1', eventJson: JSON.stringify(body.event),
  };
}

function decodeActivityEvent(body: { [key: string]: unknown }, cursor: number): ActivityEvent {
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
  private readonly imports = new Map<string, Promise<void>>();
  private readonly watchers = new Map<string, Set<() => void>>();
  private listener: PoolClient | undefined;
  private connecting = false;
  private retry: ReturnType<typeof setTimeout> | undefined;
  constructor(private readonly db: Db, private readonly notificationPool?: Pool) {}

  private async listen(): Promise<void> {
    if (!this.notificationPool || this.listener || this.connecting || !this.watchers.size) return;
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
      if (!this.watchers.size && this.listener === client) { this.listener = undefined; client.release(true); return; }
      // Cover the gap before LISTEN and any connection recovery.
      for (const callbacks of this.watchers.values()) for (const notify of callbacks) notify();
    } catch {
      if (this.listener) { this.listener.release(true); this.listener = undefined; }
      this.scheduleListen();
    } finally { this.connecting = false; }
  }

  private scheduleListen(): void {
    if (this.retry || !this.watchers.size) return;
    this.retry = setTimeout(() => { this.retry = undefined; void this.listen(); }, 1000);
    this.retry.unref();
  }

  private announce(repoKey: string, runId: string, includeRun = true): void {
    for (const key of [`repo:${repoKey}`, ...(includeRun ? [`run:${runId}`] : [])]) for (const notify of this.watchers.get(key) ?? []) notify();
  }

  subscribeRepo(repoKey: string, notify: () => void): () => void { return this.subscribe(`repo:${repoKey}`, notify); }

  private subscribe(runId: string, notify: () => void): () => void {
    let callbacks = this.watchers.get(runId);
    if (!callbacks) { callbacks = new Set(); this.watchers.set(runId, callbacks); }
    callbacks.add(notify); void this.listen();
    return () => {
      callbacks.delete(notify);
      if (!callbacks.size) this.watchers.delete(runId);
      if (!this.watchers.size) {
        if (this.retry) { clearTimeout(this.retry); this.retry = undefined; }
        if (this.listener) { const client = this.listener; this.listener = undefined; client.release(true); }
      }
    };
  }

  private prepare(repoKey: string): Promise<void> {
    let pending = this.imports.get(repoKey);
    if (!pending) {
      pending = this.importLegacy(repoKey).catch(error => { this.imports.delete(repoKey); throw error; });
      this.imports.set(repoKey, pending);
    }
    return pending;
  }

  /** Import old journals without changing their reconnect cursors. Files remain
   * as a backup; conflict-safe inserts make a restart/retry idempotent. */
  private async importLegacy(repoKey: string): Promise<void> {
    const importedIds = new Set((await this.db.select({ id: activityRuns.runId }).from(activityRuns).where(eq(activityRuns.repoKey, repoKey))).map(row => row.id));
    for (const record of listSessionRuns(repoKey)) {
      if (importedIds.has(record.runId)) continue;
      const run = openSessionRun(repoKey, record.command, record.runId);
      const events = readActivityEvents(run.dir);
      let cursor = events.length ? events[events.length - 1]!.cursor + 1 : 0;
      const seen = new Set(events.filter(e => e.kind === 'session-event').map(e => `${e.sessionId}:${e.event.seq}`));
      for (const file of fs.readdirSync(run.dir)) {
        if (!file.endsWith('.jsonl') || file === 'activity.jsonl') continue;
        const sessionId = file.slice(0, -6);
        for (const event of run.persistence.readEvents(sessionId)) {
          if (!seen.has(`${sessionId}:${event.seq}`)) events.push({ cursor: cursor++, kind: 'session-event', sessionId, event });
        }
      }
      const imported = { ...toPublicRunRecord(record), activityStream: 'ai-sdk-v1' as const };
      events.push({ cursor: cursor++, kind: 'run', run: imported });
      await this.db.transaction(async tx => {
        const inserted = await tx.insert(activityRuns).values({
          runId: record.runId, repoKey, command: record.command, record: imported, nextCursor: cursor,
          leaseUntil: record.status === 'running' ? new Date().toISOString() : null,
        }).onConflictDoNothing().returning({ id: activityRuns.runId });
        if (!inserted.length) return;
        // Bounded inserts avoid PostgreSQL's parameter limit on long histories.
        for (let i = 0; i < events.length; i += 200) {
          await tx.insert(activityEvents).values(events.slice(i, i + 200).map(({ cursor, ...body }) => ({ runId: record.runId, cursor, body: encodeActivityBody(body) })));
        }
      });
    }
  }

  async create(repoKey: string, opts: Parameters<typeof createSessionRun>[1]): Promise<SessionRunStore> {
    await this.prepare(repoKey);
    await this.reconcile([repoKey]);
    const record: Record = {
      command: opts.command, runId: randomUUID(), gitRef: opts.gitRef,
      startedAt: (opts.now?.() ?? new Date()).toISOString(), status: 'running', sessions: [], activityStream: 'ai-sdk-v1',
    };
    await this.db.transaction(async tx => {
      await tx.insert(activityRuns).values({
        runId: record.runId, repoKey, command: record.command, record, nextCursor: 1,
        owner: this.owner, leaseUntil: sql`CURRENT_TIMESTAMP + interval '60 seconds'`,
      });
      await tx.insert(activityEvents).values({ runId: record.runId, cursor: 0, body: { kind: 'run', run: record } });
      await tx.execute(sql`SELECT pg_notify('truecourse_activity', ${JSON.stringify({ repoKey, runId: record.runId, owner: this.owner })})`);
    });
    const run = this.handle(repoKey, record);
    this.live.set(record.runId, run);
    this.announce(repoKey, record.runId, false);
    publishCommittedActivity(run.dir, { cursor: 0, kind: 'run', run: clone(record) });
    return run;
  }

  async open(repoKey: string, command: Command, runId: string): Promise<SessionRunStore> {
    await this.prepare(repoKey);
    await this.reconcile([repoKey]);
    const [row] = await this.db.select().from(activityRuns).where(and(eq(activityRuns.repoKey, repoKey), eq(activityRuns.command, command), eq(activityRuns.runId, runId)));
    if (!row) throw new SessionRunNotFoundError();
    const live = this.live.get(runId);
    if (live && (row.record.status === 'running' || live.record().status === row.record.status)) { await live.flush?.(); return live; }
    if (live) this.live.delete(runId);
    return this.handle(repoKey, clone(row.record) as Record, false);
  }

  async list(repoKey: string, command?: Command): Promise<Record[]> {
    await this.prepare(repoKey);
    await this.reconcile([repoKey]);
    const rows = await this.db.select().from(activityRuns).where(and(eq(activityRuns.repoKey, repoKey), command ? eq(activityRuns.command, command) : undefined));
    return rows.map(row => clone(row.record) as Record).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  /**
   * Every named repository's runs as one newest-first page: one query over
   * `repo_key`, ordered by the record's `startedAt` with the run id as the
   * tiebreak, and `before` as the keyset cursor of the previous page's last
   * row. Every repository is prepared (memoized per repository) and then swept
   * in ONE pass, for the same reason `list` sweeps: a listing must never show a
   * dead run as running. The index re-reads on every job event, so the sweep is
   * one transaction however many repositories a workspace has.
   */
  async listForRepos(repoKeys: string[], opts: SessionRunQuery): Promise<RepoRunRecord[]> {
    if (!repoKeys.length) return [];
    for (const repoKey of repoKeys) await this.prepare(repoKey);
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
    return rows.map(row => ({ ...(clone(row.record) as Record), repoKey: row.repoKey }));
  }

  /** A lease is machine-independent; a reused PID cannot keep a dead run alive.
   *  Every named repository is swept in one transaction; each recovered row
   *  publishes and notifies under the repository that owns it. */
  private async reconcile(repoKeys: string[]): Promise<void> {
    if (!repoKeys.length) return;
    const recovered: { repoKey: string; event: ActivityEvent }[] = [];
    await this.db.transaction(async tx => {
      const rows = await tx.select().from(activityRuns).where(and(
        inArray(activityRuns.repoKey, repoKeys), sql`${activityRuns.record}->>'status' = 'running'`,
        sql`${activityRuns.leaseUntil} < CURRENT_TIMESTAMP`,
      )).for('update');
      for (const row of rows) {
        const record = clone(row.record) as Record;
        record.status = 'interrupted'; record.finishedAt = new Date().toISOString();
        delete record.endpoint; delete record.pid;
        for (const session of record.sessions) if (session.status === 'running' || session.status === 'waiting') session.status = 'parked';
        await tx.update(activityRuns).set({ record, owner: null, leaseUntil: null, nextCursor: row.nextCursor + 1 }).where(eq(activityRuns.runId, row.runId));
        await tx.insert(activityEvents).values({ runId: row.runId, cursor: row.nextCursor, body: { kind: 'run', run: record } });
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

  private handle(repoKey: string, record: Record, owned = true): SessionRunStore {
    const dir = sessionRunDir(repoKey, record.command, record.runId);
    const transcripts = new Map<string, Event[]>();
    let pending = Promise.resolve();
    let failure: unknown;
    const flush = async () => { await pending; if (failure) throw failure; };
    const enqueue = (body: ActivityEventBody, snapshot?: Record) => {
      if (failure) throw failure;
      const value = clone(body);
      const state = snapshot ? clone(toPublicRunRecord(snapshot)) : undefined;
      pending = pending.then(async () => {
        if (failure) return;
        const event = await this.db.transaction(async tx => {
          const [row] = await tx.select({ ...getTableColumns(activityRuns), leaseActive: sql<boolean>`${activityRuns.leaseUntil} > CURRENT_TIMESTAMP` }).from(activityRuns).where(and(eq(activityRuns.runId, record.runId), eq(activityRuns.repoKey, repoKey))).for('update');
          if (!row) throw new Error('Session run was removed');
          if (owned && (row.owner !== this.owner || !row.leaseActive)) throw new Error('Activity writer lost its lease');
          if (!owned && row.record.status === 'running') throw new Error('Activity writer does not own this run');
          if (row.record.status !== 'running' && state?.status === 'running') throw new Error('Activity run is already terminal');
          await tx.insert(activityEvents).values({ runId: record.runId, cursor: row.nextCursor, body: encodeActivityBody(value) });
          await tx.update(activityRuns).set({
            nextCursor: row.nextCursor + 1,
            ...(state ? { record: state } : {}),
            ...(state && state.status !== 'running' ? { owner: null, leaseUntil: null } : {}),
          }).where(eq(activityRuns.runId, record.runId));
          await tx.execute(sql`SELECT pg_notify('truecourse_activity', ${JSON.stringify({ repoKey, runId: record.runId, owner: this.owner })})`);
          return { ...value, cursor: row.nextCursor } as ActivityEvent;
        });
        publishCommittedActivity(dir, event);
        this.announce(repoKey, record.runId, false);
        if (value.kind === 'run' && value.run.status !== 'running') { clearInterval(heartbeat); this.live.delete(record.runId); }
      }).catch(error => { failure = error; clearInterval(heartbeat); this.live.delete(record.runId); });
    };
    const heartbeat = setInterval(() => {
      if (!owned || failure) return;
      void this.db.update(activityRuns).set({ leaseUntil: sql`CURRENT_TIMESTAMP + interval '60 seconds'` }).where(and(eq(activityRuns.runId, record.runId), eq(activityRuns.owner, this.owner), sql`${activityRuns.leaseUntil} > CURRENT_TIMESTAMP`)).returning({ id: activityRuns.runId }).then(rows => {
        if (!rows.length && record.status === 'running') throw new Error('Activity writer lost its lease');
      }).catch(error => { failure = error; clearInterval(heartbeat); });
    }, 20_000);
    heartbeat.unref();
    if (!owned) clearInterval(heartbeat);
    const write = () => enqueue({ kind: 'run', run: toPublicRunRecord(record) }, record);
    return {
      runId: record.runId, dir, record: () => record, flush,
      subscribeActivity: notify => this.subscribe(`run:${record.runId}`, notify),
      readActivity: async after => { await flush(); await this.reconcile([repoKey]); return this.readEvents(record.runId, after); },
      readActivityPage: async (after, limit) => { await flush(); await this.reconcile([repoKey]); return this.readEvents(record.runId, after, limit); },
      validateActivityCursor: async after => { await flush(); await this.validateCursor(record.runId, after); },
      readTranscript: async (sessionId, since) => { await flush(); return this.readTranscript(record.runId, sessionId, since); },
      setGitRef(gitRef) { record.gitRef = gitRef; write(); },
      setEndpoint(endpoint) { record.endpoint = endpoint; write(); },
      setLlm(llm) { record.llm = llm; write(); },
      setChecklist(items) {
        const blocks = record.display?.blocks ?? [];
        const at = blocks.findIndex(block => block.kind === 'checklist');
        const checklist = { kind: 'checklist' as const, items };
        record.display = { blocks: at < 0 ? [checklist, ...blocks] : blocks.map((block, i) => i === at ? checklist : block) };
        write();
      },
      setError(error) { record.error = error; write(); },
      finish(status, options) {
        record.status = status; record.finishedAt = new Date().toISOString(); delete record.endpoint;
        if (options?.error) record.error = options.error;
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
