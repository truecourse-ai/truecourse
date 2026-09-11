/**
 * THE HEAVY LANE: a workspace runs ONE heavy repository job at a time.
 *
 * Test setup, scenario generation and the run each clone a repository, install
 * and build it and spend the model's sessions. Three of them side by side
 * starve the process that is also serving HTTP, so all three are enqueued into
 * one graphile QUEUE per workspace: the second one WAITS — as a `queued` row,
 * which is what the Agent page and `/api/jobs` read — and starts when the
 * running one settles, in enqueue order.
 *
 * What is pinned here is that behaviour end to end on the real queue (PGlite +
 * the real harness), and the two things it must not break: the onboarding
 * chain still reaches its next link (a job enqueued from a running job's settle
 * hook starts AFTER it, never into a deadlock), and the light jobs — a context
 * sync — still run beside a heavy one.
 *
 * Only graphile is faked, and the fake models the one rule the real queue has:
 * a job whose queue is locked is not claimed at all until that queue frees, and
 * a job with no queue name is claimed straight away. Every heavy body is frozen
 * where it acquires its work tree, so "which one is running" is exact rather
 * than timed.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { Runner } from 'graphile-worker';
import { schema, MIGRATIONS_DIR, type Db } from '@truecourse/db';
import { JobStore, PgGuardStore } from '@truecourse/data-store';
import { registerJob, type JobTask, type StartWorker } from '@truecourse/jobs';
import type { JobStatus, JobView } from '@truecourse/shared';
import { resetGuardStore, setGuardStore } from '@truecourse/core/lib/guard-store';
import { resetContextStore, setContextStore } from '@truecourse/core/lib/context-store';
import { resetSpecStore, setSpecStore } from '@truecourse/core/lib/spec-store';
import {
  resetSessionsRootResolver,
  setSessionsRootResolver,
} from '@truecourse/core/lib/sessions-store';
import { memoryContextStore } from '../helpers/memory-context-store';
import { memorySpecStore } from '../helpers/memory-spec-store';
import { createServerJobs, type JobsMount } from '../../apps/dashboard/server/src/jobs/index';
import { setWorkTreeProvider } from '../../apps/dashboard/server/src/services/work-tree.service';
import { setContextEventPublisher } from '../../apps/dashboard/server/src/services/context.service';
import type { WorkspaceLlm } from '../../apps/dashboard/server/src/services/workspace-llm.service';

/** A workspace (and repositories) of its own per test — one database serves all. */
let ORG: string;
let OTHER_ORG: string;
let REPO_A: string;
let REPO_B: string;
let REPO_C: string;
let counter = 0;

let client: PGlite;
let db: Db;
let jobs: JobsMount;
let home: string;
/** Every body the fake worker started — awaited so nothing leaks between tests. */
let running: Promise<void>[];
/** Every graphile enqueue, with the spec it carried (the queue name included). */
let enqueued: { task: string; queue: string | undefined }[];

const testLlm = {
  mode: 'api',
  driver: () => ({}) as never,
  transport: () => ({}) as never,
} as unknown as WorkspaceLlm;

const hub = { start: async () => {}, stop: async () => {}, subscribe: () => () => {} };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const settle = (ms = 5): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function until(predicate: () => boolean | Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await settle();
  }
  throw new Error('timed out waiting for the queue to move');
}

// ---------------------------------------------------------------------------
// The frozen work tree: where every heavy body is held
// ---------------------------------------------------------------------------

/** One heavy body, stopped at its clone: who asked, and the hold that frees it. */
interface Acquisition {
  repoKey: string;
  /** What every job row of the workspace looked like the instant this body started. */
  rowsAtStart: JobView[];
  release(): void;
}

let acquisitions: Acquisition[];

const acquisitionsFor = (repoKey: string): Acquisition[] =>
  acquisitions.filter((a) => a.repoKey === repoKey);

/** Wait until `repoKey`'s nth body has reached its clone (1-based). */
const bodyStarted = (repoKey: string, nth = 1): Promise<void> =>
  until(() => acquisitionsFor(repoKey).length >= nth);

