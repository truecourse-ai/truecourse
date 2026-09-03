/**
 * The `guard.baseline` job definition on the shared harness, with the baseline
 * pipeline faked (no clone, no executor): step progress over the three-phase
 * checklist, silent success (the baseline is an internal comparison point — no
 * toast), failure → onError notification, and the onSettled pending-buffer replay.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type Db } from '@truecourse/db';
import type { GuardBaselinePipeline } from '@truecourse/ee-github-app';
import { JobStore, NotificationStore } from '../../ee/packages/data-store/src/index';
import {
  GUARD_BASELINE_TASK,
  guardBaselineJobKey,
  type GuardBaselineJobPayload,
} from '../../ee/packages/server/src/jobs/constants';
import { runGuardBaseline } from '../../ee/packages/server/src/jobs/worker';

const ORG = 'org_A';
const REPO = 'acme/api';
const COMMIT = 'main1234567890';

const GITHUB_ENV = {
  GITHUB_APP_ID: '1',
  GITHUB_APP_PRIVATE_KEY: '-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----',
  GITHUB_APP_WEBHOOK_SECRET: 'whsec',
  GITHUB_APP_SLUG: 'tc-gate',
} as const;

let client: PGlite;
let db: Db;
let savedEnv: Record<string, string | undefined>;

beforeEach(async () => {
  client = new PGlite();
  db = drizzle(client, { schema }) as unknown as Db;
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  savedEnv = {};
  for (const [k, v] of Object.entries(GITHUB_ENV)) {
    savedEnv[k] = process.env[k];
    process.env[k] = v;
  }
});

afterEach(async () => {
  for (const k of Object.keys(GITHUB_ENV)) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  await client.close();
});

function payloadFor(jobId: string, over: Partial<GuardBaselineJobPayload> = {}): GuardBaselineJobPayload {
  return {
    jobId,
    workspaceOrgId: ORG,
    repoFullName: REPO,
    installationId: 42,
    defaultBranch: 'main',
    commitSha: COMMIT,
    ...over,
  };
}

describe('runGuardBaseline — worker body', () => {
  it('drives clone → run → persist progress and succeeds silently (no toast)', async () => {
    const jobStore = new JobStore(db);
    const notifications = new NotificationStore(db);
    const job = await jobStore.create({
      org: ORG,
      type: GUARD_BASELINE_TASK,
      key: guardBaselineJobKey(REPO),
    });

    const progressAfter: Array<{ current: number; total: number; message: string | null }> = [];
    const pipeline: GuardBaselinePipeline = {
      run: vi.fn(async (deps, p, opts) => {
        // The default deps factory hands the pipeline the live seams.
        expect(deps.auth).toBeDefined();
        expect(deps.guardStore).toBeDefined();
        expect(typeof deps.execute).toBe('function');
        expect(typeof deps.limiter.run).toBe('function');
        expect(p).toMatchObject({ repoFullName: REPO, defaultBranch: 'main', commitSha: COMMIT });
        for (const phase of ['clone', 'run', 'persist'] as const) {
          await opts?.onPhase?.(phase);
          const j = await jobStore.get(job.id);
          if (j) progressAfter.push({ ...j.progress });
        }
        return { status: 'ok', scenarioCount: 3 };
      }),
    };

    await runGuardBaseline({ db, jobStore, notifications, pipeline }, payloadFor(job.id));

    expect(progressAfter.map((p) => p.message)).toEqual([
      'Cloning repository',
      'Running scenarios',
      'Saving baseline',
    ]);
    expect(progressAfter.every((p) => p.total === 3)).toBe(true);

    const done = await jobStore.get(job.id);
    expect(done?.status).toBe('succeeded');
    expect(done?.result).toMatchObject({ repoFullName: REPO, status: 'ok', scenarioCount: 3 });
    // Silent success: no feed entry.
    expect(await notifications.listForOrg(ORG)).toHaveLength(0);
  });

  it('a no-verdict result succeeds but emits a failure-style notification (baseline could not settle)', async () => {
    const jobStore = new JobStore(db);
    const notifications = new NotificationStore(db);
    const job = await jobStore.create({
      org: ORG,
      type: GUARD_BASELINE_TASK,
      key: guardBaselineJobKey(REPO),
    });
    const pipeline: GuardBaselinePipeline = {
      run: async () => ({ status: 'no-verdict', scenarioCount: 2 }),
    };

    await runGuardBaseline({ db, jobStore, notifications, pipeline }, payloadFor(job.id));

    // The job itself still succeeds (the pipeline returned a result, not a throw)…
    const done = await jobStore.get(job.id);
    expect(done?.status).toBe('succeeded');
    expect(done?.result).toMatchObject({ status: 'no-verdict', scenarioCount: 2 });
    // …but the operator is told the refresh could not settle.
    const notes = await notifications.listForOrg(ORG);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      kind: GUARD_BASELINE_TASK,
      level: 'error',
      title: 'Guard baseline refresh failed — acme/api',
    });
    expect(notes[0]?.data).toMatchObject({ repoFullName: REPO, status: 'no-verdict' });
  });

  it('a crashed pipeline fails the job and notifies (onError)', async () => {
    const jobStore = new JobStore(db);
    const notifications = new NotificationStore(db);
    const job = await jobStore.create({
      org: ORG,
      type: GUARD_BASELINE_TASK,
      key: guardBaselineJobKey(REPO),
    });
    const pipeline: GuardBaselinePipeline = {
      run: async () => {
        throw new Error('clone exploded');
      },
    };

    await expect(
      runGuardBaseline({ db, jobStore, notifications, pipeline }, payloadFor(job.id)),
    ).rejects.toThrow('clone exploded');

    const failed = await jobStore.get(job.id);
    expect(failed?.status).toBe('failed');

    const notes = await notifications.listForOrg(ORG);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      kind: GUARD_BASELINE_TASK,
      level: 'error',
      title: 'Guard baseline refresh failed — acme/api',
    });
    expect(notes[0]?.data).toMatchObject({ repoFullName: REPO, detail: 'clone exploded' });
  });

  it('onSettled runs on success (the pending-buffer replay hook) with the terminal outcome', async () => {
    const jobStore = new JobStore(db);
    const notifications = new NotificationStore(db);
    const job = await jobStore.create({
      org: ORG,
      type: GUARD_BASELINE_TASK,
      key: guardBaselineJobKey(REPO),
    });
    const settled: Array<{ repo: string; outcome: string; status: string | null }> = [];
    const pipeline: GuardBaselinePipeline = {
      run: async () => ({ status: 'no-corpus', scenarioCount: 0 }),
    };

    await runGuardBaseline(
      {
        db,
        jobStore,
        notifications,
        pipeline,
        onSettled: async (p, s) =>
          void settled.push({ repo: p.repoFullName, outcome: s.outcome, status: s.status }),
      },
      payloadFor(job.id),
    );

    // The settle hook sees the terminal outcome AND the run's verdict status, so
    // the replay can tell a settled commit from a no-verdict one.
    expect(settled).toEqual([{ repo: REPO, outcome: 'succeeded', status: 'no-corpus' }]);
  });

  it('fails the job when the GitHub App is not configured (pipeline never runs)', async () => {
    for (const k of Object.keys(GITHUB_ENV)) delete process.env[k];
    const jobStore = new JobStore(db);
    const notifications = new NotificationStore(db);
    const job = await jobStore.create({
      org: ORG,
      type: GUARD_BASELINE_TASK,
      key: guardBaselineJobKey(REPO),
    });
    const pipeline: GuardBaselinePipeline = { run: vi.fn() as unknown as GuardBaselinePipeline['run'] };

    await expect(
      runGuardBaseline({ db, jobStore, notifications, pipeline }, payloadFor(job.id)),
    ).rejects.toThrow('the GitHub App is not configured');
    expect(pipeline.run).not.toHaveBeenCalled();
    expect((await jobStore.get(job.id))?.status).toBe('failed');
  });
});
