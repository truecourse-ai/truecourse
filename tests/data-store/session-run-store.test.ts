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
import { createSessionRun, readStoredActivityPage, readStoredTranscript, sessionRunCursor, validateStoredActivityCursor, setSessionRunBackend, setSessionsRootResolver, resetSessionsRootResolver, type SessionRunStore } from '@truecourse/core/lib/sessions-store';
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
  const arbitraryText = 'before\u0000after \\u0000 lone \ud800 emoji 🎉';

  it.each([false, true])('imports transcripts losslessly, with activity journal=%s', async activityStream => {
    const old = createSessionRun(REPO, { command: 'guard-generate', gitRef: 'abc', activityStream });
    const transcript = { ...event(), content: arbitraryText };
    old.persistence.appendEvent('s', transcript);
    old.finish('completed');
    const originalFile = fs.readFileSync(path.join(old.dir, 's.jsonl'), 'utf8');
    const journal = readActivityEvents(old.dir);
    const imported = await store.open(REPO, 'guard-generate', old.runId);
    expect(await readStoredTranscript(imported, 's')).toEqual([transcript]);
    const replay = await imported.readActivity!(-1);
    expect(replay.find(e => e.kind === 'session-event')).toMatchObject({ event: transcript });
    if (activityStream) expect(replay.slice(0, journal.length)).toEqual(journal);
    expect(await imported.readActivity!(replay[0].cursor)).toEqual(replay.slice(1));
    expect(fs.readFileSync(path.join(old.dir, 's.jsonl'), 'utf8')).toBe(originalFile);
    const reopened = await new PgSessionRunStore(db).open(REPO, 'guard-generate', old.runId);
    expect(await reopened.readActivity!(-1)).toEqual(replay);
  });

  it('round-trips arbitrary transcript text alongside existing inline events', async () => {
    const run = await create();
    const inline = { ...event(), content: 'existing inline event' };
    await db.insert(activityEvents).values({ runId: run.runId, cursor: 1, body: { kind: 'session-event', sessionId: 's', event: inline } });
    await db.update(activityRuns).set({ nextCursor: 2 }).where(eq(activityRuns.runId, run.runId));
    const transcript = { ...event(1), content: arbitraryText };
    run.persistence.appendEvent('s', transcript);
    run.finish('completed');
    await run.flush!();
    const reopened = await new PgSessionRunStore(db).open(REPO, 'spec-scan', run.runId);
    expect(await readStoredTranscript(reopened, 's')).toEqual([inline, transcript]);
    expect(await readStoredTranscript(reopened, 's', 0)).toEqual([transcript]);
    expect(await readStoredTranscript(reopened, 'other')).toEqual([]);
    const reader = createActivityStream(reopened, -1, new AbortController().signal).getReader();
    const events = [];
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      if (next.value.type === 'data-activity') events.push(next.value.data);
    }
    expect(events).toContainEqual(expect.objectContaining({ kind: 'session-event', event: transcript }));
    expect((await db.select().from(activityEvents).where(eq(activityEvents.cursor, 1)))[0].body).toEqual({ kind: 'session-event', sessionId: 's', event: inline });
  });

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