/** A one-commit repository standing in for an ephemeral clone. */
function cloneDir(repoKey: string): string {
  const dir = fs.mkdtempSync(path.join(home, `${repoKey.replace('/', '__')}-`));
  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  };
  git('init', '--initial-branch=main');
  // The suite hides the developer's global config, so identity is per-repo.
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.com');
  fs.writeFileSync(path.join(dir, 'README.md'), '# repo\n');
  git('add', '.');
  git('commit', '-m', 'one');
  return dir;
}

/**
 * The work-tree seam, as a freeze point: a body that gets this far IS running,
 * and stays running until the test lets go of it.
 */
function installFrozenWorkTree(): void {
  setWorkTreeProvider(async (repoKey) => {
    const hold = deferred<void>();
    acquisitions.push({
      repoKey,
      rowsAtStart: await new JobStore(db).listForOrg(ORG),
      release: hold.resolve,
    });
    await hold.promise;
    return { dir: cloneDir(repoKey), dispose: () => {} };
  });
}

// ---------------------------------------------------------------------------
// The queue, as graphile runs it
// ---------------------------------------------------------------------------

/**
 * graphile with its one rule kept: a named queue runs its jobs one at a time in
 * enqueue order (a job whose queue is locked is simply not claimed), while a job
 * that names no queue is claimed immediately. `only` narrows which task types
 * have a handler, so an enqueue can be observed without its body running.
 */
function laneWorker(only: readonly string[]): StartWorker<Record<string, unknown>> {
  return async ({ rt, tasks }) => {
    const handlers = new Map(
      tasks
        .filter((t: JobTask) => only.includes(t.type))
        .map((t: JobTask) => [t.type, registerJob(rt, t)] as const),
    );
    const lanes = new Map<string, Promise<void>>();
    return {
      addJob: async (task: string, payload: unknown, spec: { queueName?: string } = {}) => {
        enqueued.push({ task, queue: spec.queueName });
        const handler = handlers.get(task);
        if (!handler) return;
        const start = (): Promise<void> => handler(payload, {}).catch(() => undefined);
        if (!spec.queueName) {
          running.push(start());
          return;
        }
        const tail = (lanes.get(spec.queueName) ?? Promise.resolve()).then(start);
        lanes.set(spec.queueName, tail);
        running.push(tail);
      },
      stop: async () => {},
    } as unknown as Runner;
  };
}

/** The mount, with every engine stubbed: the bodies exist to occupy the lane. */
function mount(only: readonly string[]): JobsMount {
  return createServerJobs({
    db,
    connectionString: 'postgres://unused',
    hub,
    startWorker: laneWorker(only),
    guardSetup: {
      startLlm: async () => testLlm,
      // A setup that settles leaves a recipe behind, and the repository it ran
      // for reads documents — which is what makes it chain a generation.
      runSetup: async (repoRoot: string) => {
        fs.mkdirSync(path.join(repoRoot, '.truecourse', 'scenarios'), { recursive: true });
        fs.writeFileSync(
          path.join(repoRoot, '.truecourse', 'scenarios', 'recipe.json'),
          JSON.stringify({ version: 1, kind: 'cli' }),
        );
        return {
          report: { ranAt: '2026-01-01T00:00:00Z', status: 'ok', reason: '', steps: [] },
          reportPath: '',
          sessionsRunDirs: [],
        } as never;
      },
      sliceDocuments: async () => 2,
    },
    guardGenerate: { startLlm: async () => testLlm, runGenerate: async () => ({}) as never },
    guardRun: { startLlm: async () => testLlm, runGuard: async () => ({}) as never },
  });
}

const jobStore = (): JobStore => new JobStore(db);

const rowsOfType = async (type: string, org = ORG): Promise<JobView[]> =>
  (await jobStore().listForOrg(org)).filter((j) => j.type === type);

const statusOf = async (jobId: string): Promise<JobStatus | undefined> =>
  (await jobStore().get(jobId))?.status;

const generateRequest = (repoFullName: string, org = ORG) => ({
  repoId: repoFullName.split('/')[1] as string,
  repoFullName,
  workspaceOrgId: org,
  source: 'manual' as const,
});

// ---------------------------------------------------------------------------

beforeAll(async () => {
  home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tc-lane-home-')));
  process.env.TRUECOURSE_HOME = home;
  // The production layout: one transcript root per repository identity, so one
  // repository's run is never read as another's.
  setSessionsRootResolver((key) => path.join(home, 'sessions', key.replace('/', '__')));
  client = new PGlite();
  db = drizzle(client, { schema }) as unknown as Db;
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
});

