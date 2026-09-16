/**
 * The PAUSE as a job outcome: a body that ran out of credits is not a body that
 * failed.
 *
 * What is pinned: the row settles `paused` carrying the reason and the resume
 * pointer the body declared, the feed says so as news rather than an error, the
 * deployment's error sink hears nothing, the throw is not re-raised (there is
 * nothing to retry), the settle hook is told `paused` so a chain does not fire,
 * and the row frees its single-flight key so the same job can be enqueued again.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type Db } from '@truecourse/db';
import type { ServerEvent } from '@truecourse/shared';
import { JobStore, NotificationStore } from '@truecourse/data-store';
import {
  executeJob,
  type JobDefinition,
  type JobOutcomeStatus,
  type JobRuntime,
  type JobSettledInfo,
} from '@truecourse/jobs';
import { CreditsExhaustedError } from '../../packages/core/src/lib/credits-store';

const ORG = 'org_A';
type Payload = { jobId: string; org: string };

let client: PGlite;
let db: Db;
let published: Array<{ org: string; event: ServerEvent }>;
let captured: unknown[];
let settled: JobSettledInfo[];

beforeEach(async () => {
  client = new PGlite();
  db = drizzle(client, { schema }) as unknown as Db;
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  published = [];
  captured = [];
  settled = [];
});

afterEach(async () => {
  await client.close();
});

function runtime(): JobRuntime & { jobStore: JobStore; notifications: NotificationStore } {
  return {
    db,
    jobStore: new JobStore(db),
    notifications: new NotificationStore(db),
    publish: async (org, event) => {
      published.push({ org, event });
    },
    onException: (err) => {
      captured.push(err);
    },
    onSettled: (info) => {
      settled.push(info);
    },
  };
}

/** A job whose body stops the way an empty balance stops one. */
function pausingJob(
  run: JobDefinition<Payload>['run'],
  onSettledSeen: JobOutcomeStatus[] = [],
): JobDefinition<Payload> {
  return {
    type: 'repo.guard-generate',
    title: 'Generating scenarios',
    steps: [{ key: 'clone', label: 'Cloning repository' }],
    org: () => ORG,
    traceMeta: () => ({ repoFullName: 'acme/api' }),
    run,
    onError: () => ({ level: 'error', title: 'Flow generation failed' }),
    onSettled: async (_ctx, outcome) => {
      onSettledSeen.push(outcome);
    },
  };
}

