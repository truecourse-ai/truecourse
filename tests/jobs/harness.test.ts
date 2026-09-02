/**
 * The shared job lifecycle envelope: row bookkeeping, the seeded + advancing
 * step checklist, the standardized notification, the failure report, and the
 * settled hook. Its two side-channels (live events, failure reporting) are
 * runtime seams, so they are observed by passing fakes — no module mocking.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type Db } from '@truecourse/db';
import type { JobStep, JobView, ServerEvent } from '@truecourse/shared';
import { JobStore, NotificationStore } from '@truecourse/data-store';
import { executeJob, type JobDefinition, type JobRuntime } from '@truecourse/jobs';

const ORG = 'org_A';
type Payload = { jobId: string; org: string };
type ErrorMeta = { component: string; orgId?: string };

let client: PGlite;
let db: Db;
let published: Array<{ org: string; event: ServerEvent }>;
let captured: Array<{ err: unknown; meta: ErrorMeta | undefined }>;

beforeEach(async () => {
  client = new PGlite();
  db = drizzle(client, { schema }) as unknown as Db;
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  published = [];
  captured = [];
});

afterEach(async () => {
  await client.close();
});

function runtime(): JobRuntime<ErrorMeta> & { jobStore: JobStore; notifications: NotificationStore } {
  return {
    db,
    jobStore: new JobStore(db),
    notifications: new NotificationStore(db),
    publish: async (org, event) => {
      published.push({ org, event });
    },
    onException: (err, meta) => {
      captured.push({ err, meta });
    },
  };
}

/** The jobs carried on the emitted job.progress events. */
const progressEvents = (): JobView[] =>
  published.flatMap((p) => (p.event.type === 'job.progress' ? [p.event.job] : []));

const stepPairs = (steps: JobStep[] | undefined) => (steps ?? []).map((s) => [s.key, s.status]);

describe('executeJob — shared lifecycle envelope', () => {
  it('seeds the full checklist, advances it, succeeds, and posts a success notification', async () => {
    const rt = runtime();
    const job = await rt.jobStore.create({ org: ORG, type: 'test.job', key: 'test.job:1' });

    const def: JobDefinition<Payload, ErrorMeta> = {
      type: 'test.job',
      title: 'Testing',
      steps: [
        { key: 'a', label: 'Step A' },
        { key: 'b', label: 'Step B' },
        { key: 'c', label: 'Step C' },
      ],
      org: (p) => p.org,
      run: async (ctx) => {
        await ctx.phase('a');
        await ctx.phase('b');
        await ctx.phase('c');
        return { result: { ok: true }, notification: { level: 'success', title: 'Done', body: 'All good' } };
      },
      onError: (err) => ({ level: 'error', title: 'Failed', body: err.message }),
    };

    await executeJob(rt, def, { jobId: job.id, org: ORG });

    // Terminal row state + result.
    const done = await rt.jobStore.get(job.id);
    expect(done?.status).toBe('succeeded');
    expect(done?.result).toEqual({ ok: true });

    // Durable success notification, with jobId injected into data.
    const notes = await rt.notifications.listForOrg(ORG);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ kind: 'test.job', level: 'success', title: 'Done', body: 'All good' });
    expect(notes[0]?.data).toMatchObject({ jobId: job.id });

    // Every job.progress event carries the display title (client shows it verbatim).
    const jobs = progressEvents();
    expect(jobs.every((j) => j.title === 'Testing')).toBe(true);

    // The FIRST event (running) seeds the WHOLE plan, all pending.
    expect(jobs[0]?.status).toBe('running');
    expect(stepPairs(jobs[0]?.progress.steps)).toEqual([
      ['a', 'pending'],
      ['b', 'pending'],
      ['c', 'pending'],
    ]);

    // The checklist advances monotonically; the last step-bearing event shows a,b
    // done and c active.
    const stepped = jobs.filter((j) => j.progress.steps?.some((s) => s.status !== 'pending'));
    expect(stepPairs(stepped.at(-1)?.progress.steps)).toEqual([
      ['a', 'done'],
      ['b', 'done'],
      ['c', 'active'],
    ]);

    // Terminal (succeeded) progress event first, THEN the notification event.
    expect(jobs.some((j) => j.status === 'succeeded')).toBe(true);
    expect(published.at(-1)?.event.type).toBe('notification');
  });

  it('a silent outcome (notification null) succeeds without posting a notification', async () => {
    const rt = runtime();
    const job = await rt.jobStore.create({ org: ORG, type: 'test.job', key: 'test.job:quiet' });

    const def: JobDefinition<Payload, ErrorMeta> = {
      type: 'test.job',
      title: 'Testing',
      steps: [{ key: 'a', label: 'Step A' }],
      org: (p) => p.org,
      run: async (ctx) => {
        await ctx.phase('a');
        return { result: { quiet: true }, notification: null };
      },
      onError: (err) => ({ level: 'error', title: 'Failed', body: err.message }),
    };

    await executeJob(rt, def, { jobId: job.id, org: ORG });

    expect((await rt.jobStore.get(job.id))?.status).toBe('succeeded');
    expect(await rt.notifications.listForOrg(ORG)).toHaveLength(0);
    expect(published.some((p) => p.event.type === 'notification')).toBe(false);
  });

  it('on failure: marks failed, posts the error notification, reports it, and rethrows', async () => {
    const rt = runtime();
    const job = await rt.jobStore.create({ org: ORG, type: 'test.job', key: 'test.job:err' });

    const def: JobDefinition<Payload, ErrorMeta> = {
      type: 'test.job',
      title: 'Testing',
      steps: [{ key: 'a', label: 'Step A' }],
      org: (p) => p.org,
      errorMeta: (_err, p) => ({ component: 'server', orgId: p.org }),
      run: async (ctx) => {
        await ctx.phase('a');
        throw new Error('boom');
      },
      onError: (err) => ({ level: 'error', title: 'Failed', body: 'It broke', data: { detail: err.message } }),
    };

    await expect(executeJob(rt, def, { jobId: job.id, org: ORG })).rejects.toThrow('boom');

    const failed = await rt.jobStore.get(job.id);
    expect(failed?.status).toBe('failed');
    expect(failed?.error).toBe('boom');

    const notes = await rt.notifications.listForOrg(ORG);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ level: 'error', title: 'Failed', body: 'It broke' });
    expect(notes[0]?.data).toMatchObject({ jobId: job.id, detail: 'boom' });

    // Reported once, with the definition's attribution.
    expect(captured).toHaveLength(1);
    expect(captured[0]?.meta).toEqual({ component: 'server', orgId: ORG });

    // A terminal (failed) progress event was emitted before the notification.
    expect(progressEvents().some((j) => j.status === 'failed')).toBe(true);
  });

  it('a definition with no errorMeta still reports, with no attribution', async () => {
    const rt = runtime();
    const job = await rt.jobStore.create({ org: ORG, type: 'test.job', key: 'test.job:bare' });

    await expect(
      executeJob(
        rt,
        {
          type: 'test.job',
          title: 'Testing',
          steps: [{ key: 'a', label: 'Step A' }],
          org: (p: Payload) => p.org,
          run: async () => {
            throw new Error('bare');
          },
          onError: (err: Error) => ({ level: 'error', title: 'Failed', body: err.message }),
        },
        { jobId: job.id, org: ORG },
      ),
    ).rejects.toThrow('bare');

    expect(captured).toEqual([{ err: expect.any(Error), meta: undefined }]);
  });
});

