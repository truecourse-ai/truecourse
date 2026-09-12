import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type Db } from '@truecourse/db';
import { JobStore, NotificationStore } from '@truecourse/data-store';
import { localJobActivity, registerJob, type JobDefinition, type JobRuntime, createJobs } from '@truecourse/jobs';
import type { Runner } from 'graphile-worker';
import { createApp } from '../../apps/dashboard/server/src/app';
import {
  createOperations,
  holdRequestWork,
  startOperationsServer,
} from '../../apps/dashboard/server/src/operations';

const idleStats = () => Promise.resolve({ queued: 0, running: 0, failedLast15Minutes: 0, oldestActiveAgeSeconds: 0 });
const idleLocal = () => ({ count: 0, version: 0 });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

it('authenticates health and every control operation on a separate loopback listener', async () => {
  const ops = createOperations({ stats: idleStats, workerRunning: () => true, localJobs: idleLocal, release: 'sha256:release' });
  const server = await startOperationsServer(ops, { port: 0, token: 'a'.repeat(64) });
  const auth = `Bearer ${'a'.repeat(64)}`;
  try {
    expect(server.address()).toMatchObject({ address: '127.0.0.1' });
    await request(server).get('/health').expect(401);
    await request(server).post('/drain').set('Authorization', 'Bearer wrong').expect(401);
    expect((await ops.health()).draining).toBe(false);
    await request(server).post('/drain').set('Authorization', auth).expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ healthy: true, draining: true, drained: true, release: 'sha256:release' }));
    await request(server).post('/resume').expect(401);
    expect((await ops.health()).draining).toBe(true);
    await request(server).post('/resume').set('Authorization', auth).expect(200);
    await request(server).get('/health').set('Authorization', auth).expect(200)
      .expect(({ body }) => expect(body.status).toBe('ok'));
    await request(server).get('/drain').set('Authorization', auth).expect(404);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
});

it('pauses API producers including webhooks and GET callbacks, and waits for an admitted producer', async () => {
  const ops = createOperations({ stats: idleStats, workerRunning: () => true, localJobs: idleLocal });
  const started = deferred<void>();
  const finish = deferred<void>();
  const app = express();
  app.use('/api', ops.admission);
  app.post('/api/jobs', async (_req, res) => { started.resolve(); await finish.promise; res.json({ queued: true }); });
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/events', (_req, res) => res.json({ events: [] }));
  app.get('/api/auth/callback', (_req, res) => res.json({ login: true }));
  app.post('/api/github/webhook', (_req, res) => res.json({ accepted: true }));
  const accepted = request(app).post('/api/jobs').then((res) => res);
  await started.promise;
  ops.drain();
  expect(await ops.health()).toMatchObject({ activeRequests: 1, drained: false });
  await request(app).post('/api/jobs').expect(503);
  await request(app).post('/api/github/webhook').expect(503);
  await request(app).get('/api/auth/callback').expect(503);
  await request(app).get('/api/health').expect(200);
  await request(app).get('/api/events').expect(200);
  finish.resolve();
  expect((await accepted).status).toBe(200);
  expect(await ops.health()).toMatchObject({ activeRequests: 0, drained: true });
  ops.resume();
  await request(app).post('/api/jobs').expect(200);
});

it('keeps an accepted analysis active after its HTTP 202 until its explicit lease finishes', async () => {
  const ops = createOperations({ stats: idleStats, workerRunning: () => true, localJobs: idleLocal });
  let finish!: () => void;
  const app = express();
  app.use('/api', ops.admission);
  app.post('/api/analyses', (_req, res) => {
    finish = holdRequestWork(res);
    res.status(202).json({ accepted: true });
  });
  await request(app).post('/api/analyses').expect(202);
  ops.drain();
  expect(await ops.health()).toMatchObject({ drained: false, activeRequests: 1 });
  finish();
  finish();
  expect(await ops.health()).toMatchObject({ drained: true, activeRequests: 0 });
});

it('does not confuse a public SPA or liveness response with release readiness', async () => {
  let worker = false;
  const ops = createOperations({ stats: idleStats, workerRunning: () => worker, localJobs: idleLocal, release: 'sha256:approved' });
  const app = createApp({ authVerifier: null, github: null, jobs: null, serveStatic: false, operations: ops });
  await request(app).get('/api/health').expect(503);
  worker = true;
  await request(app).get('/api/health').expect(200).expect(({ body }) => {
    expect(body).toMatchObject({ status: 'ok', release: 'sha256:approved' });
    expect(body).not.toHaveProperty('queued');
  });
  await request(app).post('/drain').expect(404);
  await request(app).post('/api/drain').expect(404);
  expect((await ops.health()).draining).toBe(false);
  ops.drain();
  await request(app).get('/api/health').expect(503);
  expect((await ops.health()).healthy).toBe(true);
});