describe('a job that ran out of credits', () => {
  it('settles paused with the reason and the resume pointer its body declared', async () => {
    const rt = runtime();
    const job = await rt.jobStore.create({
      org: ORG,
      type: 'repo.guard-generate',
      key: 'repo.guard-generate:acme/api',
      payload: { repoFullName: 'acme/api', workspaceOrgId: ORG },
    });
    const seen: JobOutcomeStatus[] = [];
    const def = pausingJob(async (ctx) => {
      ctx.resumeWith({ resumeRunId: 'run_77' });
      throw new CreditsExhaustedError(ORG, 0);
    }, seen);

    // A pause is not a failure, so nothing is re-raised for the queue to retry.
    await expect(executeJob(rt, def, { jobId: job.id, org: ORG })).resolves.toBeUndefined();

    const row = await rt.jobStore.get(job.id);
    expect(row?.status).toBe('paused');
    expect(row?.pauseReason).toBe('credits');
    expect(row?.error).toBeNull();
    expect(row?.finishedAt).toBeTruthy();
    expect(captured).toEqual([]);
    expect(seen).toEqual(['paused']);
    expect(settled.map((info) => info.outcome)).toEqual(['paused']);

    // The stored payload is what a resume re-enqueues: identity plus the pointer.
    const [stored] = await db.query.jobs.findMany();
    expect(stored?.payload).toEqual({
      repoFullName: 'acme/api',
      workspaceOrgId: ORG,
      resumeRunId: 'run_77',
    });
  });

  it('posts one warning naming where credits come from, and no error toast', async () => {
    const rt = runtime();
    const job = await rt.jobStore.create({ org: ORG, type: 'repo.guard-generate', key: 'k' });
    await executeJob(
      rt,
      pausingJob(async () => {
        throw new CreditsExhaustedError(ORG, 0);
      }),
      { jobId: job.id, org: ORG },
    );

    const notes = await rt.notifications.listForOrg(ORG);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ level: 'warning', title: 'Paused, out of credits' });
    expect(notes[0]?.data).toMatchObject({ reason: 'credits', href: '/settings/credits' });
    expect(notes[0]?.body).toContain('Generating scenarios');
  });

  it('moves the row the job posted when it began rather than adding a second', async () => {
    const rt = runtime();
    const job = await rt.jobStore.create({ org: ORG, type: 'repo.guard-generate', key: 'k' });
    await executeJob(
      rt,
      pausingJob(async (ctx) => {
        await ctx.notify({ level: 'started', title: 'Flow generation started' });
        throw new CreditsExhaustedError(ORG, 0);
      }),
      { jobId: job.id, org: ORG },
    );
    const notes = await rt.notifications.listForOrg(ORG);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.title).toBe('Paused, out of credits');
  });

  it('is told apart from a cancel: a body stopped for money is not a body stopped by a person', async () => {
    const rt = runtime();
    const job = await rt.jobStore.create({ org: ORG, type: 'repo.guard-generate', key: 'k' });
    const controller = new AbortController();
    await executeJob(
      rt,
      pausingJob(async () => {
        controller.abort();
        throw new CreditsExhaustedError(ORG, 0);
      }),
      { jobId: job.id, org: ORG },
      { signal: controller.signal },
    );
    expect((await rt.jobStore.get(job.id))?.status).toBe('paused');
  });

  it('frees the single-flight key, so the paused job can be enqueued again', async () => {
    const rt = runtime();
    const key = 'repo.guard-generate:acme/api';
    const job = await rt.jobStore.create({ org: ORG, type: 'repo.guard-generate', key });
    await executeJob(
      rt,
      pausingJob(async () => {
        throw new CreditsExhaustedError(ORG, 0);
      }),
      { jobId: job.id, org: ORG },
    );
    expect(await rt.jobStore.getActiveByKey(ORG, key)).toBeNull();
    const again = await rt.jobStore.create({ org: ORG, type: 'repo.guard-generate', key });
    expect(again.status).toBe('queued');
  });

  it('is still a failure when the body failed for anything else', async () => {
    const rt = runtime();
    const job = await rt.jobStore.create({ org: ORG, type: 'repo.guard-generate', key: 'k' });
    await expect(
      executeJob(
        rt,
        pausingJob(async () => {
          throw new Error('the clone died');
        }),
        { jobId: job.id, org: ORG },
      ),
    ).rejects.toThrow('the clone died');
    const row = await rt.jobStore.get(job.id);
    expect(row?.status).toBe('failed');
    expect(row?.pauseReason).toBeNull();
    expect(captured).toHaveLength(1);
  });
});

describe('the paused rows a resume reads', () => {
  it('lists them oldest first and drops the ones already carried on', async () => {
    const store = new JobStore(db);
    const first = await store.create({ org: ORG, type: 'context.scan', key: 'a', payload: { a: 1 } });
    const second = await store.create({ org: ORG, type: 'repo.guard-run', key: 'b', payload: { b: 2 } });
    await store.markRunning(first.id);
    await store.markPaused(first.id, { reason: 'credits' });
    await store.markRunning(second.id);
    await store.markPaused(second.id, { reason: 'credits', resume: { resumeRunId: 'run_9' } });

    const paused = await store.listPaused(ORG);
    expect(paused.map((row) => row.type)).toEqual(['context.scan', 'repo.guard-run']);
    expect(paused[1]?.payload).toEqual({ b: 2, resumeRunId: 'run_9' });
    expect(paused[0]?.reason).toBe('credits');

    await store.markResumed(first.id, 'job_new');
    expect((await store.listPaused(ORG)).map((row) => row.type)).toEqual(['repo.guard-run']);
    expect(await store.pausedCounts([ORG, 'org_B'])).toEqual(new Map([[ORG, 1]]));
  });

  it('only pauses a row that was still active', async () => {
    const store = new JobStore(db);
    const job = await store.create({ org: ORG, type: 'context.scan', key: 'a' });
    await store.markRunning(job.id);
    await store.markSucceeded(job.id, {});
    expect(await store.markPaused(job.id, { reason: 'credits' })).toBeNull();
    expect((await store.get(job.id))?.status).toBe('succeeded');
  });

  it('leaves paused rows alone when a restart reaps what it abandoned', async () => {
    const store = new JobStore(db);
    const job = await store.create({ org: ORG, type: 'context.scan', key: 'a' });
    await store.markRunning(job.id);
    await store.markPaused(job.id, { reason: 'credits' });
    await store.interruptOrphaned();
    expect((await store.get(job.id))?.status).toBe('paused');
  });
});
