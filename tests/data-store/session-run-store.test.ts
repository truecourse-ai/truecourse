import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq, sql } from 'drizzle-orm';
import { schema, activityRuns, activityEvents, MIGRATIONS_DIR, type Db, type Pool } from '@truecourse/db';
import { PgSessionRunStore } from '../../packages/data-store/src/session-run-store';
import { purgeRepoData } from '../../packages/data-store/src/repo-purge';
import { createSessionRun, readStoredTranscript, validateStoredActivityCursor, setSessionRunBackend, setSessionsRootResolver, resetSessionsRootResolver, type SessionRunStore } from '@truecourse/core/lib/sessions-store';
import { subscribeActivity, readActivityEvents } from '@truecourse/core/lib/activity-journal';
import { acquireRunsWatch, releaseRunsWatch } from '../../apps/dashboard/server/src/services/session-tailer.service';
import { createActivityStream } from '../../apps/dashboard/server/src/services/activity-stream.service';

const REPO = 'acme/widget';
let client: PGlite;
let db: Db;
let store: PgSessionRunStore;
let root: string;
const queries: Array<{ query: string; params: unknown[] }> = [];
const live: SessionRunStore[] = [];
const event = (seq = 0) => ({ type: 'user-message' as const, seq, ts: new Date().toISOString(), content: `message ${seq}` });

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-pg-activity-'));
  setSessionsRootResolver(key => path.join(root, encodeURIComponent(key)));
  client = new PGlite();
  const d = drizzle(client, { schema, logger: { logQuery(query, params) { queries.push({ query, params }); } } });
  await migrate(d, { migrationsFolder: MIGRATIONS_DIR });
  db = d as unknown as Db;
  store = new PgSessionRunStore(db);
});
afterEach(async () => {
  for (const run of live.splice(0)) {
    try { run.finish('interrupted'); await run.flush?.(); } catch { /* failed writer already stopped */ }
  }
  await client.close();
  setSessionRunBackend(undefined);
  resetSessionsRootResolver();
  fs.rmSync(root, { recursive: true, force: true });
});
async function create(command: 'spec-scan' | 'guard-setup' | 'guard-generate' | 'guard-interfaces' = 'spec-scan') {
  const run = await store.create(REPO, { command, gitRef: 'abc', activityStream: true });
  live.push(run); return run;
}

