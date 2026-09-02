/**
 * `singleFlightEnqueue` addresses the graphile job at the row it just created,
 * whatever the caller's payload carried. A chain built from the settling job's
 * own payload forwards THAT job's id; the new row's id must still win, or the
 * task finds a settled row and skips the body it was queued for.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type Db } from '@truecourse/db';
import type { Runner } from 'graphile-worker';
import { JobStore, NotificationStore } from '@truecourse/data-store';
import { createJobs, registerJob, type JobDefinition, type JobRuntime } from '@truecourse/jobs';

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
