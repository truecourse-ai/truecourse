/**
 * registerJobs — the guard-generate surface: the single-flight
 * `enqueueGuardGenerate`, the honest `workerStarted` flag (the `guard`
 * capability gates on it), and the baseline→guard onboarding chain wired onto
 * the worker's `onBaselineSettled` (success-only, skipped once guard state
 * exists). The worker runner + event hub are mocked — graphile-worker cannot run
 * over PGlite — so this exercises the real wiring around them.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type EeDb } from '@truecourse/ee-db';
import type { EeServerRegistry } from '@truecourse/shared';
import { setBackgroundTaskRunner } from '@truecourse/core/lib/background-tasks';
import {
  setGuardStore,
  resetGuardStore,
  writeGuardResult,
} from '@truecourse/core/lib/guard-store';
import type { GuardGenerateReport } from '@truecourse/shared';
import { JobStore, PgGuardStore } from '../../ee/packages/data-store/src/index';

// Both collaborators need a live Postgres — mock them (hoisted before the module
// under test loads). `startWorker` resolves to a fake runner whose `addJob` we
// observe; individual tests flip it to reject to simulate a failed boot.
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
  REPO_GUARD_TASK,
  GUARD_BASELINE_TASK,
  guardJobKey,
  guardBaselineJobKey,
} from '../../ee/packages/server/src/jobs/constants';
import type { StartWorkerDeps } from '../../ee/packages/server/src/jobs/worker';

const ORG = 'org_A';
const REPO = 'acme/api';

const registry: EeServerRegistry = {
  registerRouter() {},
  setAuthVerifier() {},
};

let client: PGlite;
let db: EeDb;

function makeReport(): GuardGenerateReport {
  return {
    generatedAt: '2026-07-09T00:00:00.000Z',
    status: 'ok',
    sectionsTotal: 1,
    sectionsChanged: 1,
    skippedUnchanged: 0,
    noChanges: false,
    written: [],
    coverageGaps: [],
    birthFindings: [],
    errors: [],
    extractionFailures: [],
    orphaned: [],
  };
}

beforeEach(async () => {
  client = new PGlite();
  db = drizzle(client, { schema }) as unknown as EeDb;
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  setGuardStore(new PgGuardStore(db));
  startWorkerMock.mockReset();
  addJobMock.mockReset();
  // `stop` must return a promise — the SIGTERM handler calls `.stop().catch()`.
  startWorkerMock.mockResolvedValue({ addJob: addJobMock, stop: async () => {} });
});

// Track every registerJobs handle so afterEach can join the fire-and-forget
// boot backfill before closing PGlite (an in-flight query racing close() traps).
const handles: Array<Awaited<ReturnType<typeof registerJobs>>> = [];

afterEach(async () => {
  setBackgroundTaskRunner(null);
  await Promise.allSettled(handles.splice(0).map((h) => h.backfillSettled));
  resetGuardStore();
  await client.close();
});

const opts = () => ({
  db,
  connectionString: 'postgres://unused',
  masterSecret: 'master-secret-at-least-32-characters!!',
});

/** registerJobs + track the handle for the afterEach backfill join. */
const reg = async () => {
  const j = await registerJobs(registry, opts());
  handles.push(j);
  return j;
};

const enqueueReq = {
  repoFullName: REPO,
  installationId: 42,
  defaultBranch: 'main',
  commitSha: 'abc1234567',
  workspaceOrgId: ORG,
};

const baselinePayload = { ...enqueueReq, jobId: 'job_b1' };

describe('registerJobs — enqueueGuardGenerate', () => {
  it('creates the single-flight job row, enqueues on the runner, and dedupes', async () => {
    const jobs = await reg();
    expect(jobs.workerStarted).toBe(true);

    const jobId = await jobs.enqueueGuardGenerate(enqueueReq);
    expect(jobId).not.toBeNull();

    const row = await new JobStore(db).get(jobId!);
    expect(row).toMatchObject({ type: REPO_GUARD_TASK, key: guardJobKey(REPO), status: 'queued' });
    expect(addJobMock).toHaveBeenCalledWith(
      REPO_GUARD_TASK,
      { jobId, ...enqueueReq },
      { jobKey: guardJobKey(REPO), maxAttempts: 1 },
    );

    // Already running → null, no second graphile enqueue.
    expect(await jobs.enqueueGuardGenerate(enqueueReq)).toBeNull();
    expect(addJobMock).toHaveBeenCalledTimes(1);
  });

  it('reports workerStarted=false and throws on enqueue when the worker failed to boot', async () => {
    startWorkerMock.mockRejectedValue(new Error('pg down'));
    const jobs = await reg();

    expect(jobs.workerStarted).toBe(false);
    await expect(jobs.enqueueGuardGenerate(enqueueReq)).rejects.toThrow(
      'the background job worker is not running',
    );
  });
});

