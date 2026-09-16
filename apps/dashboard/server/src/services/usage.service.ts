/**
 * Usage, composed: the one read behind Settings › Usage.
 *
 * Three shapes over the same slice — the period's TOTALS, the TREND bucketed by
 * day (or by week once the period is long enough that a day per point is
 * unreadable), and the RUNS that spent it — plus the two filters' values, with
 * the faceted counts a menu needs. Each is its own call on the store; this
 * module resolves the period, fills the buckets the store has nothing for, and
 * names what the store only keys (`owner/repo` becomes the slug a row opens by,
 * a job type becomes its word).
 *
 * The period is HALF-OPEN and anchored on whole UTC days: `7d` is the seven
 * calendar days ending today, so the trend's right edge is today and no point
 * is a fraction of a day.
 */

import { createAppError } from '@truecourse/core/lib/errors';
import type { RegistryEntry } from '@truecourse/core/config/registry';
import {
  readUsageFacets,
  readUsageRuns,
  readUsageSeries,
  readUsageTotals,
  usageSince,
  type UsageQuery,
} from '@truecourse/core/lib/usage-store';
import {
  USAGE_JOB_TYPES,
  USAGE_PERIODS,
  usageJobTypeWord,
  type UsageFacet,
  type UsagePeriod,
  type UsagePeriodView,
  type UsageResponse,
  type UsageRunRow,
  type UsageSeriesPoint,
  type UsageTotals,
} from '@truecourse/shared';

const DAY_MS = 86_400_000;

/** How many calendar days each named period covers, today included. */
const PERIOD_DAYS: Record<Exclude<UsagePeriod, 'custom'>, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

/** Past this many days a point per day is a forest of lines, so a point is a week. */
const DAY_BUCKET_MAX_DAYS = 45;

/** The widest custom range there is an answer for. */
const MAX_CUSTOM_DAYS = 366;

/** How many runs the list carries. It is a list, not an archive. */
export const USAGE_RUNS_LIMIT = 100;

/** What the page asked for, straight off the address. */
export interface UsageRequest {
  workspaceOrgId: string;
  period: UsagePeriod;
  /** `YYYY-MM-DD`, read only for `custom`. */
  from?: string;
  /** `YYYY-MM-DD`, inclusive: the period ends at the end of this day. */
  to?: string;
  /** The repository's slug, as the address spells it. */
  repo?: string;
  jobType?: string;
}

/** Whether `value` is one of the periods the page offers. */
export function isUsagePeriod(value: unknown): value is UsagePeriod {
  return typeof value === 'string' && (USAGE_PERIODS as readonly string[]).includes(value);
}

/** Whether `value` is a job type that can spend. */
export function isUsageJobType(value: unknown): value is string {
  return typeof value === 'string' && (USAGE_JOB_TYPES as readonly string[]).includes(value);
}

function startOfUtcDay(at: Date): number {
  return Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate());
}

/** `YYYY-MM-DD` as the start of that UTC day, or null when it is not a date. */
function parseDay(value: string | undefined): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const at = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(at) ? at : null;
}