describe('workspace listing and journal pages', () => {
  const at = (seconds: number) => () => new Date(Date.UTC(2026, 0, 1, 0, 0, seconds));
  const createAt = async (repoKey: string, command: 'spec-scan' | 'guard-setup' | 'guard-generate', seconds: number) => {
    const run = await store.create(repoKey, { command, gitRef: 'abc', activityStream: true, now: at(seconds) });
    live.push(run); return run;
  };

  it('lists every named repository newest first, narrowed, and paged by cursor', async () => {
    const keys = ['acme/one', 'acme/two'];
    const setup = await createAt('acme/one', 'guard-setup', 1);
    const generate = await createAt('acme/two', 'guard-generate', 2);
    const scan = await createAt('acme/one', 'spec-scan', 3);
    scan.finish('completed'); await scan.flush!();
    await createAt('acme/three', 'spec-scan', 4);

    const all = await store.listForRepos(keys, { limit: 10 });
    expect(all.map(r => [r.runId, r.repoKey])).toEqual([
      [scan.runId, 'acme/one'], [generate.runId, 'acme/two'], [setup.runId, 'acme/one'],
    ]);
    expect(await store.listForRepos([], { limit: 10 })).toEqual([]);
    expect((await store.listForRepos(['acme/one'], { limit: 10 })).map(r => r.runId)).toEqual([scan.runId, setup.runId]);
    expect((await store.listForRepos(keys, { limit: 10, command: 'guard-setup' })).map(r => r.runId)).toEqual([setup.runId]);
    expect((await store.listForRepos(keys, { limit: 10, status: 'completed' })).map(r => r.runId)).toEqual([scan.runId]);
    expect((await store.listForRepos(keys, { limit: 10, runId: generate.runId })).map(r => r.repoKey)).toEqual(['acme/two']);
    expect(await store.listForRepos(keys, { limit: 10, runId: 'no-such-run' })).toEqual([]);

    const page = await store.listForRepos(keys, { limit: 2 });
    expect(page.map(r => r.runId)).toEqual([scan.runId, generate.runId]);
    const rest = await store.listForRepos(keys, { limit: 2, before: sessionRunCursor(page[1]!) });
    expect(rest.map(r => r.runId)).toEqual([setup.runId]);
    expect(await store.listForRepos(keys, { limit: 2, before: sessionRunCursor(rest[0]!) })).toEqual([]);
    await expect(store.listForRepos(keys, { limit: 2, before: 'not-a-cursor' })).rejects.toThrow('cursor');
  });

  it('breaks a start-time tie by run id, in the order the cursor pages', async () => {
    const first = await createAt('acme/one', 'spec-scan', 5);
    const second = await createAt('acme/two', 'spec-scan', 5);
    const [earlier, later] = [first.runId, second.runId].sort();
    const keys = ['acme/one', 'acme/two'];
    expect((await store.listForRepos(keys, { limit: 10 })).map(r => r.runId)).toEqual([earlier, later]);
    const page = await store.listForRepos(keys, { limit: 1 });
    expect((await store.listForRepos(keys, { limit: 10, before: sessionRunCursor(page[0]!) })).map(r => r.runId)).toEqual([later]);
  });

  it('recovers a dead run in every repository in one sweep', async () => {
    const one = await createAt('acme/one', 'guard-setup', 1);
    const two = await createAt('acme/two', 'spec-scan', 2);
    for (const run of [one, two]) {
      run.persistence.updateIndex({ sessionId: 's', kind: 'test', workItem: 'doc', status: 'running', spent: { turns: 0, tokens: 0, costUsd: 0 } });
      await run.flush!();
    }
    await db.update(activityRuns).set({ leaseUntil: '2000-01-01T00:00:00Z' });

    queries.length = 0;
    const listed = await new PgSessionRunStore(db).listForRepos(['acme/one', 'acme/two'], { limit: 10 });
    expect(listed.map(r => [r.repoKey, r.status, r.sessions[0]!.status])).toEqual([
      ['acme/two', 'interrupted', 'parked'],
      ['acme/one', 'interrupted', 'parked'],
    ]);
    expect(queries.filter(q => /for update/i.test(q.query))).toHaveLength(1);
  });

  it('reads the journal in bounded pages that stop at the end', async () => {
    const run = await createAt('acme/one', 'spec-scan', 1);
    for (let seq = 0; seq < 4; seq++) run.persistence.appendEvent('s', event(seq));
    run.finish('completed');
    await run.flush!();
    const whole = await run.readActivity!(-1);
    expect(whole.map(e => e.cursor)).toEqual([0, 1, 2, 3, 4, 5]);

    queries.length = 0;
    const first = await readStoredActivityPage(run, -1, 4);
    expect(first).toEqual({ events: whole.slice(0, 4), nextCursor: 3, done: false });
    expect(queries.some(q => q.query.includes('"activity_events"') && q.query.includes('limit'))).toBe(true);

    const second = await readStoredActivityPage(run, first.nextCursor, 4);
    expect(second).toEqual({ events: whole.slice(4), nextCursor: 5, done: true });
    expect(await readStoredActivityPage(run, second.nextCursor, 4)).toEqual({ events: [], nextCursor: 5, done: true });
    await expect(readStoredActivityPage(run, 900, 4)).rejects.toThrow('boundary');
  });
});