afterAll(async () => {
  resetSessionsRootResolver();
  await client.close();
  fs.rmSync(home, { recursive: true, force: true });
});

beforeEach(() => {
  counter += 1;
  ORG = `org_lane_${counter}`;
  OTHER_ORG = `org_other_${counter}`;
  REPO_A = `acme/widgets-${counter}`;
  REPO_B = `acme/gadgets-${counter}`;
  REPO_C = `acme/sprockets-${counter}`;
  running = [];
  enqueued = [];
  acquisitions = [];
  setGuardStore(new PgGuardStore(db));
  setContextStore(memoryContextStore());
  setSpecStore(memorySpecStore());
  setContextEventPublisher(() => {});
  installFrozenWorkTree();
});

afterEach(async () => {
  // Nothing may still be frozen when the suite moves on.
  for (const acquisition of acquisitions) acquisition.release();
  await Promise.all(running);
  await jobs?.stop();
  setWorkTreeProvider(null);
  setContextEventPublisher(null);
  resetGuardStore();
  resetContextStore();
  resetSpecStore();
  fs.rmSync(path.join(home, 'sessions'), { recursive: true, force: true });
});

describe('two repositories of one workspace, generated together', () => {
  it('runs the first and leaves the second queued until it settles', async () => {
    jobs = mount(['repo.guard-generate']);
    await jobs.start();

    const first = await jobs.enqueueGuardGenerate(generateRequest(REPO_A));
    const second = await jobs.enqueueGuardGenerate(generateRequest(REPO_B));
    expect(first.status).toBe('queued');
    expect(second.status).toBe('queued');

    // The first has reached its clone; the second has not been claimed at all.
    await bodyStarted(REPO_A);
    expect(acquisitionsFor(REPO_B)).toEqual([]);
    const secondId = (second as { jobId: string }).jobId;
    expect(await statusOf(secondId)).toBe('queued');
    // And it says so where the Agent page reads it.
    const active = await jobStore().listActive(ORG);
    expect(active.map((j) => j.status).sort()).toEqual(['queued', 'running']);

    // Let the first go; the second starts only now, and only after the first
    // reached a terminal state — which is what the queue's lock means.
    acquisitionsFor(REPO_A)[0]!.release();
    await bodyStarted(REPO_B);
    const firstId = (first as { jobId: string }).jobId;
    const firstAtSecondStart = acquisitionsFor(REPO_B)[0]!.rowsAtStart.find((j) => j.id === firstId);
    expect(firstAtSecondStart?.status).toBe('failed');
    expect(await statusOf(secondId)).toBe('running');
  });

  it('keeps the enqueue order: three generations run oldest first', async () => {
    jobs = mount(['repo.guard-generate']);
    await jobs.start();

    for (const repo of [REPO_A, REPO_B, REPO_C]) {
      await jobs.enqueueGuardGenerate(generateRequest(repo));
    }

    // Release each body as it arrives: the next one is handed the lane only
    // then, so what `acquisitions` records IS the order they ran in.
    for (let i = 0; i < 3; i += 1) {
      await until(() => acquisitions.length > i);
      acquisitions[i]!.release();
    }
    expect(acquisitions.map((a) => a.repoKey)).toEqual([REPO_A, REPO_B, REPO_C]);
  });

  it('gates per workspace: another workspace runs its own generation beside it', async () => {
    jobs = mount(['repo.guard-generate']);
    await jobs.start();

    await jobs.enqueueGuardGenerate(generateRequest(REPO_A));
    await bodyStarted(REPO_A);
    await jobs.enqueueGuardGenerate(generateRequest(REPO_B, OTHER_ORG));

    // A workspace's queue is its own, so the other one is not behind this one.
    await bodyStarted(REPO_B);
    expect(enqueued.map((e) => e.queue)).toEqual([`heavy:${ORG}`, `heavy:${OTHER_ORG}`]);
  });
});

