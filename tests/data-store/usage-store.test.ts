/**
 * The usage store: a flush ADDS to the (job, subject) row rather than replacing
 * it, the row's interval widens to cover every flush, a run id only ever
 * arrives, the reads add up what the period holds, the trend buckets by day and
 * by week IN THE READER'S ZONE, a run's row is its whole job with the model that
 * did most of it, and one workspace never sees another's spend.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { jobs, schema, MIGRATIONS_DIR, type Db } from '@truecourse/db';
import type { UsageDelta } from '@truecourse/core/lib/usage-store';
import { PgUsageStore } from '../../packages/data-store/src/index';

const ORG = 'org_acme';
const OTHER = 'org_other';
const REPO = 'acme/widgets';

/** A period wide enough to hold everything a test writes. */
const ALL = { workspaceOrgId: ORG, from: '2026-01-01T00:00:00.000Z', to: '2027-01-01T00:00:00.000Z' };

let client: PGlite;
let db: Db;
let store: PgUsageStore;

function delta(over: Partial<UsageDelta> = {}): UsageDelta {
  return {
    workspaceOrgId: ORG,
    repoFullName: REPO,
    jobType: 'repo.guard-generate',
    jobId: 'job_1',
    runId: null,
    subjectKind: 'session',
    subject: 'guard-generate.flow-worker',
    provider: 'anthropic',
    model: 'claude-opus-5',
    inputTokens: 100,
    outputTokens: 10,
    cacheReadTokens: 1000,
    cacheCreateTokens: 50,
    calls: 1,
    costUsd: 0.25,
    startedAt: '2026-06-10T10:00:00.000Z',
    finishedAt: '2026-06-10T10:01:00.000Z',
    // A test that names only the total spent it all on input.
    inputCostUsd: over.costUsd ?? 0.25,
    outputCostUsd: 0,
    cachedCostUsd: 0,
    ...over,
  };
}

beforeEach(async () => {
  client = new PGlite();
  db = drizzle(client, { schema }) as unknown as Db;
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  store = new PgUsageStore(db);
});
afterEach(async () => {
  await client.close();
});