describe('Postgres activity storage', () => {
  it.each([false, true])('opens metadata without history and scopes replay/transcripts, completed=%s', async completed => {
    const run = await create();
    run.persistence.appendEvent('other', event(0));
    run.persistence.appendEvent('target', event(0));
    run.persistence.appendEvent('target', event(1));
    if (completed) run.finish('completed');
    await run.flush!();
    const other = new PgSessionRunStore(db);
    queries.length = 0;
    const reopened = await other.open(REPO, 'spec-scan', run.runId);
    expect(queries.filter(q => q.query.includes('"activity_events"'))).toEqual([]);

    queries.length = 0;
    await validateStoredActivityCursor(reopened, 2);
    const validation = queries.filter(q => q.query.includes('"activity_events"'));
    expect(validation).toHaveLength(1);
    expect(validation[0].query).not.toContain('"body"');
    await expect(validateStoredActivityCursor(reopened, 9999)).rejects.toThrow('boundary');

    queries.length = 0;
    const replay = await reopened.readActivity!(2);
    expect(replay.map(e => e.cursor)).toEqual(completed ? [3, 4] : [3]);
    const historyQuery = queries.find(q => q.query.includes('"body"'))!;
    expect(historyQuery.query).toContain('"activity_events"."cursor" >');
    expect(historyQuery.params).toContain(2);

    queries.length = 0;
    expect(await readStoredTranscript(reopened, 'target', 0)).toEqual(run.persistence.readEvents('target').filter(e => e.seq > 0));
    const transcriptQueries = queries.filter(q => q.query.includes('"activity_events"'));
    expect(transcriptQueries).toHaveLength(1);
    expect(transcriptQueries[0].query).toContain("->>'sessionId'");
    expect(transcriptQueries[0].query).toContain("->>'seq'");
    expect(transcriptQueries[0].params).toEqual([run.runId, 'target', 0]);
    expect(await readStoredTranscript(reopened, 'missing')).toEqual([]);

    // A remote handle must read fresh data on each transcript request.
    if (!completed) {
      run.persistence.appendEvent('target', event(2));
      await run.flush!();
      expect((await readStoredTranscript(reopened, 'target', 1)).map(e => e.seq)).toEqual([2]);
    }
  });

  it.each(['spec-scan', 'guard-setup', 'guard-generate', 'guard-interfaces'] as const)('stores %s history without creating files and reopens on another server', async command => {
    const run = await create(command);
    run.setEndpoint({ url: 'http://runner', token: 'never-persist-this' });
    run.persistence.appendEvent('s1', event());
    run.persistence.updateIndex({ sessionId: 's1', kind: 'test', workItem: 'doc', status: 'completed', spent: { turns: 1, tokens: 2, costUsd: 0 } });
    run.finish('completed'); await run.flush!();
    expect(fs.existsSync(run.dir)).toBe(false);
    const reopened = await new PgSessionRunStore(db).open(REPO, command, run.runId);
    expect(await readStoredTranscript(reopened, 's1')).toEqual(run.persistence.readEvents('s1'));
    const history = await reopened.readActivity!(-1);
    expect(history.map(e => e.cursor)).toEqual([0, 1, 2, 3, 4]);
    expect(JSON.stringify(await db.select().from(activityRuns))).not.toContain('never-persist-this');
    expect(JSON.stringify(history)).not.toContain('never-persist-this');
    expect(reopened.record().status).toBe('completed');
    const reader = createActivityStream(reopened, -1, new AbortController().signal).getReader();
    const chunks = [];
    for (;;) { const next = await reader.read(); if (next.done) break; chunks.push(next.value); }
    expect(chunks.at(-1)).toMatchObject({ type: 'finish' });
  });

  it('publishes only committed immutable snapshots and resumes strictly after a cursor', async () => {
    const run = await create();
    const observations: Promise<void>[] = [];
    const unsubscribe = subscribeActivity(run.dir, e => {
      if (!e) return;
      observations.push((async () => {
        const rows = await db.select().from(activityEvents).where(eq(activityEvents.runId, run.runId));
        expect(rows.some(row => row.cursor === e.cursor)).toBe(true);
      })());
    });
    run.setChecklist([{ key: 'a', label: 'Read documents', status: 'active' }]);
    run.setChecklist([{ key: 'a', label: 'Read documents', status: 'done' }]);
    await run.flush!(); await Promise.all(observations); unsubscribe();
    const events = await run.readActivity!(-1);
    expect(events[1]).toMatchObject({ kind: 'run', run: { display: { blocks: [{ items: [{ status: 'active' }] }] } } });
    expect(await run.readActivity!(1)).toEqual(events.slice(2));
    await expect(run.readActivity!(900)).rejects.toThrow('boundary');
  });

  it('rolls back the snapshot and cursor together on write failure and rejects flush', async () => {
    const run = await create();
    await db.execute(sql`ALTER TABLE activity_events ADD CONSTRAINT reject_test CHECK (cursor = 0)`);
    let published = 0;
    const unsubscribe = subscribeActivity(run.dir, e => { if (e) published++; });
    run.setError({ message: 'cannot commit' });
    await expect(run.flush!()).rejects.toThrow();
    unsubscribe();
    expect(published).toBe(0);
    const [row] = await db.select().from(activityRuns);
    expect(row!.nextCursor).toBe(1);
    expect(row!.record.error).toBeUndefined();
  });

  it('isolates repo/command reads and cascades history when disconnecting a repository', async () => {
    const run = await create();
    run.finish('completed'); await run.flush!();
    await expect(store.open('other/repo', 'spec-scan', run.runId)).rejects.toThrow('not found');
    await expect(store.open(REPO, 'guard-setup', run.runId)).rejects.toThrow('not found');
    expect(await store.list('other/repo')).toEqual([]);
    await purgeRepoData(db, REPO);
    expect(await db.select().from(activityEvents)).toEqual([]);
  });

  it('interrupts expired owners, parks questions, and fences a late writer', async () => {
    const run = await create();
    run.persistence.updateIndex({ sessionId: 's', kind: 'test', workItem: 'doc', status: 'waiting', spent: { turns: 0, tokens: 0, costUsd: 0 } });
    await run.flush!();
    await db.update(activityRuns).set({ leaseUntil: '2000-01-01T00:00:00Z' }).where(eq(activityRuns.runId, run.runId));
    const other = new PgSessionRunStore(db);
    expect((await other.list(REPO))[0]).toMatchObject({ status: 'interrupted', sessions: [{ status: 'parked' }] });
    run.setChecklist([]);
    await expect(run.flush!()).rejects.toThrow('lost its lease');
  });

  it('imports old file history once with the original replay cursors and missing transcript events', async () => {
    const old = createSessionRun(REPO, { command: 'guard-setup', gitRef: 'abc', activityStream: true });
    old.persistence.appendEvent('s', event());
    old.finish('completed');
    const original = readActivityEvents(old.dir);
    fs.appendFileSync(path.join(old.dir, 's.jsonl'), JSON.stringify(event(1)) + '\n');
    const imported = await store.open(REPO, 'guard-setup', old.runId);
    const events = await imported.readActivity!(-1);
    expect(events.slice(0, original.length)).toEqual(original);
    expect((await readStoredTranscript(imported, 's')).map(e => e.seq)).toEqual([0, 1]);
    const again = await new PgSessionRunStore(db).open(REPO, 'guard-setup', old.runId);
    expect(await again.readActivity!(-1)).toEqual(events);
    expect(fs.existsSync(path.join(old.dir, 'run.json'))).toBe(true);
  });
});


it('notifies another server of new runs through PostgreSQL LISTEN/NOTIFY', async () => {
  // Exercise real database notifications; only the pg socket is represented
  // by PGlite's in-process listener because this test starts no server.
  const connection = new EventEmitter();
  let unlisten: (() => Promise<void>) | undefined;
  let ready!: () => void;
  const listening = new Promise<void>(resolve => { ready = resolve; });
  const pool = { connect: async () => Object.assign(connection, {
    query: async () => {
      unlisten = await client.listen('truecourse_activity', payload => connection.emit('notification', { channel: 'truecourse_activity', payload }));
      ready();
    },
    release: () => { void unlisten?.(); },
  }) } as unknown as Pool;
  const other = new PgSessionRunStore(db, pool);
  let notifications = 0;
  const stop = other.subscribeRepo(REPO, () => { notifications++; });
  await listening;
  await Promise.resolve();
  notifications = 0;
  const run = await create();
  expect(notifications).toBeGreaterThan(0);
  expect((await other.list(REPO))[0]!.runId).toBe(run.runId);
  stop();
  await unlisten?.();
});


it('updates the existing run-list watch without creating a file watcher or directory', async () => {
  setSessionRunBackend(store);
  const changed = new Promise<void>(resolve => acquireRunsWatch(REPO, resolve));
  try {
    const run = await create();
    await changed;
    expect(fs.existsSync(run.dir)).toBe(false);
    expect((await store.list(REPO)).map(r => r.runId)).toEqual([run.runId]);
  } finally { releaseRunsWatch(REPO); }
});
