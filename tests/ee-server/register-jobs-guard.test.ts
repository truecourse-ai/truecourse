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
import { schema, MIGRATIONS_DIR, type Db } from '@truecourse/db';
import type { EeServerRegistry } from '@truecourse/shared';
import { setBackgroundTaskRunner } from '@truecourse/core/lib/background-tasks';
import { setRepoLifecycleEmitter } from '@truecourse/core/lib/repo-lifecycle';
import {
  setGuardStore,
  resetGuardStore,
  writeGuardResult,
} from '@truecourse/core/lib/guard-store';
import type { GuardGenerateReport } from '@truecourse/shared';
import { JobStore, PgGuardStore } from '../../ee/packages/data-store/src/index';

// Both collaborators need a live Postgres — mock them (hoisted before the module
// under test loads). `startEeWorker` resolves to a fake runner whose `addJob` we
// observe; individual tests flip it to reject to simulate a failed boot.
const startWorkerMock = vi.hoisted(() => vi.fn());
const addJobMock = vi.hoisted(() => vi.fn());
vi.mock('../../ee/packages/server/src/jobs/worker', () => ({
  startEeWorker: startWorkerMock,
  captureJobException: () => {},
}));
vi.mock('../../ee/packages/server/src/jobs/events', () => ({
  EventHub: class {
    async start() {}
    async stop() {}
    subscribe() {
      return () => {};
    }
  },
  publishEvent: async () => {},
}));

import { selectGateStore } from '@truecourse/ee-github-app';
import { registerJobs } from '../../ee/packages/server/src/jobs/index';
import {
  REPO_GUARD_TASK,
  GUARD_BASELINE_TASK,
  guardJobKey,
  guardBaselineJobKey,
} from '../../ee/packages/server/src/jobs/constants';
import type { StartEeWorkerDeps } from '../../ee/packages/server/src/jobs/worker';

const ORG = 'org_A';
const REPO = 'acme/api';

const registry: EeServerRegistry = {
  registerRouter() {},
  setAuthVerifier() {},
};

let client: PGlite;
let db: Db;

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
  db = drizzle(client, { schema }) as unknown as Db;
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

/** Record the repo's scanned default-branch baseline (gh_baselines) at `commitSha`
 *  — the anchor `hasGuardState` reads the repo's generate report at. */
const seedGhBaseline = (commitSha: string) =>
  selectGateStore(db).saveBaseline({
    repoFullName: REPO,
    commitSha,
    capturedAt: '2026-07-09T00:00:00.000Z',
  });

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
  async function settledHook(): Promise<NonNullable<StartEeWorkerDeps['onBaselineSettled']>> {
    await reg();
    const deps = startWorkerMock.mock.calls[0]![0] as StartEeWorkerDeps;
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
    // Guard state exists AT THE REPO BASELINE → onboarding is skipped, but the
    // complementary baseline-refresh chain fires: re-run the committed corpus
    // against current main.
    await seedGhBaseline('earlier00');
    await writeGuardResult({ repoKey: REPO, commitSha: 'earlier00' }, makeReport());
    const onBaselineSettled = await settledHook();

    await onBaselineSettled(baselinePayload, 'succeeded');

    expect(addJobMock).toHaveBeenCalledTimes(1);
    const [task, payload, opts_] = addJobMock.mock.calls[0]!;
    expect(task).toBe(GUARD_BASELINE_TASK);
    expect(payload).toMatchObject(enqueueReq);
    expect(opts_).toEqual({ jobKey: guardBaselineJobKey(REPO), maxAttempts: 1 });
  });

  it("a PR head's regenerated report never fakes repo guard state — onboarding still fires", async () => {
    // The repo's baseline commit has NO stored report; a PR regen persisted one at
    // its head (the newest row by createdAt). Reading "newest" would skip
    // onboarding forever — the chain must anchor at the gh_baselines commit.
    await seedGhBaseline('abc1234567');
    await writeGuardResult({ repoKey: REPO, commitSha: 'prheadsha99' }, makeReport());
    const onBaselineSettled = await settledHook();

    await onBaselineSettled(baselinePayload, 'succeeded');

    expect(addJobMock).toHaveBeenCalledTimes(1);
    expect(addJobMock.mock.calls[0]![0]).toBe(REPO_GUARD_TASK);
  });

  it('with no resolvable baseline, a stored report reads as NO guard state (never "newest")', async () => {
    // No gh_baselines row at all: nothing anchors the repo's guard state, so a
    // stray stored report (e.g. a PR head's) must read as absent → onboarding.
    await writeGuardResult({ repoKey: REPO, commitSha: 'strayhead00' }, makeReport());
    const onBaselineSettled = await settledHook();

    await onBaselineSettled(baselinePayload, 'succeeded');

    expect(addJobMock).toHaveBeenCalledTimes(1);
    expect(addJobMock.mock.calls[0]![0]).toBe(REPO_GUARD_TASK);
  });
});