function dayLabel(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

/** The Monday of `at`'s UTC week, which is where Postgres truncates a week to. */
function startOfUtcWeek(at: number): number {
  const day = new Date(at).getUTCDay();
  return at - ((day + 6) % 7) * DAY_MS;
}

/**
 * The period as two instants and a bucket. A custom range that does not say
 * two dates, says them backwards, or asks for more than a year is refused: the
 * page must not be handed a trend nobody can read.
 */
export function resolveUsagePeriod(request: UsageRequest, now: Date = new Date()): UsagePeriodView {
  if (request.period !== 'custom') {
    const to = startOfUtcDay(now) + DAY_MS;
    const from = to - PERIOD_DAYS[request.period] * DAY_MS;
    return view(request.period, from, to);
  }
  const from = parseDay(request.from);
  const last = parseDay(request.to);
  if (from === null || last === null) {
    throw createAppError('A custom period needs `from` and `to` as `YYYY-MM-DD` dates.', 400);
  }
  if (last < from) throw createAppError('A custom period ends before it begins.', 400);
  const to = last + DAY_MS;
  if ((to - from) / DAY_MS > MAX_CUSTOM_DAYS) {
    throw createAppError(`A custom period covers at most ${MAX_CUSTOM_DAYS} days.`, 400);
  }
  return view('custom', from, to);
}

function view(key: UsagePeriod, from: number, to: number): UsagePeriodView {
  const days = (to - from) / DAY_MS;
  return {
    key,
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    bucket: days > DAY_BUCKET_MAX_DAYS ? 'week' : 'day',
  };
}

/** Every bucket label of the period, oldest first, so a gap reads as a zero. */
function bucketLabels(period: UsagePeriodView): string[] {
  const from = Date.parse(period.from);
  const to = Date.parse(period.to);
  const labels: string[] = [];
  const step = period.bucket === 'week' ? 7 * DAY_MS : DAY_MS;
  let at = period.bucket === 'week' ? startOfUtcWeek(from) : from;
  while (at < to) {
    labels.push(dayLabel(at));
    at += step;
  }
  return labels;
}

/** Cost arithmetic in JS drifts in the last bits; the store's decimals do not. */
function exact(value: number): number {
  return Math.round(value * 1e8) / 1e8;
}

/**
 * The store query behind every read: the period, plus whichever filters the
 * request named. An unknown repository slug is refused the way every
 * repository address is — not found, never someone else's repository fetched
 * and then denied.
 */
export function usageQuery(
  request: UsageRequest,
  period: UsagePeriodView,
  repos: readonly RegistryEntry[],
): UsageQuery {
  const query: UsageQuery = {
    workspaceOrgId: request.workspaceOrgId,
    from: period.from,
    to: period.to,
  };
  if (request.repo !== undefined) {
    const entry = repos.find((repo) => repo.slug === request.repo);
    if (!entry) throw createAppError(`Project "${request.repo}" not found`, 404);
    query.repoFullName = entry.name;
  }
  if (request.jobType !== undefined) {
    if (!isUsageJobType(request.jobType)) {
      throw createAppError(`Unknown job type: ${request.jobType}`, 400);
    }
    query.jobType = request.jobType;
  }
  return query;
}

/** The period's spend in one line. */
export async function usageTotals(query: UsageQuery): Promise<UsageTotals> {
  const totals = await readUsageTotals(query);
  return {
    costUsd: exact(totals.costUsd),
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    cacheReadTokens: totals.cacheReadTokens,
    cacheCreateTokens: totals.cacheCreateTokens,
    tokens:
      totals.inputTokens + totals.outputTokens + totals.cacheReadTokens + totals.cacheCreateTokens,
    calls: totals.calls,
    runs: totals.runs,
  };
}

/** The trend: one point per bucket of the period, each split by job type. */
export async function usageSeries(
  query: UsageQuery,
  period: UsagePeriodView,
): Promise<UsageSeriesPoint[]> {
  const rows = await readUsageSeries(query, period.bucket);
  const points = new Map<string, UsageSeriesPoint>(
    bucketLabels(period).map((at) => [at, { at, costUsd: 0, tokens: 0, byJobType: {} }]),
  );
  for (const row of rows) {
    // A row the labels do not cover cannot happen for a period the query was
    // built from, and inventing a point for it would put it out of order.
    const point = points.get(row.at);
    if (!point) continue;
    point.costUsd = exact(point.costUsd + row.costUsd);
    point.tokens += row.tokens;
    const held = point.byJobType[row.jobType];
    point.byJobType[row.jobType] = {
      costUsd: exact((held?.costUsd ?? 0) + row.costUsd),
      tokens: (held?.tokens ?? 0) + row.tokens,
    };
  }
  return [...points.values()];
}

/** The runs that spent, newest first, each named and addressed. */
export async function usageRuns(
  query: UsageQuery,
  repos: readonly RegistryEntry[],
  limit: number = USAGE_RUNS_LIMIT,
): Promise<UsageRunRow[]> {
  const slugs = new Map(repos.map((repo) => [repo.name, repo.slug]));
  const rows = await readUsageRuns(query, limit);
  return rows.map((row) => ({
    jobId: row.jobId,
    runId: row.runId,
    jobType: row.jobType,
    title: usageJobTypeWord(row.jobType),
    repository: row.repoFullName,
    // A repository the workspace has since disconnected still spent, and still
    // says so — it just has nowhere to open.
    repoId: (row.repoFullName && slugs.get(row.repoFullName)) ?? null,
    costUsd: exact(row.costUsd),
    tokens: row.tokens,
    calls: row.calls,
    model: row.model,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    durationMs: Math.max(0, Date.parse(row.finishedAt) - Date.parse(row.startedAt)),
    outcome: row.outcome,
  }));
}

/**
 * The two filters' values. `total` is what a value holds on its own in the
 * period; `count` is what picking it would LEAVE, given the other filter — so
 * picking a repository moves the job-type counts and never its own.
 */
export async function usageFacets(
  query: UsageQuery,
  repos: readonly RegistryEntry[],
): Promise<{ repositories: UsageFacet[]; jobTypes: UsageFacet[] }> {
  const cells = await readUsageFacets(query);
  const slugs = new Map(repos.map((repo) => [repo.name, repo.slug]));

  const byRepo = new Map<string, { total: number; count: number }>();
  const byJobType = new Map<string, { total: number; count: number }>();
  for (const cell of cells) {
    if (cell.repoFullName) {
      const held = byRepo.get(cell.repoFullName) ?? { total: 0, count: 0 };
      held.total += cell.runs;
      if (query.jobType === undefined || query.jobType === cell.jobType) held.count += cell.runs;
      byRepo.set(cell.repoFullName, held);
    }
    const held = byJobType.get(cell.jobType) ?? { total: 0, count: 0 };
    held.total += cell.runs;
    if (query.repoFullName === undefined || query.repoFullName === cell.repoFullName) {
      held.count += cell.runs;
    }
    byJobType.set(cell.jobType, held);
  }

  const repositories: UsageFacet[] = [];
  for (const [repoFullName, counts] of byRepo) {
    // Only a repository this workspace still holds can be an address to filter by.
    const slug = slugs.get(repoFullName);
    if (!slug) continue;
    repositories.push({ value: slug, label: repoFullName, ...counts });
  }
  repositories.sort((a, b) => a.label.localeCompare(b.label));

  const jobTypes: UsageFacet[] = [...byJobType]
    .map(([jobType, counts]) => ({ value: jobType, label: usageJobTypeWord(jobType), ...counts }))
    // The vocabulary's own order, so the list reads the same however it spent.
    .sort((a, b) => order(a.value) - order(b.value));

  return { repositories, jobTypes };
}

function order(jobType: string): number {
  const at = (USAGE_JOB_TYPES as readonly string[]).indexOf(jobType);
  return at === -1 ? USAGE_JOB_TYPES.length : at;
}

/** The whole page: the four reads over one resolved period. */
export async function composeUsage(
  request: UsageRequest,
  repos: readonly RegistryEntry[],
  now: Date = new Date(),
): Promise<UsageResponse> {
  const period = resolveUsagePeriod(request, now);
  const query = usageQuery(request, period, repos);
  const [totals, series, runs, facets, since] = await Promise.all([
    usageTotals(query),
    usageSeries(query, period),
    usageRuns(query, repos),
    usageFacets(query, repos),
    usageSince(request.workspaceOrgId),
  ]);
  return { period, since, totals, series, runs, ...facets };
}
