/**
 * The `guard.gate` job definition on the shared harness, with the gate pipeline
 * faked (no clone, no executor): step progress over the four-phase checklist,
 * the silent success (the Check on the PR is the verdict — no toast), failure →
 * onError notification PLUS the crash-path error Check (a crashed job never
 * strands the in-progress Check), and boot-recovery orphan reaping of gate rows.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type EeDb } from '@truecourse/ee-db';
import type { GuardGatePipeline } from '@truecourse/ee-github-app';
import { JobStore, NotificationStore } from '../../ee/packages/data-store/src/index';
import {
  GUARD_GATE_TASK,
  guardGateJobKey,
  type GuardGateJobPayload,
} from '../../ee/packages/server/src/jobs/constants';
import { runGuardGate } from '../../ee/packages/server/src/jobs/worker';
import { settleOrphanedGuardGates } from '../../ee/packages/server/src/jobs/orphans';

const ORG = 'org_A';
const REPO = 'acme/api';
const HEAD_SHA = 'headsha1234567890';

const GITHUB_ENV = {
  GITHUB_APP_ID: '1',
  GITHUB_APP_PRIVATE_KEY:
    '-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----',
  GITHUB_APP_WEBHOOK_SECRET: 'whsec',
  GITHUB_APP_SLUG: 'tc-gate',
} as const;

let client: PGlite;
let db: EeDb;
let savedEnv: Record<string, string | undefined>;

beforeEach(async () => {
  client = new PGlite();
  db = drizzle(client, { schema }) as unknown as EeDb;
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

function payloadFor(jobId: string, over: Partial<GuardGateJobPayload> = {}): GuardGateJobPayload {
  return {
    jobId,
    workspaceOrgId: ORG,
    repoFullName: REPO,
    installationId: 42,
    prNumber: 7,
    defaultBranch: 'main',
    baseBranch: 'main',
    baseSha: 'basesha0987654321',
    headSha: HEAD_SHA,
    headRef: 'feature/x',
    isFork: false,
    checkRunId: 9001,
    ...over,
  };
}

/** Fake octokit capturing completed Checks (the crash-path error post). */
function makeOctokit() {
  const calls = { check: [] as any[] };
  const octokit: any = {
    checks: {
      create: async (p: any) => {
        calls.check.push(p);
        return { data: { id: 1 } };
      },
      update: async (p: any) => {
        calls.check.push(p);
        return { data: { id: p.check_run_id } };
      },
    },
  };
  return { octokit, calls };
}

const neutralDecision = { conclusion: 'neutral' as const, diff: { newlyFailing: [], preExisting: [], resolved: [], stale: [], excluded: [] } };