describe('registerJobs — generate→baseline chain', () => {
  async function generateSettledHook(): Promise<NonNullable<StartEeWorkerDeps['onGuardGenerateSettled']>> {
    await reg();
    const deps = startWorkerMock.mock.calls[0]![0] as StartEeWorkerDeps;
    expect(deps.onGuardGenerateSettled).toBeDefined();
    return deps.onGuardGenerateSettled!;
  }

  it('a successful generate (scenarios now stored) chains a guard-baseline refresh', async () => {
    await seedGhBaseline('abc1234567');
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
    const deps = startWorkerMock.mock.calls[0]![0] as StartEeWorkerDeps;
    expect(deps.onGuardBaselineSettled).toBeDefined();
  });
});

describe('registerJobs — repo-lifecycle refresh events', () => {
  // The settle hooks announce completions through the core repo-lifecycle seam so
  // the dashboard server can push `spec:complete` into the repo's socket room —
  // an open Spec/Scenarios/Runs tab refreshes live when a background job lands.
  const lifecycle = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    lifecycle.mockClear();
    setRepoLifecycleEmitter(lifecycle);
  });
  afterEach(() => setRepoLifecycleEmitter(null));

  async function workerDeps(): Promise<StartEeWorkerDeps> {
    await reg();
    return startWorkerMock.mock.calls[0]![0] as StartEeWorkerDeps;
  }

  it('a successful baseline announces scan for the repo', async () => {
    const deps = await workerDeps();
    await deps.onBaselineSettled!(baselinePayload, 'succeeded');
    expect(lifecycle).toHaveBeenCalledWith(REPO, 'scan');
  });

  it('a failed baseline announces nothing', async () => {
    const deps = await workerDeps();
    await deps.onBaselineSettled!(baselinePayload, 'failed');
    expect(lifecycle).not.toHaveBeenCalled();
  });

  it('a successful generate announces guard-generate', async () => {
    const deps = await workerDeps();
    await deps.onGuardGenerateSettled!(baselinePayload, 'succeeded');
    expect(lifecycle).toHaveBeenCalledWith(REPO, 'guard-generate');
  });

  it('a BLOCKED generate still announces guard-generate (the report flipped to open-conflicts)', async () => {
    const deps = await workerDeps();
    await deps.onGuardGenerateSettled!(baselinePayload, 'succeeded', {
      repoFullName: REPO,
      scenariosWritten: 0,
      openConflicts: 2,
    });
    expect(lifecycle).toHaveBeenCalledWith(REPO, 'guard-generate');
  });

  it('a failed generate announces nothing', async () => {
    const deps = await workerDeps();
    await deps.onGuardGenerateSettled!(baselinePayload, 'failed');
    expect(lifecycle).not.toHaveBeenCalled();
  });

  it('a successful guard-baseline run announces guard-run', async () => {
    const deps = await workerDeps();
    await deps.onGuardBaselineSettled!(baselinePayload, { outcome: 'succeeded', status: 'ok' });
    expect(lifecycle).toHaveBeenCalledWith(REPO, 'guard-run');
  });

  it('a failed guard-baseline run announces nothing', async () => {
    const deps = await workerDeps();
    await deps.onGuardBaselineSettled!(baselinePayload, { outcome: 'failed', status: null });
    expect(lifecycle).not.toHaveBeenCalled();
  });
});