describe('every heavy job shares the workspace’s lane', () => {
  it('setup, generation and the run all enqueue into it — a sync and a scan do not', async () => {
    jobs = mount([]);
    await jobs.start();

    await jobs.enqueueGuardSetup(generateRequest(REPO_A));
    await jobs.enqueueGuardGenerate(generateRequest(REPO_A));
    await jobs.enqueueGuardRun(generateRequest(REPO_A));
    await jobs.enqueueContextSync({ workspaceOrgId: ORG, sourceId: 'src-1', source: 'manual' });
    await jobs.enqueueContextScan({ workspaceOrgId: ORG, source: 'manual' });

    expect(enqueued).toEqual([
      { task: 'repo.guard-setup', queue: `heavy:${ORG}` },
      { task: 'repo.guard-generate', queue: `heavy:${ORG}` },
      { task: 'repo.guard-run', queue: `heavy:${ORG}` },
      { task: 'context.sync', queue: undefined },
      { task: 'context.scan', queue: undefined },
    ]);
  });

  it('runs a context sync while a generation holds the lane', async () => {
    jobs = mount(['repo.guard-generate', 'context.sync']);
    await jobs.start();

    const generate = await jobs.enqueueGuardGenerate(generateRequest(REPO_A));
    await bodyStarted(REPO_A);

    // The source is gone (this workspace has none), so the body settles at once
    // — which is the point: it never waited for the generation.
    const sync = await jobs.enqueueContextSync({
      workspaceOrgId: ORG,
      sourceId: 'src-1',
      source: 'manual',
    });
    const syncId = (sync as { jobId: string }).jobId;
    await until(async () => (await statusOf(syncId)) === 'succeeded');

    expect(await statusOf((generate as { jobId: string }).jobId)).toBe('running');
  });
});

describe('the onboarding chain through the lane', () => {
  it('starts the chained generation after the setup that enqueued it settled', async () => {
    jobs = mount(['repo.guard-setup', 'repo.guard-generate']);
    await jobs.start();

    const setup = await jobs.enqueueGuardSetup(generateRequest(REPO_A));
    const setupId = (setup as { jobId: string }).jobId;
    await bodyStarted(REPO_A);
    // The chain is enqueued from the settle hook, so nothing exists yet.
    expect(await rowsOfType('repo.guard-generate')).toEqual([]);

    acquisitionsFor(REPO_A)[0]!.release();
    // The setup succeeded and chained the generation, which the lane then ran:
    // no deadlock, and the setup was already terminal when it started.
    await bodyStarted(REPO_A, 2);
    const chained = acquisitionsFor(REPO_A)[1]!.rowsAtStart.find((j) => j.id === setupId);
    expect(chained?.status).toBe('succeeded');
    const [generate] = await rowsOfType('repo.guard-generate');
    expect(generate?.status).toBe('running');
  });
});

describe('disconnecting a repository', () => {
  it('drops its queued heavy job, which then never runs', async () => {
    jobs = mount(['repo.guard-generate']);
    await jobs.start();

    await jobs.enqueueGuardGenerate(generateRequest(REPO_A));
    const queued = await jobs.enqueueGuardGenerate(generateRequest(REPO_B));
    const queuedId = (queued as { jobId: string }).jobId;
    await bodyStarted(REPO_A);
    expect(await statusOf(queuedId)).toBe('queued');

    expect(await jobs.cancelRepoJobs(REPO_B, ORG)).toBe('stopped');
    expect(await statusOf(queuedId)).toBe('cancelled');

    // The lane still reaches it — and the body is skipped, not run.
    acquisitionsFor(REPO_A)[0]!.release();
    await Promise.all(running);
    expect(acquisitionsFor(REPO_B)).toEqual([]);
    expect(await statusOf(queuedId)).toBe('cancelled');
  });

  it('stops the running one too, and frees the lane for what was behind it', async () => {
    jobs = mount(['repo.guard-generate']);
    await jobs.start();

    const first = await jobs.enqueueGuardGenerate(generateRequest(REPO_A));
    await jobs.enqueueGuardGenerate(generateRequest(REPO_B));
    await bodyStarted(REPO_A);

    // A disconnect aborts the running body; releasing its freeze lets it unwind.
    const cancelled = jobs.cancelRepoJobs(REPO_A, ORG);
    await settle();
    acquisitionsFor(REPO_A)[0]!.release();
    expect(await cancelled).toBe('stopped');

    await bodyStarted(REPO_B);
    expect(await statusOf((first as { jobId: string }).jobId)).toBe('cancelled');
  });
});
