/**
 * `GET /api/usage`, the whole Usage page in one answer.
 *
 * What is pinned here is what the ADDRESS means: the default period, a stale
 * period word falling back rather than refusing, a custom range refused when it
 * cannot be read, `tz` cutting the period and the trend into the reader's own
 * days, a repository named by its slug — and another workspace's repository, or
 * one this workspace never connected, answering not found rather than someone
 * else's spend.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

vi.mock('../../apps/dashboard/server/src/socket/handlers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../apps/dashboard/server/src/socket/handlers')>();
  return {
    ...actual,
    emitSpecProgress: vi.fn(),
    emitSpecComplete: vi.fn(),
    createSocketSpecTracker: () => ({ start() {}, done() {}, error() {}, detail() {} }),
  };
});

import type { UsageResponse } from '@truecourse/shared';
import type { UsageDelta } from '@truecourse/core/lib/usage-store';
import { createTestApp, resetTestWorkspaceLlm, TEST_ORG } from '../helpers/test-app';
import {
  clearTestRegistry,
  setupTestFixture,
  teardownTestFixture,
  type TestFixture,
} from '../helpers/test-fixture';
import { installUsageStore, type InstalledUsageStore } from '../helpers/usage-store';

const OTHER_ORG = 'org_other';

let app: Express;
let repo: TestFixture;
let installed: InstalledUsageStore;

/** Minutes back from now, so every seeded row sits inside the default period. */
const minutesAgo = (minutes: number): string =>
  new Date(Date.now() - minutes * 60_000).toISOString();

/** How a zone reads an instant, as `YYYY-MM-DD HH:mm`. */
function wallIn(timeZone: string, at: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(at);
  const of = (type: string): string => parts.find((part) => part.type === type)!.value;
  return `${of('year')}-${of('month')}-${of('day')} ${of('hour')}:${of('minute')}`;
}

/** The day a zone is having right now, as the trend's right edge spells it. */
const today = (timeZone: string): string => wallIn(timeZone, new Date()).slice(0, 10);

/** The day after one, by the calendar and nothing else. */
function nextDay(day: string): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, date + 1)).toISOString().slice(0, 10);
}

function delta(over: Partial<UsageDelta> = {}): UsageDelta {
  return {
    workspaceOrgId: TEST_ORG,
    repoFullName: repo.project.name,
    jobType: 'repo.guard-generate',
    jobId: 'job_1',
    runId: 'run_1',
    subjectKind: 'session',
    subject: 'guard-generate.flow-worker',
    provider: 'anthropic',
    model: 'claude-opus-5',
    inputTokens: 1000,
    outputTokens: 200,
    cacheReadTokens: 0,
    cacheCreateTokens: 0,
    calls: 2,
    costUsd: 1.5,
    startedAt: minutesAgo(30),
    finishedAt: minutesAgo(20),
    ...over,
  };
}

beforeEach(async () => {
  installed = await installUsageStore();
  repo = await setupTestFixture();
  app = createTestApp();
});

afterEach(async () => {
  await teardownTestFixture(repo.project.slug);
  clearTestRegistry();
  resetTestWorkspaceLlm();
  await installed.close();
  vi.restoreAllMocks();
});

