/**
 * The usage query service: how a period resolves, how the trend's buckets are
 * filled, how a stored row becomes a named and addressable row of the page, and
 * what the two filters offer.
 *
 * The period is what most of this is about: a named period is whole days ending
 * today WHERE THE READER IS, a custom one is what it says in their days (its
 * last day included), and a period long enough that a point per day is
 * unreadable buckets by week. The zone they sent is the one the trend is cut
 * into, so the chart and the runs beneath it name the same day for the same run.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { RegistryEntry } from '@truecourse/core/config/registry';
import type { UsageDelta } from '@truecourse/core/lib/usage-store';
import {
  composeUsage,
  resolveUsagePeriod,
  usageFacets,
  usageQuery,
  usageRuns,
  usageSeries,
  usageTokenSplit,
  usageTotals,
  type UsageRequest,
} from '../../apps/dashboard/server/src/services/usage.service';
import { installUsageStore, type InstalledUsageStore } from '../helpers/usage-store';

const ORG = 'org_acme';
const NOW = new Date('2026-06-15T13:45:00.000Z');

const REPOS: RegistryEntry[] = [
  { slug: 'widgets', name: 'acme/widgets', path: 'acme/widgets', provider: 'github' },
  { slug: 'gadgets', name: 'acme/gadgets', path: 'acme/gadgets', provider: 'github' },
];

let installed: InstalledUsageStore;

function delta(over: Partial<UsageDelta> = {}): UsageDelta {
  return {
    workspaceOrgId: ORG,
    repoFullName: 'acme/widgets',
    jobType: 'repo.guard-generate',
    jobId: 'job_1',
    runId: 'run_1',
    subjectKind: 'session',
    subject: 'guard-generate.flow-worker',
    provider: 'anthropic',
    model: 'claude-opus-5',
    inputTokens: 1000,
    outputTokens: 100,
    cacheReadTokens: 0,
    cacheCreateTokens: 0,
    calls: 1,
    costUsd: 1,
    startedAt: '2026-06-14T10:00:00.000Z',
    finishedAt: '2026-06-14T10:10:00.000Z',
    // A test that names only the total spent it all on input.
    inputCostUsd: over.costUsd ?? 1,
    outputCostUsd: 0,
    cachedCostUsd: 0,
    ...over,
  };
}

const request = (over: Partial<UsageRequest> = {}): UsageRequest => ({
  workspaceOrgId: ORG,
  period: '30d',
  ...over,
});

beforeEach(async () => {
  installed = await installUsageStore();
});
afterEach(async () => {
  await installed.close();
});

describe('the usage period', () => {
  it('is whole UTC days ending today when nobody said where the reader is', () => {
    expect(resolveUsagePeriod(request({ period: '7d' }), NOW)).toEqual({
      key: '7d',
      from: '2026-06-09T00:00:00.000Z',
      to: '2026-06-16T00:00:00.000Z',
      bucket: 'day',
    });
  });

  it('is whole days of the reader’s own, ending at the end of their today', () => {
    // 13:45 UTC is 06:45 in California, so their today is still the 15th and
    // their period ends at midnight there, seven hours after UTC's.
    expect(resolveUsagePeriod(request({ period: '7d', timeZone: 'America/Los_Angeles' }), NOW)).toEqual({
      key: '7d',
      from: '2026-06-09T07:00:00.000Z',
      to: '2026-06-16T07:00:00.000Z',
      bucket: 'day',
    });
    // East of Greenwich the same instant is already the 15th's evening, and the
    // period ends nine hours before UTC's.
    expect(resolveUsagePeriod(request({ period: '7d', timeZone: 'Asia/Tokyo' }), NOW)).toMatchObject({
      from: '2026-06-08T15:00:00.000Z',
      to: '2026-06-15T15:00:00.000Z',
    });
  });

  it('takes a custom range as the reader’s days', () => {
    expect(
      resolveUsagePeriod(
        request({
          period: 'custom',
          from: '2026-05-01',
          to: '2026-05-03',
          timeZone: 'America/Los_Angeles',
        }),
        NOW,
      ),
    ).toMatchObject({ from: '2026-05-01T07:00:00.000Z', to: '2026-05-04T07:00:00.000Z' });
  });

  it('falls back to UTC for a zone neither Postgres nor Intl knows', () => {
    const utc = resolveUsagePeriod(request({ period: '7d' }), NOW);
    for (const timeZone of ['Mars/Olympus', 'Pacific/Los Angeles', "UTC'; drop table llm_usage --", '']) {
      expect(resolveUsagePeriod(request({ period: '7d', timeZone }), NOW)).toEqual(utc);
    }
  });

  it('walks a day the clocks move as one day, not as 24 hours', () => {
    // March 8 2026 is 23 hours long in California and November 1 is 25.
    const spring = resolveUsagePeriod(
      request({ period: 'custom', from: '2026-03-06', to: '2026-03-10', timeZone: 'America/Los_Angeles' }),
      NOW,
    );
    expect(spring).toMatchObject({
      from: '2026-03-06T08:00:00.000Z',
      to: '2026-03-11T07:00:00.000Z',
      bucket: 'day',
    });
    const autumn = resolveUsagePeriod(
      request({ period: 'custom', from: '2026-10-30', to: '2026-11-03', timeZone: 'America/Los_Angeles' }),
      NOW,
    );
    expect(autumn).toMatchObject({
      from: '2026-10-30T07:00:00.000Z',
      to: '2026-11-04T08:00:00.000Z',
    });
  });

  it('buckets by week once a point per day stops being readable', () => {
    expect(resolveUsagePeriod(request({ period: '30d' }), NOW).bucket).toBe('day');
    expect(resolveUsagePeriod(request({ period: '90d' }), NOW).bucket).toBe('week');
  });

  it('takes a custom range as two days, the last one included', () => {
    const period = resolveUsagePeriod(
      request({ period: 'custom', from: '2026-05-01', to: '2026-05-03' }),
      NOW,
    );
    expect(period).toEqual({
      key: 'custom',
      from: '2026-05-01T00:00:00.000Z',
      to: '2026-05-04T00:00:00.000Z',
      bucket: 'day',
    });
  });

  it('refuses a custom range that says nothing, runs backwards or asks for years', () => {
    expect(() => resolveUsagePeriod(request({ period: 'custom' }), NOW)).toThrow(/YYYY-MM-DD/);
    expect(() =>
      resolveUsagePeriod(request({ period: 'custom', from: '2026-05-09', to: '2026-05-01' }), NOW),
    ).toThrow(/ends before it begins/);
    expect(() =>
      resolveUsagePeriod(request({ period: 'custom', from: '2020-01-01', to: '2026-01-01' }), NOW),
    ).toThrow(/at most 366 days/);
  });
});

describe('the usage query', () => {
  it('resolves a repository slug and refuses one this workspace does not have', () => {
    const period = resolveUsagePeriod(request(), NOW);
    expect(usageQuery(request({ repo: 'widgets' }), period, REPOS).repoFullName).toBe('acme/widgets');
    expect(() => usageQuery(request({ repo: 'nope' }), period, REPOS)).toThrow(/not found/);
  });

  it('refuses a job type that cannot spend', () => {
    const period = resolveUsagePeriod(request(), NOW);
    expect(usageQuery(request({ jobType: 'context.scan' }), period, REPOS).jobType).toBe('context.scan');
    expect(() => usageQuery(request({ jobType: 'context.sync' }), period, REPOS)).toThrow(/Unknown job type/);
  });

  it('carries the reader’s zone, and only ever a zone that exists', () => {
    const period = resolveUsagePeriod(request(), NOW);
    expect(usageQuery(request({ timeZone: 'America/Los_Angeles' }), period, REPOS).timeZone).toBe(
      'America/Los_Angeles',
    );
    expect(usageQuery(request(), period, REPOS).timeZone).toBe('UTC');
    expect(usageQuery(request({ timeZone: 'Mars/Olympus' }), period, REPOS).timeZone).toBe('UTC');
  });
});

describe('the token split', () => {
  const buckets = (over: Partial<Parameters<typeof usageTokenSplit>[0]> = {}) => ({
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreateTokens: 0,
    ...over,
  });

  it('is the cached share of everything read', () => {
    expect(usageTokenSplit(buckets({ inputTokens: 3_000, outputTokens: 800, cacheReadTokens: 27_000 }))).toEqual({
      input: 3_000,
      output: 800,
      cached: 27_000,
      cacheHitRate: 0.9,
    });
  });

  it('counts a cache write as input read at full price, never as cached', () => {
    expect(
      usageTokenSplit(buckets({ inputTokens: 1_000, cacheCreateTokens: 4_000, cacheReadTokens: 5_000 })),
    ).toEqual({ input: 5_000, output: 0, cached: 5_000, cacheHitRate: 0.5 });
  });

  it('has no rate when nothing was cached at all, and a true zero when a written cache was never read', () => {
    expect(usageTokenSplit(buckets({ inputTokens: 1_000, outputTokens: 10 })).cacheHitRate).toBeNull();
    expect(usageTokenSplit(buckets()).cacheHitRate).toBeNull();
    expect(usageTokenSplit(buckets({ inputTokens: 1_000, cacheCreateTokens: 1_000 })).cacheHitRate).toBe(0);
  });
});

describe('the usage reads', () => {
  it('adds the period up, tokens and all', async () => {
    await installed.store.record(delta({ cacheReadTokens: 400, cacheCreateTokens: 50, calls: 3 }));
    const period = resolveUsagePeriod(request(), NOW);

    expect(await usageTotals(usageQuery(request(), period, REPOS))).toEqual({
      costUsd: 1,
      inputTokens: 1000,
      outputTokens: 100,
      cacheReadTokens: 400,
      cacheCreateTokens: 50,
      tokens: 1550,
      // A cache write is input; the hit rate is 400 of the 1,450 read.
      split: { input: 1050, output: 100, cached: 400, cacheHitRate: 400 / 1450 },
      calls: 3,
      runs: 1,
    });
  });

  it('carries each run’s own split, so one run can be set against another', async () => {
    await installed.store.record(
      delta({ jobId: 'cheap', inputTokens: 2_000, outputTokens: 500, cacheReadTokens: 28_000, cacheCreateTokens: 0 }),
    );
    await installed.store.record(
      delta({ jobId: 'dear', inputTokens: 20_000, outputTokens: 500, cacheReadTokens: 0, cacheCreateTokens: 0 }),
    );
    const period = resolveUsagePeriod(request(), NOW);

    const runs = await usageRuns(usageQuery(request(), period, REPOS), REPOS);
    const cheap = runs.find((row) => row.jobId === 'cheap')!;
    const dear = runs.find((row) => row.jobId === 'dear')!;
    // The cheap run is the bigger total; the split is what tells them apart.
    expect(cheap.tokens).toBeGreaterThan(dear.tokens);
    expect(cheap).toMatchObject({
      inputTokens: 2_000,
      outputTokens: 500,
      cacheReadTokens: 28_000,
      cacheCreateTokens: 0,
      tokens: 30_500,
      split: { input: 2_000, output: 500, cached: 28_000, cacheHitRate: 28_000 / 30_000 },
    });
    expect(dear.split).toEqual({ input: 20_000, output: 500, cached: 0, cacheHitRate: null });
  });

  it('fills every bucket of the period, gaps as zeros, split by job type', async () => {
    await installed.store.record(delta({ jobId: 'j1', startedAt: '2026-06-14T10:00:00.000Z', costUsd: 2 }));
    await installed.store.record(
      delta({
        jobId: 'j2',
        jobType: 'context.scan',
        repoFullName: null,
        startedAt: '2026-06-14T11:00:00.000Z',
        costUsd: 3,
        inputCostUsd: 1,
        outputCostUsd: 1.5,
        cachedCostUsd: 0.5,
        inputTokens: 20,
        outputTokens: 700,
        cacheReadTokens: 9000,
        cacheCreateTokens: 400,
      }),
    );
    const period = resolveUsagePeriod(request({ period: '7d' }), NOW);

    const series = await usageSeries(usageQuery(request({ period: '7d' }), period, REPOS), period);
    expect(series.map((point) => point.at)).toEqual([
      '2026-06-09',
      '2026-06-10',
      '2026-06-11',
      '2026-06-12',
      '2026-06-13',
      '2026-06-14',
      '2026-06-15',
    ]);
    expect(series[0]).toEqual({
      at: '2026-06-09',
      costUsd: 0,
      costByKind: { input: 0, output: 0, cached: 0 },
      input: 0,
      output: 0,
      cached: 0,
      byJobType: {},
    });
    // Every measure the chart can plot, per job type: a cache write is input,
    // a cache read is cached — the split the totals and the runs use — and the
    // cost split the same three ways.
    expect(series[5]).toEqual({
      at: '2026-06-14',
      costUsd: 5,
      costByKind: { input: 3, output: 1.5, cached: 0.5 },
      input: 1420,
      output: 800,
      cached: 9000,
      byJobType: {
        'repo.guard-generate': {
          costUsd: 2,
          costByKind: { input: 2, output: 0, cached: 0 },
          input: 1000,
          output: 100,
          cached: 0,
        },
        'context.scan': {
          costUsd: 3,
          costByKind: { input: 1, output: 1.5, cached: 0.5 },
          input: 420,
          output: 700,
          cached: 9000,
        },
      },
    });
  });

  it('fills the reader’s own days, and files an evening run on the day they had', async () => {
    // 03:17 UTC on the 16th is 20:17 on the 15th in California: their today,
    // and inside a period that ends at midnight where they are.
    await installed.store.record(
      delta({ jobId: 'evening', startedAt: '2026-06-16T03:17:00.000Z', costUsd: 2 }),
    );

    const west = request({ period: '7d', timeZone: 'America/Los_Angeles' });
    const period = resolveUsagePeriod(west, NOW);
    const series = await usageSeries(usageQuery(west, period, REPOS), period);
    expect(series.map((point) => point.at)).toEqual([
      '2026-06-09',
      '2026-06-10',
      '2026-06-11',
      '2026-06-12',
      '2026-06-13',
      '2026-06-14',
      '2026-06-15',
    ]);
    expect(series[6]).toMatchObject({ at: '2026-06-15', costUsd: 2 });

    // The same run read from UTC is tomorrow's, which is outside the period
    // altogether — the disagreement the reader's zone settles.
    const utc = request({ period: '7d' });
    const utcPeriod = resolveUsagePeriod(utc, NOW);
    const utcSeries = await usageSeries(usageQuery(utc, utcPeriod, REPOS), utcPeriod);
    expect(utcSeries[6]).toMatchObject({ at: '2026-06-15', costUsd: 0 });
  });

  it('keeps a point per day across a day the clocks move, and never two', async () => {
    // 23:30 on the day California springs forward, and 23:30 on the day it
    // falls back: both belong to the day the reader was living.
    await installed.store.record(
      delta({ jobId: 'spring', startedAt: '2026-03-09T06:30:00.000Z', costUsd: 1 }),
    );
    await installed.store.record(
      delta({ jobId: 'autumn', startedAt: '2026-11-02T07:30:00.000Z', costUsd: 3 }),
    );

    const days = (from: string, to: string): Promise<string[]> => {
      const asked = request({ period: 'custom', from, to, timeZone: 'America/Los_Angeles' });
      const period = resolveUsagePeriod(asked, NOW);
      return usageSeries(usageQuery(asked, period, REPOS), period).then((series) =>
        series.map((point) => point.at),
      );
    };

    const spring = await days('2026-03-06', '2026-03-10');
    expect(spring).toEqual(['2026-03-06', '2026-03-07', '2026-03-08', '2026-03-09', '2026-03-10']);
    const autumn = await days('2026-10-30', '2026-11-03');
    expect(autumn).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03']);

    // And what fell on those days is on them, so no point was drawn for a day
    // the store files its rows under a different label.
    const asked = request({
      period: 'custom',
      from: '2026-03-06',
      to: '2026-11-03',
      timeZone: 'America/Los_Angeles',
    });
    const period = resolveUsagePeriod(asked, NOW);
    const series = await usageSeries(usageQuery(asked, period, REPOS), period);
    expect(series.reduce((sum, point) => sum + point.costUsd, 0)).toBe(4);
  });

  it('cuts a long period into the reader’s weeks, each one their Monday', async () => {
    // Monday 03:17 UTC is Sunday evening in California, so their week is the
    // one that began on Monday June 8.
    await installed.store.record(
      delta({ jobId: 'w1', startedAt: '2026-06-15T03:17:00.000Z', costUsd: 3 }),
    );

    const west = request({ period: '90d', timeZone: 'America/Los_Angeles' });
    const period = resolveUsagePeriod(west, NOW);
    expect(period.bucket).toBe('week');

    const series = await usageSeries(usageQuery(west, period, REPOS), period);
    expect(series.filter((point) => point.costUsd > 0).map((point) => point.at)).toEqual([
      '2026-06-08',
    ]);
    // Nothing was dropped: every week the store answered had a point waiting.
    expect(series.reduce((sum, point) => sum + point.costUsd, 0)).toBe(3);
  });

  it('names and addresses each run, and leaves a disconnected repository unaddressed', async () => {
    await installed.store.record(delta({ jobId: 'j1' }));
    await installed.store.record(
      delta({ jobId: 'j2', repoFullName: 'acme/gone', runId: null, jobType: 'repo.guard-run' }),
    );
    const period = resolveUsagePeriod(request(), NOW);

    const runs = await usageRuns(usageQuery(request(), period, REPOS), REPOS);
    expect(runs).toHaveLength(2);
    const widgets = runs.find((row) => row.jobId === 'j1')!;
    expect(widgets).toMatchObject({
      title: 'Flow generation',
      repository: 'acme/widgets',
      repoId: 'widgets',
      runId: 'run_1',
      model: 'claude-opus-5',
      durationMs: 600_000,
    });
    const gone = runs.find((row) => row.jobId === 'j2')!;
    expect(gone).toMatchObject({ title: 'Flow run', repository: 'acme/gone', repoId: null, runId: null });
  });

  it('facets each dimension against the OTHER one, never against itself', async () => {
    await installed.store.record(delta({ jobId: 'j1', repoFullName: 'acme/widgets', jobType: 'repo.guard-setup' }));
    await installed.store.record(delta({ jobId: 'j2', repoFullName: 'acme/widgets', jobType: 'repo.guard-run' }));
    await installed.store.record(delta({ jobId: 'j3', repoFullName: 'acme/gadgets', jobType: 'repo.guard-setup' }));
    const period = resolveUsagePeriod(request(), NOW);

    const open = await usageFacets(usageQuery(request(), period, REPOS), REPOS);
    expect(open.repositories).toEqual([
      { value: 'gadgets', label: 'acme/gadgets', count: 1, total: 1 },
      { value: 'widgets', label: 'acme/widgets', count: 2, total: 2 },
    ]);
    expect(open.jobTypes).toEqual([
      { value: 'repo.guard-setup', label: 'Flow setup', count: 2, total: 2 },
      { value: 'repo.guard-run', label: 'Flow run', count: 1, total: 1 },
    ]);

    // With a job type picked, each repository says what it would leave — and
    // the job types keep saying what they hold, so swapping is legible.
    const narrowed = await usageFacets(
      usageQuery(request({ jobType: 'repo.guard-run' }), period, REPOS),
      REPOS,
    );
    expect(narrowed.repositories).toEqual([
      { value: 'gadgets', label: 'acme/gadgets', count: 0, total: 1 },
      { value: 'widgets', label: 'acme/widgets', count: 1, total: 2 },
    ]);
    expect(narrowed.jobTypes.map((facet) => facet.count)).toEqual([2, 1]);
  });

  it('composes the page, and the whole of it narrows together', async () => {
    await installed.store.record(delta({ jobId: 'j1', repoFullName: 'acme/widgets', costUsd: 2 }));
    await installed.store.record(delta({ jobId: 'j2', repoFullName: 'acme/gadgets', costUsd: 5 }));

    const all = await composeUsage(request(), REPOS, NOW);
    expect(all.totals.costUsd).toBe(7);
    expect(all.runs).toHaveLength(2);
    expect(all.since).toBe('2026-06-14T10:00:00.000Z');
    expect(all.period.key).toBe('30d');

    const one = await composeUsage(request({ repo: 'gadgets' }), REPOS, NOW);
    expect(one.totals.costUsd).toBe(5);
    expect(one.runs.map((row) => row.jobId)).toEqual(['j2']);
    expect(one.series.reduce((sum, point) => sum + point.costUsd, 0)).toBe(5);
  });

  it('leaves out what fell outside the period', async () => {
    await installed.store.record(delta({ jobId: 'old', startedAt: '2026-01-02T10:00:00.000Z' }));
    await installed.store.record(delta({ jobId: 'new' }));

    const answer = await composeUsage(request({ period: '7d' }), REPOS, NOW);
    expect(answer.runs.map((row) => row.jobId)).toEqual(['new']);
    // The record still begins where it begins, whatever the period shows.
    expect(answer.since).toBe('2026-01-02T10:00:00.000Z');
  });
});