describe('PgUsageStore', () => {
  it('adds each flush onto the row and widens its interval', async () => {
    await store.record(delta());
    await store.record(
      delta({
        inputTokens: 5,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheCreateTokens: 0,
        calls: 2,
        costUsd: 0.1,
        model: 'claude-opus-5-1',
        startedAt: '2026-06-10T09:55:00.000Z',
        finishedAt: '2026-06-10T10:20:00.000Z',
      }),
    );

    const totals = await store.totals(ALL);
    expect(totals).toEqual({
      costUsd: 0.35,
      inputTokens: 105,
      outputTokens: 11,
      cacheReadTokens: 1000,
      cacheCreateTokens: 50,
      calls: 3,
      runs: 1,
    });
    const [run] = await store.runs(ALL, 10);
    // The interval covers both flushes, and the model is the newest seen.
    expect(run).toMatchObject({
      jobId: 'job_1',
      startedAt: '2026-06-10T09:55:00.000Z',
      finishedAt: '2026-06-10T10:20:00.000Z',
      model: 'claude-opus-5-1',
      // Each bucket on its own, and the four added up.
      inputTokens: 105,
      outputTokens: 11,
      cacheReadTokens: 1000,
      cacheCreateTokens: 50,
      tokens: 1166,
      calls: 3,
    });
  });

  it('keeps one row per subject and one run row per job', async () => {
    await store.record(delta({ subject: 'guard-generate.flow-worker', costUsd: 1 }));
    await store.record(delta({ subject: 'guard-generate.extract', costUsd: 2 }));
    await store.record(
      delta({ subjectKind: 'stage', subject: 'guard.recipe-propose', costUsd: 0.5 }),
    );

    expect((await store.totals(ALL)).costUsd).toBe(3.5);
    expect((await store.totals(ALL)).runs).toBe(1);
    const runs = await store.runs(ALL, 10);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.costUsd).toBe(3.5);
  });

  it('is readable while the run is still going', async () => {
    await store.record(delta({ costUsd: 0.4, calls: 1 }));
    expect((await store.totals(ALL)).costUsd).toBe(0.4);

    await store.record(delta({ costUsd: 0.6, calls: 1 }));
    expect((await store.totals(ALL)).costUsd).toBe(1);
    expect((await store.runs(ALL, 10))[0]!.outcome).toBeNull();
  });

  it('names the run on rows written before it opened, and never unnames it', async () => {
    await store.record(delta({ subject: 'a' }));
    await store.attachRun('job_1', 'run_7');
    await store.record(delta({ subject: 'a', runId: null }));
    await store.record(delta({ subject: 'b' }));

    const [run] = await store.runs(ALL, 10);
    expect(run!.runId).toBe('run_7');
    // A row written after the attach is still nameless until the next attach.
    await store.attachRun('job_1', 'run_7');
    expect((await store.runs(ALL, 10))[0]!.runId).toBe('run_7');
  });

  it('buckets the trend by day, and by week for a long period', async () => {
    await store.record(delta({ jobId: 'j1', startedAt: '2026-06-01T08:00:00.000Z', costUsd: 1 }));
    await store.record(delta({ jobId: 'j2', startedAt: '2026-06-01T20:00:00.000Z', costUsd: 2 }));
    await store.record(
      delta({
        jobId: 'j3',
        jobType: 'context.scan',
        repoFullName: null,
        startedAt: '2026-06-03T08:00:00.000Z',
        costUsd: 4,
        inputCostUsd: 1,
        outputCostUsd: 2,
        cachedCostUsd: 1,
      }),
    );

    const days = await store.series(ALL, 'day');
    expect(days).toEqual([
      // The four stored buckets per point, never summed into one, and the
      // cost by kind beside the total.
      {
        at: '2026-06-01',
        jobType: 'repo.guard-generate',
        costUsd: 3,
        inputCostUsd: 3,
        outputCostUsd: 0,
        cachedCostUsd: 0,
        inputTokens: 200,
        outputTokens: 20,
        cacheReadTokens: 2000,
        cacheCreateTokens: 100,
      },
      {
        at: '2026-06-03',
        jobType: 'context.scan',
        costUsd: 4,
        inputCostUsd: 1,
        outputCostUsd: 2,
        cachedCostUsd: 1,
        inputTokens: 100,
        outputTokens: 10,
        cacheReadTokens: 1000,
        cacheCreateTokens: 50,
      },
    ]);

    // June 1 2026 is a Monday, so both days fall in the one week bucket.
    const weeks = await store.series(ALL, 'week');
    expect(weeks.map((row) => row.at)).toEqual(['2026-06-01', '2026-06-01']);
    expect(weeks.reduce((sum, row) => sum + row.costUsd, 0)).toBe(7);
  });

  it('files a day where the READER is, and in UTC when nobody said where', async () => {
    // 03:17 UTC on the 17th is 20:17 on the 16th in California, and already
    // midday on the 17th in Tokyo.
    await store.record(delta({ jobId: 'j1', startedAt: '2026-09-17T03:17:00.000Z' }));

    const day = async (timeZone?: string): Promise<string[]> =>
      (await store.series({ ...ALL, ...(timeZone ? { timeZone } : {}) }, 'day')).map((row) => row.at);

    expect(await day('America/Los_Angeles')).toEqual(['2026-09-16']);
    expect(await day('UTC')).toEqual(['2026-09-17']);
    expect(await day('Asia/Tokyo')).toEqual(['2026-09-17']);
    expect(await day()).toEqual(['2026-09-17']);
  });

  it('cuts the week at the reader’s Monday', async () => {
    // Monday 03:17 UTC is still Sunday evening in California, which belongs to
    // the week before where they are.
    await store.record(delta({ jobId: 'w1', startedAt: '2026-09-14T03:17:00.000Z' }));

    const week = async (timeZone: string): Promise<string[]> =>
      (await store.series({ ...ALL, timeZone }, 'week')).map((row) => row.at);

    expect(await week('America/Los_Angeles')).toEqual(['2026-09-07']);
    expect(await week('UTC')).toEqual(['2026-09-14']);
  });

  it('answers the runs list newest first, with the job outcome and the busiest model', async () => {
    await db.insert(jobs).values({
      id: 'job_old',
      workspaceOrgId: ORG,
      type: 'repo.guard-generate',
      key: null,
      status: 'failed',
      progressCurrent: 0,
      progressTotal: 0,
      progressMessage: null,
      result: null,
      error: 'it broke',
      createdAt: '2026-06-01T00:00:00.000Z',
      startedAt: '2026-06-01T00:00:00.000Z',
      finishedAt: '2026-06-01T01:00:00.000Z',
      payload: null,
    });
    await store.record(
      delta({ jobId: 'job_old', subject: 'a', model: 'small', inputTokens: 1, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0, startedAt: '2026-06-01T00:10:00.000Z', finishedAt: '2026-06-01T00:20:00.000Z' }),
    );
    await store.record(
      delta({ jobId: 'job_old', subject: 'b', model: 'big', inputTokens: 900, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0, startedAt: '2026-06-01T00:15:00.000Z', finishedAt: '2026-06-01T00:30:00.000Z' }),
    );
    await store.record(delta({ jobId: 'job_new', startedAt: '2026-06-09T00:00:00.000Z', finishedAt: '2026-06-09T00:05:00.000Z' }));

    const runs = await store.runs(ALL, 10);
    expect(runs.map((row) => row.jobId)).toEqual(['job_new', 'job_old']);
    expect(runs[1]).toMatchObject({
      outcome: 'failed',
      model: 'big',
      startedAt: '2026-06-01T00:10:00.000Z',
      finishedAt: '2026-06-01T00:30:00.000Z',
    });
    // A job with no queue row left is still a run that spent.
    expect(runs[0]!.outcome).toBeNull();
    expect(await store.runs(ALL, 1)).toHaveLength(1);
  });

  it('narrows by repository and by job type, and faceting ignores both', async () => {
    await store.record(delta({ jobId: 'j1', repoFullName: 'acme/a', jobType: 'repo.guard-setup', costUsd: 1 }));
    await store.record(delta({ jobId: 'j2', repoFullName: 'acme/b', jobType: 'repo.guard-setup', costUsd: 2 }));
    await store.record(delta({ jobId: 'j3', repoFullName: 'acme/a', jobType: 'repo.guard-run', costUsd: 4 }));
    await store.record(delta({ jobId: 'j4', repoFullName: null, jobType: 'context.scan', costUsd: 8 }));

    expect((await store.totals({ ...ALL, repoFullName: 'acme/a' })).costUsd).toBe(5);
    expect((await store.totals({ ...ALL, jobType: 'repo.guard-setup' })).costUsd).toBe(3);
    expect(
      (await store.totals({ ...ALL, repoFullName: 'acme/a', jobType: 'repo.guard-run' })).costUsd,
    ).toBe(4);

    const facets = await store.facets({ ...ALL, repoFullName: 'acme/a', jobType: 'context.scan' });
    expect(facets.map((cell) => `${cell.repoFullName ?? '-'}:${cell.jobType}:${cell.runs}`).sort()).toEqual([
      '-:context.scan:1',
      'acme/a:repo.guard-run:1',
      'acme/a:repo.guard-setup:1',
      'acme/b:repo.guard-setup:1',
    ]);
  });

  it('holds the period open at its start and shut at its end', async () => {
    await store.record(delta({ jobId: 'j1', startedAt: '2026-06-01T00:00:00.000Z' }));
    await store.record(delta({ jobId: 'j2', startedAt: '2026-06-08T00:00:00.000Z' }));

    const window = { workspaceOrgId: ORG, from: '2026-06-01T00:00:00.000Z', to: '2026-06-08T00:00:00.000Z' };
    expect((await store.totals(window)).runs).toBe(1);
    expect((await store.runs(window, 10)).map((row) => row.jobId)).toEqual(['j1']);
  });

  it('keeps one workspace out of another', async () => {
    await store.record(delta({ jobId: 'mine', costUsd: 1 }));
    await store.record(delta({ jobId: 'theirs', workspaceOrgId: OTHER, costUsd: 9 }));

    expect((await store.totals(ALL)).costUsd).toBe(1);
    expect((await store.runs(ALL, 10)).map((row) => row.jobId)).toEqual(['mine']);
    expect(await store.since(ORG)).toBe('2026-06-10T10:00:00.000Z');
    expect(await store.since('org_empty')).toBeNull();
  });
});
