import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type EeDb } from '@truecourse/ee-db';
import type { ServerEvent } from '@truecourse/shared';
import { JobStore, NotificationStore } from '../../ee/packages/data-store/src/index';

// Observe the harness's two side-channels — the live SSE events and the Sentry
// captures — by mocking its collaborators (hoisted so the mock factories can push
// into these before the harness module loads).
const published = vi.hoisted(() => [] as Array<{ org: string; event: ServerEvent }>);
const captured = vi.hoisted(() => [] as Array<{ err: unknown; ctx: Record<string, unknown> }>);

vi.mock('../../ee/packages/server/src/jobs/events', () => ({
  publishEvent: async (_db: unknown, org: string, event: ServerEvent) => {
    published.push({ org, event });
  },
}));
vi.mock('../../ee/packages/server/src/observability/sentry', () => ({
  captureEeException: (err: unknown, ctx: Record<string, unknown>) => {
    captured.push({ err, ctx });
  },
  upstreamStatusOf: () => undefined,
}));

import { executeJob, type JobDefinition } from '../../ee/packages/server/src/jobs/harness';

const ORG = 'org_A';
type Payload = { jobId: string; org: string };

let client: PGlite;
let db: EeDb;

beforeEach(async () => {
  client = new PGlite();
  db = drizzle(client, { schema }) as unknown as EeDb;
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  published.length = 0;
  captured.length = 0;
});

afterEach(async () => {
  await client.close();
});

// Convenience view of the job.progress events.
const progressEvents = () =>
  published.filter((p) => p.event.type === 'job.progress').map((p) => (p.event as any).job);

describe('executeJob — shared lifecycle envelope', () => {
  it('seeds the full checklist, advances it, succeeds, and posts a success notification', async () => {
    const jobStore = new JobStore(db);
    const notifications = new NotificationStore(db);
    const job = await jobStore.create({ org: ORG, type: 'test.job', key: 'test.job:1' });

    const def: JobDefinition<Payload> = {
      type: 'test.job',
      title: 'Testing',
      steps: [
        { key: 'a', label: 'Step A' },
        { key: 'b', label: 'Step B' },
        { key: 'c', label: 'Step C' },
      ],
      org: (p) => p.org,
      sentry: () => ({ component: 'server', route: 'test' }),
      run: async (ctx) => {
        await ctx.phase('a');
        await ctx.phase('b');
        await ctx.phase('c');
        return { result: { ok: true }, notification: { level: 'success', title: 'Done', body: 'All good' } };
      },
      onError: (err) => ({ level: 'error', title: 'Failed', body: err.message }),
    };

    await executeJob({ db, jobStore, notifications }, def, { jobId: job.id, org: ORG });

    // Terminal row state + result.
    const done = await jobStore.get(job.id);
    expect(done?.status).toBe('succeeded');
    expect(done?.result).toEqual({ ok: true });

    // Durable success notification, with jobId injected into data.
    const notes = await notifications.listForOrg(ORG);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ kind: 'test.job', level: 'success', title: 'Done', body: 'All good' });
    expect(notes[0]?.data).toMatchObject({ jobId: job.id });

    // Every job.progress event carries the display title (client shows it verbatim).
    const jobs = progressEvents();
    expect(jobs.every((j) => j.title === 'Testing')).toBe(true);

    // The FIRST event (running) seeds the WHOLE plan, all pending.
    expect(jobs[0].status).toBe('running');
    expect(jobs[0].progress.steps.map((s: any) => [s.key, s.status])).toEqual([
      ['a', 'pending'],
      ['b', 'pending'],
      ['c', 'pending'],
    ]);

    // The checklist advances monotonically; the last step-bearing event shows a,b
    // done and c active.
    const stepped = jobs.filter((j) => j.progress.steps?.some((s: any) => s.status !== 'pending'));
    expect(stepped.at(-1)!.progress.steps.map((s: any) => [s.key, s.status])).toEqual([
      ['a', 'done'],
      ['b', 'done'],
      ['c', 'active'],
    ]);

    // Terminal (succeeded) progress event first, THEN the notification event.
    expect(jobs.some((j) => j.status === 'succeeded')).toBe(true);
    expect(published.at(-1)!.event.type).toBe('notification');
  });

  it('a silent outcome (notification null) succeeds without posting a notification', async () => {
    const jobStore = new JobStore(db);
    const notifications = new NotificationStore(db);
    const job = await jobStore.create({ org: ORG, type: 'test.job', key: 'test.job:quiet' });

    const def: JobDefinition<Payload> = {
      type: 'test.job',
      title: 'Testing',
      steps: [{ key: 'a', label: 'Step A' }],
      org: (p) => p.org,
      sentry: () => ({ component: 'server', route: 'test' }),
      run: async (ctx) => {
        await ctx.phase('a');
        return { result: { quiet: true }, notification: null };
      },
      onError: (err) => ({ level: 'error', title: 'Failed', body: err.message }),
    };

    await executeJob({ db, jobStore, notifications }, def, { jobId: job.id, org: ORG });

    expect((await jobStore.get(job.id))?.status).toBe('succeeded');
    expect(await notifications.listForOrg(ORG)).toHaveLength(0);
    expect(published.some((p) => p.event.type === 'notification')).toBe(false);
  });

  it('on failure: marks failed, posts the error notification, captures to Sentry, and rethrows', async () => {
    const jobStore = new JobStore(db);
    const notifications = new NotificationStore(db);
    const job = await jobStore.create({ org: ORG, type: 'test.job', key: 'test.job:err' });

    const def: JobDefinition<Payload> = {
      type: 'test.job',
      title: 'Testing',
      steps: [{ key: 'a', label: 'Step A' }],
      org: (p) => p.org,
      sentry: (_err, p) => ({ component: 'server', orgId: p.org, route: 'test' }),
      run: async (ctx) => {
        await ctx.phase('a');
        throw new Error('boom');
      },
      onError: (err) => ({ level: 'error', title: 'Failed', body: 'It broke', data: { detail: err.message } }),
    };

    await expect(
      executeJob({ db, jobStore, notifications }, def, { jobId: job.id, org: ORG }),
    ).rejects.toThrow('boom');

    const failed = await jobStore.get(job.id);
    expect(failed?.status).toBe('failed');
    expect(failed?.error).toBe('boom');

    const notes = await notifications.listForOrg(ORG);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ level: 'error', title: 'Failed', body: 'It broke' });
    expect(notes[0]?.data).toMatchObject({ jobId: job.id, detail: 'boom' });

    // Sentry captured once, with the definition's attribution.
    expect(captured).toHaveLength(1);
    expect(captured[0].ctx.component).toBe('server');
    expect(captured[0].ctx.orgId).toBe(ORG);

    // A terminal (failed) progress event was emitted before the notification.
    expect(progressEvents().some((j) => j.status === 'failed')).toBe(true);
  });
});
