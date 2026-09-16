/**
 * The usage query service: how a period resolves, how the trend's buckets are
 * filled, how a stored row becomes a named and addressable row of the page, and
 * what the two filters offer.
 *
 * The period is what most of this is about: a named period is whole UTC days
 * ending today, a custom one is what it says (its last day included), and a
 * period long enough that a point per day is unreadable buckets by week.
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
  it('is whole UTC days ending today', () => {
    expect(resolveUsagePeriod(request({ period: '7d' }), NOW)).toEqual({
      key: '7d',
      from: '2026-06-09T00:00:00.000Z',
      to: '2026-06-16T00:00:00.000Z',
      bucket: 'day',
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
      calls: 3,
      runs: 1,
    });
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
    expect(series[0]).toEqual({ at: '2026-06-09', costUsd: 0, tokens: 0, byJobType: {} });
    expect(series[5]).toEqual({
      at: '2026-06-14',
      costUsd: 5,
      tokens: 2200,
      byJobType: {
        'repo.guard-generate': { costUsd: 2, tokens: 1100 },
        'context.scan': { costUsd: 3, tokens: 1100 },
      },
    });
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