describe('runGuardGate — worker body', () => {
  it('drives clone → base → run → verdict progress and succeeds silently (no toast)', async () => {
    const jobStore = new JobStore(db);
    const notifications = new NotificationStore(db);
    const job = await jobStore.create({
      org: ORG,
      type: GUARD_GATE_TASK,
      key: guardGateJobKey(REPO, HEAD_SHA),
    });

    const progressAfter: Array<{ current: number; total: number; message: string | null }> = [];
    const pipeline: GuardGatePipeline = {
      run: vi.fn(async (deps, p, progress) => {
        // The default deps factory hands the pipeline the live seams.
        expect(deps.auth).toBeDefined();
        expect(deps.store).toBeDefined();
        expect(deps.guardStore).toBeDefined();
        expect(typeof deps.execute).toBe('function');
        expect(typeof deps.limiter.run).toBe('function');
        expect(p).toMatchObject({ repoFullName: REPO, prNumber: 7, headSha: HEAD_SHA });
        for (const phase of ['clone', 'base', 'run', 'verdict'] as const) {
          await progress?.onPhase?.(phase);
          const j = await jobStore.get(job.id);
          if (j) progressAfter.push({ ...j.progress });
        }
        return { ...neutralDecision, conclusion: 'success' as const };
      }),
    };

    await runGuardGate({ db, jobStore, notifications, pipeline }, payloadFor(job.id));

    expect(progressAfter.map((p) => p.message)).toEqual([
      'Cloning repository',
      'Establishing baseline',
      'Running scenarios',
      'Posting Check',
    ]);
    expect(progressAfter.every((p) => p.total === 4)).toBe(true);
    expect(progressAfter.map((p) => p.current)).toEqual([0, 1, 2, 3]);

    const done = await jobStore.get(job.id);
    expect(done?.status).toBe('succeeded');
    expect(done?.result).toEqual({
      repoFullName: REPO,
      prNumber: 7,
      headSha: HEAD_SHA,
      conclusion: 'success',
    });
    // Silent success: the verdict lives on the PR's Check, not the feed.
    expect(await notifications.listForOrg(ORG)).toHaveLength(0);
  });

  it('a crashed pipeline fails the job, notifies, AND settles the Check as an error-styled failure', async () => {
    const jobStore = new JobStore(db);
    const notifications = new NotificationStore(db);
    const job = await jobStore.create({
      org: ORG,
      type: GUARD_GATE_TASK,
      key: guardGateJobKey(REPO, HEAD_SHA),
    });
    const { octokit, calls } = makeOctokit();

    const pipeline: GuardGatePipeline = {
      run: async () => {
        throw new Error('clone exploded');
      },
    };

    await expect(
      runGuardGate(
        { db, jobStore, notifications, pipeline, octokitFor: () => octokit },
        payloadFor(job.id),
      ),
    ).rejects.toThrow('clone exploded');

    const failed = await jobStore.get(job.id);
    expect(failed?.status).toBe('failed');
    expect(failed?.error).toBe('clone exploded');

    // The in-progress Check opened at webhook time is never stranded: it
    // completes as a FAILURE with the error-styled title (decision 1).
    expect(calls.check).toHaveLength(1);
    expect(calls.check[0]).toMatchObject({
      check_run_id: 9001,
      status: 'completed',
      conclusion: 'failure',
    });
    expect(calls.check[0].output.title).toBe(
      'Gate error — gate infrastructure failed (no verdict)',
    );

    const notes = await notifications.listForOrg(ORG);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      kind: GUARD_GATE_TASK,
      level: 'error',
      title: 'Guard gate failed — acme/api',
    });
    expect(notes[0]?.data).toMatchObject({
      repoFullName: REPO,
      prNumber: 7,
      detail: 'clone exploded',
    });
  });

  it('the crash-path error Check creates a fresh completed run when no checkRunId rode the payload', async () => {
    const jobStore = new JobStore(db);
    const notifications = new NotificationStore(db);
    const job = await jobStore.create({
      org: ORG,
      type: GUARD_GATE_TASK,
      key: guardGateJobKey(REPO, HEAD_SHA),
    });
    const { octokit, calls } = makeOctokit();
    const pipeline: GuardGatePipeline = {
      run: async () => {
        throw new Error('boom');
      },
    };

    await expect(
      runGuardGate(
        { db, jobStore, notifications, pipeline, octokitFor: () => octokit },
        payloadFor(job.id, { checkRunId: null }),
      ),
    ).rejects.toThrow('boom');

    expect(calls.check).toHaveLength(1);
    expect(calls.check[0]).toMatchObject({
      name: 'TrueCourse / Spec Guard',
      head_sha: HEAD_SHA,
      status: 'completed',
      conclusion: 'failure',
    });
  });

  it('threads the abort signal into the pipeline — it fires when the source aborts', async () => {
    const jobStore = new JobStore(db);
    const notifications = new NotificationStore(db);
    const job = await jobStore.create({
      org: ORG,
      type: GUARD_GATE_TASK,
      key: guardGateJobKey(REPO, HEAD_SHA),
    });

    const controller = new AbortController();
    let seen: AbortSignal | undefined;
    const pipeline: GuardGatePipeline = {
      run: async (_deps, _p, opts) => {
        seen = opts?.signal;
        return { ...neutralDecision, conclusion: 'success' as const };
      },
    };

    await runGuardGate(
      { db, jobStore, notifications, pipeline, signal: controller.signal },
      payloadFor(job.id),
    );

    // The pipeline received the worker's signal, live: aborting the source
    // (graphile's helpers.abortSignal on shutdown) is visible through it.
    expect(seen).toBe(controller.signal);
    expect(seen!.aborted).toBe(false);
    controller.abort();
    expect(seen!.aborted).toBe(true);
  });

  it('fails the job when the GitHub App is not configured (pipeline never runs)', async () => {
    for (const k of Object.keys(GITHUB_ENV)) delete process.env[k];
    const jobStore = new JobStore(db);
    const notifications = new NotificationStore(db);
    const job = await jobStore.create({
      org: ORG,
      type: GUARD_GATE_TASK,
      key: guardGateJobKey(REPO, HEAD_SHA),
    });

    const pipeline: GuardGatePipeline = { run: vi.fn() as unknown as GuardGatePipeline['run'] };
    await expect(
      runGuardGate({ db, jobStore, notifications, pipeline }, payloadFor(job.id)),
    ).rejects.toThrow('the GitHub App is not configured');
    expect(pipeline.run).not.toHaveBeenCalled();
    expect((await jobStore.get(job.id))?.status).toBe('failed');
  });
});

