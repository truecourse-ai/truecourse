/**
 * The `guard.baseline` enqueue surface (issue 06): the per-repo single-flight
 * key + step constants, the pending-buffer coalescing (a refresh that loses the
 * single-flight race is recorded and replayed at the newest commit, never
 * dropped), and `enqueueGuardBaseline` on the JobsApi (job row + graphile enqueue
 * + coalesce → null). The worker runner + event hub are mocked — graphile-worker
 * cannot run over PGlite — so this exercises the real wiring around them.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type EeDb } from '@truecourse/ee-db';
import type { EeServerRegistry } from '@truecourse/shared';
import { setBackgroundTaskRunner } from '@truecourse/core/lib/background-tasks';
// Import from the BUILT package (not src): the coalescing code does an
// `instanceof ActiveJobExistsError` against this package's export, so the
// JobStore that throws it must be the same module instance (see pending-baseline).
import { JobStore, PendingGuardBaselineStore } from '@truecourse/ee-data-store';

const startWorkerMock = vi.hoisted(() => vi.fn());
const addJobMock = vi.hoisted(() => vi.fn());
vi.mock('../../ee/packages/server/src/jobs/worker', () => ({
  startWorker: startWorkerMock,
}));
vi.mock('../../ee/packages/server/src/jobs/events', () => ({
  EventHub: class {
    async start() {}
    async stop() {}
  },
  publishEvent: async () => {},
}));

import { registerJobs } from '../../ee/packages/server/src/jobs/index';
import {
  enqueueOrPendGuardBaseline,
  replayPendingGuardBaseline,
  drainPendingGuardBaselines,
} from '../../ee/packages/server/src/jobs/pending-guard-baseline';
import {
  GUARD_BASELINE_TASK,
  GUARD_BASELINE_TITLE,
  GUARD_BASELINE_STEPS,
  guardBaselineJobKey,
  type GuardBaselineEnqueueRequest,
  type GuardBaselineJobPayload,
} from '../../ee/packages/server/src/jobs/constants';

const ORG = 'org_A';
const REPO = 'acme/api';

const registry: EeServerRegistry = {
  registerRouter() {},
  setAuthVerifier() {},
};

let client: PGlite;
let db: EeDb;

beforeEach(async () => {
  client = new PGlite();
  db = drizzle(client, { schema }) as unknown as EeDb;
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  startWorkerMock.mockReset();
  addJobMock.mockReset();
  startWorkerMock.mockResolvedValue({ addJob: addJobMock, stop: async () => {} });
});

// Track registerJobs handles so afterEach joins the fire-and-forget boot backfill
// before closing PGlite (an in-flight query racing close() traps the WASM runtime).
const handles: Array<Awaited<ReturnType<typeof registerJobs>>> = [];

afterEach(async () => {
  setBackgroundTaskRunner(null);
  await Promise.allSettled(handles.splice(0).map((h) => h.backfillSettled));
  await client.close();
});

const opts = () => ({
  db,
  connectionString: 'postgres://unused',
  masterSecret: 'master-secret-at-least-32-characters!!',
});

const reg = async () => {
  const j = await registerJobs(registry, opts());
  handles.push(j);
  return j;
};

const req = (commitSha: string, over: Partial<GuardBaselineEnqueueRequest> = {}): GuardBaselineEnqueueRequest => ({
  repoFullName: REPO,
  installationId: 42,
  defaultBranch: 'main',
  commitSha,
  workspaceOrgId: ORG,
  ...over,
});

const payloadFor = (jobId: string, commitSha: string): GuardBaselineJobPayload => ({ jobId, ...req(commitSha) });

describe('guard.baseline constants', () => {
  it('guardBaselineJobKey is per repo', () => {
    expect(guardBaselineJobKey(REPO)).toBe('guard.baseline:acme/api');
  });

  it('title + stepped checklist match the refresh phases', () => {
    expect(GUARD_BASELINE_TASK).toBe('guard.baseline');
    expect(GUARD_BASELINE_TITLE).toBe('Refreshing guard baseline');
    expect(GUARD_BASELINE_STEPS).toEqual([
      { key: 'clone', label: 'Cloning repository' },
      { key: 'run', label: 'Running scenarios' },
      { key: 'persist', label: 'Saving baseline' },
    ]);
  });
});

describe('enqueueOrPendGuardBaseline — coalesce on single-flight loss', () => {
  it('enqueues normally when no refresh is in flight', async () => {
    const jobStore = new JobStore(db);
    const pending = new PendingGuardBaselineStore(db);
    const addJob = vi.fn(async () => {});

    const id = await enqueueOrPendGuardBaseline(
      { jobStore, pendingGuardBaselines: pending, addJob },
      req('c1'),
    );

    expect(id).toBeTruthy();
    expect(addJob).toHaveBeenCalledWith(id, expect.objectContaining({ commitSha: 'c1' }), guardBaselineJobKey(REPO));
    expect(await pending.take(REPO)).toBeNull();
  });

  it('records the newest pending follow-up when a refresh already holds the key', async () => {
    const jobStore = new JobStore(db);
    const pending = new PendingGuardBaselineStore(db);
    const addJob = vi.fn(async () => {});
    const deps = { jobStore, pendingGuardBaselines: pending, addJob };

    // A refresh already holds the repo's single-flight key.
    await jobStore.create({ org: ORG, type: GUARD_BASELINE_TASK, key: guardBaselineJobKey(REPO) });

    expect(await enqueueOrPendGuardBaseline(deps, req('c1'))).toBeNull();
    expect(await enqueueOrPendGuardBaseline(deps, req('c2'))).toBeNull();
    expect(addJob).not.toHaveBeenCalled();

    const row = await pending.take(REPO);
    expect(row).toMatchObject({ repoFullName: REPO, commitSha: 'c2', workspaceOrgId: ORG });
  });
});

const okSettle = { outcome: 'succeeded', status: 'ok' } as const;

describe('replayPendingGuardBaseline — replay when the running refresh settles', () => {
  it('replays the pending follow-up at a NEW commit and clears it (even after a verdict)', async () => {
    const pending = new PendingGuardBaselineStore(db);
    await pending.upsert(req('c2'));
    const enqueue = vi.fn(async () => 'follow-up');

    await replayPendingGuardBaseline(pending, enqueue, payloadFor('j', 'c1'), okSettle);

    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ commitSha: 'c2', repoFullName: REPO }));
    expect(await pending.take(REPO)).toBeNull();
  });

  it('drops a redundant same-commit pending when the run settled with a verdict (ok)', async () => {
    const pending = new PendingGuardBaselineStore(db);
    await pending.upsert(req('c1'));
    const enqueue = vi.fn(async () => 'x');

    await replayPendingGuardBaseline(pending, enqueue, payloadFor('j', 'c1'), okSettle);

    expect(enqueue).not.toHaveBeenCalled();
    expect(await pending.take(REPO)).toBeNull();
  });

  it('drops a redundant same-commit pending on no-corpus too (a genuine nothing-to-run)', async () => {
    const pending = new PendingGuardBaselineStore(db);
    await pending.upsert(req('c1'));
    const enqueue = vi.fn(async () => 'x');

    await replayPendingGuardBaseline(pending, enqueue, payloadFor('j', 'c1'), {
      outcome: 'succeeded',
      status: 'no-corpus',
    });

    expect(enqueue).not.toHaveBeenCalled();
  });

  it('REPLAYS a same-commit pending after a no-verdict run (transient build error self-heals)', async () => {
    const pending = new PendingGuardBaselineStore(db);
    await pending.upsert(req('c1'));
    const enqueue = vi.fn(async () => 'retry');

    await replayPendingGuardBaseline(pending, enqueue, payloadFor('j', 'c1'), {
      outcome: 'succeeded',
      status: 'no-verdict',
    });

    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ commitSha: 'c1' }));
    expect(await pending.take(REPO)).toBeNull();
  });

  it('REPLAYS a same-commit pending after a failed/thrown run (no verdict produced)', async () => {
    const pending = new PendingGuardBaselineStore(db);
    await pending.upsert(req('c1'));
    const enqueue = vi.fn(async () => 'retry');

    await replayPendingGuardBaseline(pending, enqueue, payloadFor('j', 'c1'), {
      outcome: 'failed',
      status: null,
    });

    expect(enqueue).toHaveBeenCalledTimes(1);
  });
});

describe('drainPendingGuardBaselines — boot recovery', () => {
  it('enqueues every pending row and clears them', async () => {
    const pending = new PendingGuardBaselineStore(db);
    await pending.upsert(req('c1'));
    await pending.upsert(req('c9', { repoFullName: 'acme/web' }));
    const enqueue = vi.fn(async () => 'x');

    expect(await drainPendingGuardBaselines(pending, enqueue)).toBe(2);
    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(await pending.take(REPO)).toBeNull();
    expect(await pending.take('acme/web')).toBeNull();
  });
});

describe('registerJobs — enqueueGuardBaseline', () => {
  it('creates the single-flight job row, enqueues on the runner, and coalesces a concurrent refresh', async () => {
    const jobs = await reg();
    expect(jobs.workerStarted).toBe(true);

    const jobId = await jobs.enqueueGuardBaseline(req('c1'));
    expect(jobId).not.toBeNull();

    const row = await new JobStore(db).get(jobId!);
    expect(row).toMatchObject({
      workspaceOrgId: ORG,
      type: GUARD_BASELINE_TASK,
      key: guardBaselineJobKey(REPO),
      status: 'queued',
    });
    expect(addJobMock).toHaveBeenCalledWith(
      GUARD_BASELINE_TASK,
      { jobId, ...req('c1') },
      { jobKey: guardBaselineJobKey(REPO), maxAttempts: 1 },
    );

    // A concurrent refresh (job still active) coalesces → null, no second enqueue,
    // and the newer commit lands on the pending row.
    expect(await jobs.enqueueGuardBaseline(req('c2'))).toBeNull();
    expect(addJobMock).toHaveBeenCalledTimes(1);
    const [pendRow] = await db
      .select()
      .from(schema.pendingGuardBaselines)
      .where(eq(schema.pendingGuardBaselines.repoFullName, REPO));
    expect(pendRow?.commitSha).toBe('c2');
  });

  it('throws on enqueue when the worker failed to boot', async () => {
    startWorkerMock.mockRejectedValue(new Error('pg down'));
    const jobs = await reg();

    expect(jobs.workerStarted).toBe(false);
    // Mirrors enqueueBaseline: a synchronous throw when the worker never booted.
    expect(() => jobs.enqueueGuardBaseline(req('c1'))).toThrow(
      'the background job worker is not running',
    );
  });
});