describe('registerJobs — baseline→guard onboarding chain', () => {
  async function settledHook(): Promise<NonNullable<StartWorkerDeps['onBaselineSettled']>> {
    await reg();
    const deps = startWorkerMock.mock.calls[0]![0] as StartWorkerDeps;
    expect(deps.onBaselineSettled).toBeDefined();
    return deps.onBaselineSettled!;
  }

  it('a successful baseline enqueues ONE guard generate with the baseline payload', async () => {
    const onBaselineSettled = await settledHook();

    await onBaselineSettled(baselinePayload, 'succeeded');

    expect(addJobMock).toHaveBeenCalledTimes(1);
    const [task, payload, opts_] = addJobMock.mock.calls[0]!;
    expect(task).toBe(REPO_GUARD_TASK);
    expect(payload).toMatchObject(enqueueReq);
    expect(opts_).toEqual({ jobKey: guardJobKey(REPO), maxAttempts: 1 });
  });

  it('a failed baseline never chains', async () => {
    const onBaselineSettled = await settledHook();
    await onBaselineSettled(baselinePayload, 'failed');
    expect(addJobMock).not.toHaveBeenCalled();
  });

  it('a repo with stored guard state refreshes its baseline instead of onboarding (issue 06)', async () => {
    // Guard state exists → onboarding is skipped, but the complementary
    // baseline-refresh chain fires: re-run the committed corpus against current main.
    await writeGuardResult({ repoKey: REPO, commitSha: 'earlier00' }, makeReport());
    const onBaselineSettled = await settledHook();

    await onBaselineSettled(baselinePayload, 'succeeded');

    expect(addJobMock).toHaveBeenCalledTimes(1);
    const [task, payload, opts_] = addJobMock.mock.calls[0]!;
    expect(task).toBe(GUARD_BASELINE_TASK);
    expect(payload).toMatchObject(enqueueReq);
    expect(opts_).toEqual({ jobKey: guardBaselineJobKey(REPO), maxAttempts: 1 });
  });
});

describe('registerJobs — generate→baseline chain', () => {
  async function generateSettledHook(): Promise<NonNullable<StartWorkerDeps['onGuardGenerateSettled']>> {
    await reg();
    const deps = startWorkerMock.mock.calls[0]![0] as StartWorkerDeps;
    expect(deps.onGuardGenerateSettled).toBeDefined();
    return deps.onGuardGenerateSettled!;
  }

  it('a successful generate (scenarios now stored) chains a guard-baseline refresh', async () => {
    await writeGuardResult({ repoKey: REPO, commitSha: 'abc1234567' }, makeReport());
    const onGuardGenerateSettled = await generateSettledHook();

    await onGuardGenerateSettled(baselinePayload, 'succeeded');

    expect(addJobMock).toHaveBeenCalledTimes(1);
    const [task, payload] = addJobMock.mock.calls[0]!;
    expect(task).toBe(GUARD_BASELINE_TASK);
    expect(payload).toMatchObject(enqueueReq);
  });

  it('a no-corpus generate (no scenarios stored) chains nothing', async () => {
    // No writeGuardResult → hasGuardState is false → the refresh chain no-ops.
    const onGuardGenerateSettled = await generateSettledHook();
    await onGuardGenerateSettled(baselinePayload, 'succeeded');
    expect(addJobMock).not.toHaveBeenCalled();
  });

  it('a BLOCKED generate (open-conflicts report stored) chains NO baseline run', async () => {
    // The blocked generate persisted an open-conflicts report, so hasGuardState is
    // true and the refresh chain WOULD otherwise fire. The settle result's
    // openConflicts count suppresses it — no run row (the "Runs populated,
    // Scenarios empty" bug).
    await writeGuardResult({ repoKey: REPO, commitSha: 'abc1234567' }, makeReport());
    const onGuardGenerateSettled = await generateSettledHook();

    await onGuardGenerateSettled(baselinePayload, 'succeeded', {
      repoFullName: REPO,
      scenariosWritten: 0,
      openConflicts: 2,
    });

    expect(addJobMock).not.toHaveBeenCalled();
  });

  it('passes the guard-baseline settle hook to the worker', async () => {
    await reg();
    const deps = startWorkerMock.mock.calls[0]![0] as StartWorkerDeps;
    expect(deps.onGuardBaselineSettled).toBeDefined();
  });
});
