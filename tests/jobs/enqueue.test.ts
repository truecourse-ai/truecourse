/**
 * `singleFlightEnqueue` addresses the graphile job at the row it just created,
 * whatever the caller's payload carried. A chain built from the settling job's
 * own payload forwards THAT job's id; the new row's id must still win, or the
 * task finds a settled row and skips the body it was queued for.
 *
 * And an enqueue can name a QUEUE — graphile runs everything in one queue name
 * one at a time — which is how the heavy repository jobs are rationed per
 * workspace. What is pinned here is that the name reaches graphile, and that a
 * caller who names none still enqueues an unqueued job.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type Db } from '@truecourse/db';
import type { Runner } from 'graphile-worker';
import { JobStore, NotificationStore } from '@truecourse/data-store';
import {
  createJobs,
  registerJob,
  type JobDefinition,
  type JobRuntime,
  type Jobs,
} from '@truecourse/jobs';

const ORG = 'org_A';
type Payload = { jobId: string; repo: string };

let client: PGlite;
let db: Db;

beforeEach(async () => {
  client = new PGlite();
  db = drizzle(client, { schema }) as unknown as Db;
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
});

afterEach(async () => {
  await client.close();
});

describe('singleFlightEnqueue', () => {
  it('runs the task under the new row even when the payload carries another job id', async () => {
    const rt: JobRuntime = {
      db,
      jobStore: new JobStore(db),
      notifications: new NotificationStore(db),
      publish: async () => {},
    };
    const seen: string[] = [];
    const def: JobDefinition<Payload> = {
      type: 'test.job',
      title: 'Test',
      steps: [],
      org: () => ORG,
      async run(ctx) {
        seen.push(ctx.jobId);
        return { result: null, notification: null };
      },
      onError: () => ({ level: 'error', title: 'failed', body: '' }),
    };
    const task = registerJob(rt, def);
    const running: Promise<void>[] = [];
    const fakeRunner = {
      addJob: async (_name: string, payload: unknown) => {
        running.push(task(payload, {}));
      },
      stop: async () => {},
    } as unknown as Runner;
    const jobs = createJobs({
      db,
      connectionString: 'postgres://unused',
      tasks: [def],
      hub: { start: async () => {}, stop: async () => {}, subscribe: () => () => {} },
      startWorker: async () => fakeRunner,
    });
    await jobs.start();

    // The settled job a chain would forward: its id is already terminal.
    const earlier = await rt.jobStore.create({ org: ORG, type: 'test.job', key: 'test.job:earlier' });
    await rt.jobStore.markRunning(earlier.id);
    await rt.jobStore.markSucceeded(earlier.id, {});

    const jobId = await jobs.singleFlightEnqueue('test.job', ORG, 'test.job:r', {
      jobId: earlier.id,
      repo: 'acme/widgets',
    });
    await Promise.all(running);

    expect(jobId).not.toBeNull();
    expect(jobId).not.toBe(earlier.id);
    expect(seen).toEqual([jobId]);
    expect((await rt.jobStore.get(jobId as string))?.status).toBe('succeeded');
    await jobs.stop();
  });
});

describe('the queue name', () => {
  /** A runner that records the spec each enqueue reached graphile with. */
  async function jobsRecording(): Promise<{
    jobs: Jobs;
    specs: { name: string; spec: Record<string, unknown> }[];
  }> {
    const specs: { name: string; spec: Record<string, unknown> }[] = [];
    const fakeRunner = {
      addJob: async (name: string, _payload: unknown, spec: Record<string, unknown>) => {
        specs.push({ name, spec });
      },
      stop: async () => {},
    } as unknown as Runner;
    const jobs = createJobs({
      db,
      connectionString: 'postgres://unused',
      tasks: [],
      hub: { start: async () => {}, stop: async () => {}, subscribe: () => () => {} },
      startWorker: async () => fakeRunner,
    });
    await jobs.start();
    return { jobs, specs };
  }

  it('rides the enqueue into graphile, where it serializes the queue', async () => {
    const { jobs, specs } = await jobsRecording();

    await jobs.singleFlightEnqueue('test.job', ORG, 'test.job:a', { repo: 'a' }, { queue: `heavy:${ORG}` });
    await jobs.addJob('test.job', { jobId: 'x' }, 'test.job:b', { queue: `heavy:${ORG}` });

    expect(specs.map((s) => s.spec)).toEqual([
      { jobKey: 'test.job:a', maxAttempts: 1, queueName: `heavy:${ORG}` },
      { jobKey: 'test.job:b', maxAttempts: 1, queueName: `heavy:${ORG}` },
    ]);
    await jobs.stop();
  });

  it('is absent when the caller names none, so the job runs unqueued', async () => {
    const { jobs, specs } = await jobsRecording();

    await jobs.singleFlightEnqueue('test.job', ORG, 'test.job:a', { repo: 'a' });

    expect(specs[0]?.spec).toEqual({ jobKey: 'test.job:a', maxAttempts: 1 });
    await jobs.stop();
  });
});