describe('guard.gate — restart survival (boot recovery)', () => {
  /** The persisted enqueue request (what singleFlightEnqueue stores on the row). */
  const storedRequest = () => {
    const { jobId: _jobId, ...req } = payloadFor('unused');
    return req;
  };

  it('the durable row survives as queued/running; failOrphaned reaps it and frees the key', async () => {
    const jobStore = new JobStore(db);
    const key = guardGateJobKey(REPO, HEAD_SHA);
    const job = await jobStore.create({ org: ORG, type: GUARD_GATE_TASK, key });
    await jobStore.markRunning(job.id);

    // Simulated restart: the in-process worker died mid-run; registerJobs boots
    // and reaps every non-terminal row so the single-flight key frees.
    const reaped = await jobStore.failOrphaned();
    expect(reaped).toHaveLength(1);
    expect((await jobStore.get(job.id))?.status).toBe('failed');

    const rerun = await jobStore.create({ org: ORG, type: GUARD_GATE_TASK, key });
    expect(rerun.status).toBe('queued');
  });

  it('a reaped guard.gate settles its stranded Check as the error-styled failure; other orphans do not post', async () => {
    const jobStore = new JobStore(db);
    // The gate job was mid-run when the process died — its in-progress Check
    // (opened at webhook time) would otherwise spin forever.
    const gate = await jobStore.create({
      org: ORG,
      type: GUARD_GATE_TASK,
      key: guardGateJobKey(REPO, HEAD_SHA),
      payload: storedRequest(),
    });
    await jobStore.markRunning(gate.id);
    // A non-gate orphan reaped in the same boot must NOT touch GitHub.
    const sync = await jobStore.create({
      org: ORG,
      type: 'knowledge.sync',
      key: 'knowledge.sync:confluence',
      payload: { org: ORG, kind: 'confluence' },
    });
    await jobStore.markRunning(sync.id);

    const orphans = await jobStore.failOrphaned();
    expect(orphans).toHaveLength(2);

    const { octokit, calls } = makeOctokit();
    const settled = await settleOrphanedGuardGates({ octokitFor: () => octokit }, orphans);

    expect(settled).toBe(1);
    expect(calls.check).toHaveLength(1);
    expect(calls.check[0]).toMatchObject({
      check_run_id: 9001,
      status: 'completed',
      conclusion: 'failure',
    });
    expect(calls.check[0].output.title).toBe(
      'Gate error — gate infrastructure failed (no verdict)',
    );
  });

  it('is best-effort: rows without a stored payload and octokit failures are skipped, never thrown', async () => {
    const jobStore = new JobStore(db);
    // Pre-payload-column row (or a hand-inserted one): nothing to settle with.
    const bare = await jobStore.create({
      org: ORG,
      type: GUARD_GATE_TASK,
      key: guardGateJobKey(REPO, 'othersha000'),
    });
    await jobStore.markRunning(bare.id);
    const gate = await jobStore.create({
      org: ORG,
      type: GUARD_GATE_TASK,
      key: guardGateJobKey(REPO, HEAD_SHA),
      payload: storedRequest(),
    });
    await jobStore.markRunning(gate.id);

    const orphans = await jobStore.failOrphaned();
    const failing: any = {
      checks: {
        create: async () => {
          throw new Error('github down');
        },
        update: async () => {
          throw new Error('github down');
        },
      },
    };

    await expect(
      settleOrphanedGuardGates({ octokitFor: () => failing }, orphans),
    ).resolves.toBe(0);
  });
});
