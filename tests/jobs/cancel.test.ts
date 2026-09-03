/**
 * Cancellation: a deliberate stop is a first-class outcome, not a failure. A job
 * cancelled while queued never runs; one aborted mid-run settles `cancelled`
 * with no error and no notification, and its settled hook is told so.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type Db } from '@truecourse/db';
import type { Runner } from 'graphile-worker';
import type { ServerEvent } from '@truecourse/shared';
import { JobStore, NotificationStore } from '@truecourse/data-store';
import {
  createJobs,
  registerJob,
  type JobDefinition,
  type JobRuntime,
  type Jobs,
} from '@truecourse/jobs';

const ORG = 'org_A';
type Payload = { jobId: string; org: string };

let client: PGlite;
let db: Db;
let published: ServerEvent[];

beforeEach(async () => {
  client = new PGlite();
  db = drizzle(client, { schema }) as unknown as Db;
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  published = [];
});

afterEach(async () => {
  await client.close();
});

function runtime(): JobRuntime & { jobStore: JobStore; notifications: NotificationStore } {
  return {
    db,
    jobStore: new JobStore(db),
    notifications: new NotificationStore(db),
    publish: async (_org, event) => {
      published.push(event);
    },
  };
}

/** A deferred so a test can hold a job body open while it cancels. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/**
 * The runner, with graphile replaced by a fake whose `addJob` runs the task
 * inline through the real `registerJob` wrapper — which is what puts a running
 * job in the local cancel registry. The task runs on the TEST's runtime, so its
 * events land where the assertions can see them.
 */
