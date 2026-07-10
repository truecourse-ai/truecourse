/**
 * The `guard.gate` enqueue surface: the per-repo+headSha single-flight key,
 * the step-checklist constants the job popup renders, and `enqueueGuardGate`
 * on the JobsApi (job row + graphile enqueue + dedupe → null). The worker
 * runner + event hub are mocked — graphile-worker cannot run over PGlite — so
 * this exercises the real wiring around them.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type EeDb } from '@truecourse/ee-db';
import type { EeServerRegistry } from '@truecourse/shared';
import { setBackgroundTaskRunner } from '@truecourse/core/lib/background-tasks';
import { JobStore, ActiveJobExistsError } from '../../ee/packages/data-store/src/index';

// Both collaborators need a live Postgres — mock them (hoisted before the module
// under test loads). `startWorker` resolves to a fake runner whose `addJob` we
// observe; one test flips it to reject to simulate a failed boot.
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
  GUARD_GATE_TASK,
  GUARD_GATE_TITLE,
  GUARD_GATE_STEPS,
  guardGateJobKey,
  type GuardGateEnqueueRequest,
} from '../../ee/packages/server/src/jobs/constants';

const ORG = 'org_A';
const REPO = 'acme/api';
const HEAD_SHA = 'headsha1234567890';

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
  // `stop` must return a promise — the SIGTERM handler calls `.stop().catch()`.
  startWorkerMock.mockResolvedValue({ addJob: addJobMock, stop: async () => {} });
});

afterEach(async () => {
  setBackgroundTaskRunner(null);
  await client.close();
});

const opts = () => ({
  db,
  connectionString: 'postgres://unused',
  masterSecret: 'master-secret-at-least-32-characters!!',
});

const enqueueReq: GuardGateEnqueueRequest = {
  repoFullName: REPO,
  installationId: 42,
  workspaceOrgId: ORG,
  prNumber: 7,
  defaultBranch: 'main',
  baseBranch: 'main',
  baseSha: 'basesha0987654321',
  headSha: HEAD_SHA,
  headRef: 'feature/timeouts',
  isFork: false,
  checkRunId: 9001,
};

describe('guard.gate constants', () => {
  it('guardGateJobKey is per repo AND head SHA', () => {
    expect(guardGateJobKey(REPO, HEAD_SHA)).toBe('guard.gate:acme/api#headsha1234567890');
  });

  it('title + stepped checklist match the gate flow phases', () => {
    expect(GUARD_GATE_TASK).toBe('guard.gate');
    expect(GUARD_GATE_TITLE).toBe('Guarding pull request');
    expect(GUARD_GATE_STEPS).toEqual([
      { key: 'clone', label: 'Cloning repository' },
      { key: 'base', label: 'Establishing baseline' },
      { key: 'run', label: 'Running scenarios' },
      { key: 'verdict', label: 'Posting Check' },
    ]);
  });
});

describe('guard.gate — enqueue single-flight (per repo + head SHA)', () => {
  it('creates a queued row, dedupes the same head, frees the key on terminal', async () => {
    const store = new JobStore(db);
    const key = guardGateJobKey(REPO, HEAD_SHA);

    const first = await store.create({ org: ORG, type: GUARD_GATE_TASK, key });
    expect(first.status).toBe('queued');
    expect(first.key).toBe('guard.gate:acme/api#headsha1234567890');

    await expect(store.create({ org: ORG, type: GUARD_GATE_TASK, key })).rejects.toBeInstanceOf(
      ActiveJobExistsError,
    );

    // A new push (different head SHA) is independent.
    const other = await store.create({
      org: ORG,
      type: GUARD_GATE_TASK,
      key: guardGateJobKey(REPO, 'otherhead111'),
    });
    expect(other.id).not.toBe(first.id);

    await store.markSucceeded(first.id, {});
    const rerun = await store.create({ org: ORG, type: GUARD_GATE_TASK, key });
    expect(rerun.status).toBe('queued');
  });
});

describe('registerJobs — enqueueGuardGate', () => {
  it('creates the single-flight job row, enqueues on the runner, and dedupes', async () => {
    const jobs = await registerJobs(registry, opts());
    expect(jobs.workerStarted).toBe(true);

    const jobId = await jobs.enqueueGuardGate(enqueueReq);
    expect(jobId).not.toBeNull();

    const row = await new JobStore(db).get(jobId!);
    expect(row).toMatchObject({
      workspaceOrgId: ORG,
      type: GUARD_GATE_TASK,
      key: guardGateJobKey(REPO, HEAD_SHA),
      status: 'queued',
    });
    expect(addJobMock).toHaveBeenCalledWith(
      GUARD_GATE_TASK,
      { jobId, ...enqueueReq },
      { jobKey: guardGateJobKey(REPO, HEAD_SHA), maxAttempts: 1 },
    );

    // The enqueue request is persisted on the row: boot recovery needs it to
    // settle a reaped gate's stranded PR Check (see orphans.ts).
    const [raw] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId!));
    expect(raw?.payload).toEqual(enqueueReq);

    // Redelivered webhook for the same head → null, no second graphile enqueue.
    expect(await jobs.enqueueGuardGate(enqueueReq)).toBeNull();
    expect(addJobMock).toHaveBeenCalledTimes(1);

    // A new push moves the head SHA → a fresh job.
    const nextId = await jobs.enqueueGuardGate({ ...enqueueReq, headSha: 'otherhead111' });
    expect(nextId).not.toBeNull();
    expect(nextId).not.toBe(jobId);
    expect(addJobMock).toHaveBeenCalledTimes(2);
  });

  it('throws on enqueue when the worker failed to boot', async () => {
    startWorkerMock.mockRejectedValue(new Error('pg down'));
    const jobs = await registerJobs(registry, opts());

    expect(jobs.workerStarted).toBe(false);
    await expect(jobs.enqueueGuardGate(enqueueReq)).rejects.toThrow(
      'the background job worker is not running',
    );
  });
});