describe('executeJob — a job cancelled before it is claimed', () => {
  it('does not run the body, and leaves the row cancelled', async () => {
    const rt = runtime();
    const job = await rt.jobStore.create({ org: ORG, type: 'test.job', key: 'test.job:c' });
    await rt.jobStore.markCancelled(job.id);

    const run = vi.fn(async () => ({ notification: null }));
    await executeJob(
      rt,
      {
        type: 'test.job',
        title: 'Testing',
        steps: [{ key: 'a', label: 'Step A' }],
        org: (p: Payload) => p.org,
        run,
        onError: (err: Error) => ({ level: 'error', title: 'Failed', body: err.message }),
      },
      { jobId: job.id, org: ORG },
    );

    expect(run).not.toHaveBeenCalled();
    expect((await rt.jobStore.get(job.id))?.status).toBe('cancelled');
    expect(published).toEqual([]);
    expect(await rt.notifications.listForOrg(ORG)).toHaveLength(0);
  });
});

describe('executeJob — onSettled hook', () => {
  const settledDef = (
    onSettled: JobDefinition<Payload, ErrorMeta>['onSettled'],
    run: JobDefinition<Payload, ErrorMeta>['run'],
  ): JobDefinition<Payload, ErrorMeta> => ({
    type: 'test.job',
    title: 'Testing',
    steps: [{ key: 'a', label: 'Step A' }],
    org: (p) => p.org,
    onSettled,
    run,
    onError: (err) => ({ level: 'error', title: 'Failed', body: err.message }),
  });

  it('fires AFTER the row is terminal on success', async () => {
    const rt = runtime();
    const job = await rt.jobStore.create({ org: ORG, type: 'test.job', key: 'test.job:s' });

    let statusAtSettle: string | undefined;
    const settled = vi.fn(async () => {
      statusAtSettle = (await rt.jobStore.get(job.id))?.status;
    });

    await executeJob(rt, settledDef(settled, async () => ({ result: {}, notification: null })), {
      jobId: job.id,
      org: ORG,
    });

    expect(settled).toHaveBeenCalledTimes(1);
    expect(statusAtSettle).toBe('succeeded'); // terminal bookkeeping already done
    // The hook is told HOW the job settled AND what the run returned, so chains can
    // key off the outcome or the run's own result detail. A success passes the result.
    expect(settled).toHaveBeenCalledWith(expect.anything(), 'succeeded', {});
  });

  it('fires on failure, and the original error still rethrows', async () => {
    const rt = runtime();
    const job = await rt.jobStore.create({ org: ORG, type: 'test.job', key: 'test.job:f' });

    let statusAtSettle: string | undefined;
    const settled = vi.fn(async () => {
      statusAtSettle = (await rt.jobStore.get(job.id))?.status;
    });

    await expect(
      executeJob(
        rt,
        settledDef(settled, async () => {
          throw new Error('boom');
        }),
        { jobId: job.id, org: ORG },
      ),
    ).rejects.toThrow('boom');

    expect(settled).toHaveBeenCalledTimes(1);
    expect(statusAtSettle).toBe('failed');
    // A thrown run has no result, so the hook sees the outcome + undefined.
    expect(settled).toHaveBeenCalledWith(expect.anything(), 'failed', undefined);
  });

  it('is optional — a definition without onSettled still completes', async () => {
    const rt = runtime();
    const job = await rt.jobStore.create({ org: ORG, type: 'test.job', key: 'test.job:opt' });

    await executeJob(
      rt,
      settledDef(undefined, async () => ({ result: { ok: true }, notification: null })),
      { jobId: job.id, org: ORG },
    );

    expect((await rt.jobStore.get(job.id))?.status).toBe('succeeded');
  });
});