async function jobsOver(
  rt: ReturnType<typeof runtime>,
  def: JobDefinition<Payload>,
): Promise<{ jobs: Jobs; running: Promise<void>[] }> {
  const running: Promise<void>[] = [];
  const task = registerJob(rt, def);
  const fakeRunner = {
    addJob: async (_name: string, payload: unknown) => {
      running.push(task(payload, {}).catch(() => undefined));
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
  return { jobs, running };
}

describe('cancel — a job that has not started', () => {
  it('cancels the queued row, and the worker skips the body when it picks it up', async () => {
    const rt = runtime();
    const gate = deferred<void>();
    const run = vi.fn(async () => {
      await gate.promise;
      return { notification: null };
    });
    const def: JobDefinition<Payload> = {
      type: 'test.job',
      title: 'Testing',
      steps: [{ key: 'a', label: 'Step A' }],
      org: (p) => p.org,
      run,
      onError: (err) => ({ level: 'error', title: 'Failed', body: err.message }),
    };

    const { jobs } = await jobsOver(rt, def);
    const job = await rt.jobStore.create({ org: ORG, type: 'test.job', key: 'test.job:q' });

    expect(await jobs.cancel(job.id)).toBe('cancelled');
    expect((await rt.jobStore.get(job.id))?.status).toBe('cancelled');

    // The graphile job still exists — running it must be a no-op.
    await registerJob(rt, def)({ jobId: job.id, org: ORG }, {});
    expect(run).not.toHaveBeenCalled();
    expect(published).toEqual([]);
    expect(await rt.notifications.listForOrg(ORG)).toHaveLength(0);
    gate.resolve();
  });

  it('reports absent for a job that already settled', async () => {
    const rt = runtime();
    const def: JobDefinition<Payload> = {
      type: 'test.job',
      title: 'Testing',
      steps: [],
      org: (p) => p.org,
      run: async () => ({ notification: null }),
      onError: (err) => ({ level: 'error', title: 'Failed', body: err.message }),
    };
    const { jobs } = await jobsOver(rt, def);
    const job = await rt.jobStore.create({ org: ORG, type: 'test.job', key: 'test.job:done' });
    await rt.jobStore.markSucceeded(job.id, {});

    expect(await jobs.cancel(job.id)).toBe('absent');
    expect(await jobs.cancel('11111111-1111-1111-1111-111111111111')).toBe('absent');
  });
});

describe('cancel — a job running in this process', () => {
  it('aborts the body, settles cancelled with no notification, and tells onSettled', async () => {
    const rt = runtime();
    const started = deferred<void>();
    const settled = vi.fn(async () => {});
    const def: JobDefinition<Payload> = {
      type: 'test.job',
      title: 'Testing',
      steps: [{ key: 'a', label: 'Step A' }],
      org: (p) => p.org,
      onSettled: settled,
      run: async (ctx) => {
        await ctx.phase('a');
        started.resolve();
        // Real bodies thread the signal into their long work; here it is the work.
        await new Promise<void>((_res, rej) => {
          ctx.signal?.addEventListener('abort', () => rej(new Error('aborted')), { once: true });
        });
        return { notification: null };
      },
      onError: (err) => ({ level: 'error', title: 'Failed', body: err.message }),
    };

    const { jobs, running } = await jobsOver(rt, def);
    const job = await rt.jobStore.create({ org: ORG, type: 'test.job', key: 'test.job:r' });
    await jobs.addJob('test.job', { jobId: job.id, org: ORG }, 'test.job:r');
    await started.promise;
    expect((await rt.jobStore.get(job.id))?.status).toBe('running');

    expect(await jobs.cancel(job.id)).toBe('cancelled');
    await Promise.all(running);

    const row = await rt.jobStore.get(job.id);
    expect(row?.status).toBe('cancelled');
    expect(row?.error).toBeNull();
    expect(await rt.notifications.listForOrg(ORG)).toHaveLength(0);
    expect(published.some((e) => e.type === 'notification')).toBe(false);
    // The last live event shows the cancelled terminal state.
    const last = published.filter((e) => e.type === 'job.progress').at(-1);
    expect(last?.type === 'job.progress' && last.job.status).toBe('cancelled');
    expect(settled).toHaveBeenCalledWith(expect.anything(), 'cancelled', undefined);
  });

  it('a body that ignores its signal and completes anyway still settles cancelled', async () => {
    const rt = runtime();
    const started = deferred<void>();
    const finish = deferred<void>();
    const def: JobDefinition<Payload> = {
      type: 'test.job',
      title: 'Testing',
      steps: [],
      org: (p) => p.org,
      run: async () => {
        started.resolve();
        await finish.promise;
        return { notification: null };
      },
      onError: (err) => ({ level: 'error', title: 'Failed', body: err.message }),
    };

    const { jobs, running } = await jobsOver(rt, def);
    const job = await rt.jobStore.create({ org: ORG, type: 'test.job', key: 'test.job:stubborn' });
    await jobs.addJob('test.job', { jobId: job.id, org: ORG }, 'test.job:stubborn');
    await started.promise;

    const verdict = jobs.cancel(job.id);
    // Let the abort land while the body is still going, then let it finish.
    await new Promise((resolve) => setTimeout(resolve, 10));
    finish.resolve();
    await Promise.all(running);
    expect(await verdict).toBe('cancelled');
    expect((await rt.jobStore.get(job.id))?.status).toBe('cancelled');
  });
});

describe('cancel — a job running somewhere else', () => {
  it('leaves the foreign row alone', async () => {
    const rt = runtime();
    const def: JobDefinition<Payload> = {
      type: 'test.job',
      title: 'Testing',
      steps: [],
      org: (p) => p.org,
      run: async () => ({ notification: null }),
      onError: (err) => ({ level: 'error', title: 'Failed', body: err.message }),
    };
    const { jobs } = await jobsOver(rt, def);
    const job = await rt.jobStore.create({ org: ORG, type: 'test.job', key: 'test.job:elsewhere' });
    await rt.jobStore.markRunning(job.id);

    expect(await jobs.cancel(job.id)).toBe('not-here');
    // Its key stays held: the work is still going on the replica that owns it.
    expect((await rt.jobStore.get(job.id))?.status).toBe('running');
  });
});