describe('GET /api/usage', () => {
  it('answers the last 30 days by default, with the run that spent them', async () => {
    await installed.store.record(delta());

    const res = await request(app).get('/api/usage');

    expect(res.status).toBe(200);
    const body = res.body as UsageResponse;
    expect(body.period.key).toBe('30d');
    expect(body.period.bucket).toBe('day');
    expect(body.totals).toMatchObject({ costUsd: 1.5, tokens: 1200, calls: 2, runs: 1 });
    expect(body.series).toHaveLength(30);
    expect(body.runs).toHaveLength(1);
    expect(body.runs[0]).toMatchObject({
      jobId: 'job_1',
      runId: 'run_1',
      title: 'Flow generation',
      repository: repo.project.name,
      repoId: repo.project.slug,
    });
    expect(body.repositories).toEqual([
      { value: repo.project.slug, label: repo.project.name, count: 1, total: 1 },
    ]);
    expect(body.jobTypes).toEqual([
      { value: 'repo.guard-generate', label: 'Flow generation', count: 1, total: 1 },
    ]);
  });

  it('honours the period and buckets a long one by week', async () => {
    const res = await request(app).get('/api/usage?period=90d');

    expect(res.status).toBe(200);
    expect((res.body as UsageResponse).period).toMatchObject({ key: '90d', bucket: 'week' });
  });

  it('falls back to the default for a period word it does not know', async () => {
    const res = await request(app).get('/api/usage?period=forever');

    expect(res.status).toBe(200);
    expect((res.body as UsageResponse).period.key).toBe('30d');
  });

  it('cuts the trend into the reader’s days, and into UTC’s for a zone it does not know', async () => {
    await installed.store.record(delta());

    const west = await request(app).get('/api/usage?period=7d&tz=America%2FLos_Angeles');
    expect(west.status).toBe(200);
    const body = west.body as UsageResponse;
    // The right edge is their today, and the period ends at midnight there.
    expect(body.series[body.series.length - 1]!.at).toBe(today('America/Los_Angeles'));
    expect(wallIn('America/Los_Angeles', new Date(body.period.to))).toBe(
      `${nextDay(today('America/Los_Angeles'))} 00:00`,
    );

    // A zone neither Postgres nor Intl has never reaches the query: the read
    // answers, in UTC's days.
    const nowhere = await request(app).get('/api/usage?period=7d&tz=Mars%2FOlympus');
    expect(nowhere.status).toBe(200);
    const fallback = nowhere.body as UsageResponse;
    expect(fallback.series[fallback.series.length - 1]!.at).toBe(today('UTC'));
    expect(fallback.period).toEqual(
      ((await request(app).get('/api/usage?period=7d')).body as UsageResponse).period,
    );
  });

  it('refuses a custom range it cannot read', async () => {
    const res = await request(app).get('/api/usage?period=custom&from=yesterday&to=today');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/YYYY-MM-DD/);
  });

  it('narrows to one repository by its slug', async () => {
    await installed.store.record(delta({ jobId: 'mine', costUsd: 2 }));
    await installed.store.record(
      delta({ jobId: 'workspace', repoFullName: null, jobType: 'context.scan', costUsd: 5 }),
    );

    const all = await request(app).get('/api/usage');
    expect((all.body as UsageResponse).totals.costUsd).toBe(7);

    const one = await request(app).get(`/api/usage?repo=${repo.project.slug}`);
    expect(one.status).toBe(200);
    expect((one.body as UsageResponse).totals.costUsd).toBe(2);
    expect((one.body as UsageResponse).runs.map((row) => row.jobId)).toEqual(['mine']);
  });

  it('narrows to one job type, and refuses one that cannot spend', async () => {
    await installed.store.record(delta({ jobId: 'generate', costUsd: 2 }));
    await installed.store.record(
      delta({ jobId: 'setup', jobType: 'repo.guard-setup', costUsd: 4 }),
    );

    const one = await request(app).get('/api/usage?jobType=repo.guard-setup');
    expect((one.body as UsageResponse).totals.costUsd).toBe(4);

    const refused = await request(app).get('/api/usage?jobType=context.sync');
    expect(refused.status).toBe(400);
    expect(refused.body.error).toMatch(/Unknown job type/);
  });

  it('does not find a repository this workspace has not connected', async () => {
    const res = await request(app).get('/api/usage?repo=no-such-repo');

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/);
  });

  it('shows one workspace nothing of another', async () => {
    await installed.store.record(delta({ jobId: 'mine', costUsd: 1 }));
    await installed.store.record(
      delta({ jobId: 'theirs', workspaceOrgId: OTHER_ORG, costUsd: 99 }),
    );

    const res = await request(app).get('/api/usage');

    const body = res.body as UsageResponse;
    expect(body.totals.costUsd).toBe(1);
    expect(body.runs.map((row) => row.jobId)).toEqual(['mine']);
  });

  it('says when the record begins, and says nothing when nothing spent', async () => {
    const empty = await request(app).get('/api/usage');
    expect((empty.body as UsageResponse).since).toBeNull();
    expect((empty.body as UsageResponse).totals.runs).toBe(0);

    const at = minutesAgo(90);
    await installed.store.record(delta({ startedAt: at }));
    const seeded = await request(app).get('/api/usage');
    expect((seeded.body as UsageResponse).since).toBe(at);
  });
});