it('requires another poll when an admitted producer finishes during the database snapshot', async () => {
  const snapshot = deferred<Awaited<ReturnType<typeof idleStats>>>();
  let queried = false;
  const ops = createOperations({
    stats: () => { queried = true; return snapshot.promise; },
    workerRunning: () => true,
    localJobs: idleLocal,
  });
  const started = deferred<void>();
  const finish = deferred<void>();
  const app = express();
  app.use('/api', ops.admission);
  app.post('/api/jobs', async (_req, res) => { started.resolve(); await finish.promise; res.end(); });
  const accepted = request(app).post('/api/jobs').then((res) => res);
  await started.promise;
  ops.drain();
  const health = ops.health();
  await Promise.resolve();
  expect(queried).toBe(true);
  finish.resolve();
  await accepted;
  snapshot.resolve(await idleStats());
  expect(await health).toMatchObject({ healthy: true, activeRequests: 0, drained: false });
  expect(await ops.health()).toMatchObject({ drained: true });
});

it('reports failed database or stopped workers as unhealthy and never safe to stop', async () => {
  let database = true;
  let worker = true;
  const ops = createOperations({
    stats: () => database ? idleStats() : Promise.reject(new Error('secret postgres://must-not-leak')),
    workerRunning: () => worker,
    localJobs: idleLocal,
    startDrained: true,
  });
  expect(await ops.health()).toMatchObject({ healthy: true, draining: true, drained: true });
  worker = false;
  expect(await ops.health()).toMatchObject({ healthy: false, workerRunning: false, drained: false });
  worker = true;
  database = false;
  const health = await ops.health();
  expect(health).toMatchObject({ healthy: false, database: 'unreachable', queued: null, drained: false });
  expect(JSON.stringify(health)).not.toContain('must-not-leak');
});

it('bounds database-health latency and shares a hung query across repeated checks', async () => {
  let queries = 0;
  const query = deferred<Awaited<ReturnType<typeof idleStats>>>();
  const ops = createOperations({
    stats: () => { queries += 1; return query.promise; },
    workerRunning: () => true,
    localJobs: idleLocal,
    healthTimeoutMs: 10,
  });
  expect((await ops.health()).healthy).toBe(false);
  expect((await ops.health()).healthy).toBe(false);
  expect(queries).toBe(1);
  query.resolve(await idleStats());
  expect((await ops.health()).healthy).toBe(true);
});

it('requires another poll when a job finishes and enqueues its successor during the SQL snapshot', async () => {
  let activity = { count: 0, version: 0 };
  const ops = createOperations({
    stats: async () => { activity = { count: 0, version: activity.version + 2 }; return idleStats(); },
    workerRunning: () => true,
    localJobs: () => activity,
    startDrained: true,
  });
  expect(await ops.health()).toMatchObject({ healthy: true, queued: 0, running: 0, localJobs: 0, drained: false });
});

describe('operations with the actual job store and worker envelope', () => {
  let client: PGlite;
  let db: Db;
  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client, { schema }) as unknown as Db;
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  });
  afterAll(async () => { await client.close(); });

  it('counts recent failures and waits for terminal-job followups without cancelling them', async () => {
    const store = new JobStore(db);
    const old = await store.create({ org: 'ops', type: 'failed' });
    await store.markFailed(old.id, 'test failure');
    const rt: JobRuntime = { db, jobStore: store, notifications: new NotificationStore(db), publish: async () => {} };
    const row = await store.create({ org: 'ops', type: 'scan' });
    const settling = deferred<void>();
    const continueChain = deferred<void>();
    let successorId = '';
    const def: JobDefinition = {
      type: 'scan', title: 'Scan', steps: [], org: () => 'ops',
      run: async () => ({ notification: null }),
      onError: () => ({ level: 'error', title: 'failed', body: '' }),
      onSettled: async () => {
        settling.resolve();
        await continueChain.promise;
        successorId = (await store.create({ org: 'ops', type: 'generate' })).id;
      },
    };
    const ops = createOperations({ stats: () => store.operationalStats(), workerRunning: () => true, localJobs: localJobActivity });
    const execution = registerJob(rt, def)({ jobId: row.id }, {});
    await settling.promise;
    ops.drain();
    expect((await store.get(row.id))?.status).toBe('succeeded');
    expect(await ops.health()).toMatchObject({ queued: 0, running: 0, failedLast15Minutes: 1, localJobs: 1, drained: false });
    continueChain.resolve();
    await execution;
    await Promise.resolve();
    expect(await ops.health()).toMatchObject({ queued: 1, running: 0, localJobs: 0, drained: false });
    await store.markRunning(successorId);
    await store.markSucceeded(successorId, {});
    expect(await ops.health()).toMatchObject({ queued: 0, running: 0, drained: true });
  });

  it('withdraws worker readiness when Graphile exits after a successful startup', async () => {
    const lifetime = deferred<void>();
    const runner = createJobs({
      db, connectionString: 'postgres://unused', tasks: [],
      hub: { start: async () => {}, stop: async () => {}, subscribe: () => () => {} },
      startWorker: async () => ({ promise: lifetime.promise, stop: async () => {} }) as unknown as Runner,
    });
    await runner.start();
    expect(runner.workerStarted).toBe(true);
    lifetime.reject(new Error('worker pool failed'));
    await Promise.resolve();
    expect(runner.workerStarted).toBe(false);
    await expect(runner.singleFlightEnqueue('scan', 'ops', 'key', {})).rejects.toThrow('not running');
    await runner.stop();
  });
});
