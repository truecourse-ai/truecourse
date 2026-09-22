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
 * The period is HALF-OPEN and anchored on the READER's whole days: `7d` is the
 * seven calendar days ending today where they are, so the trend's right edge is
 * their today and no point is a fraction of a day. Their zone rides the request
 * as `tz`, and the store truncates its buckets to it, so the chart and the runs
 * beneath it name the same day for the same run. An absent or unknown zone is
 * UTC.
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
  type UsageAmount,
  type UsageFacet,
  type UsagePeriod,
  type UsagePeriodView,
  type UsageResponse,
  type UsageRunRow,
  type UsageSeriesPoint,
  type UsageTokenSplit,
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
  /** The reader's IANA zone, as `tz` on the address. Unknown or absent is UTC. */
  timeZone?: string;
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

/**
 * The reader's zone. Postgres and `Intl` must both know the name, since the
 * store truncates by it and a name neither has would fail the query mid-read,
 * so anything else is UTC rather than a refusal: a stale link still opens.
 */
export function usageTimeZone(value: string | undefined): string {
  if (!value || !/^[A-Za-z0-9_+\-/]{1,64}$/.test(value)) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return value;
  } catch {
    return 'UTC';
  }
}

/** One zone's formatter, kept: a 90-day walk reads the calendar a hundred times. */
const CLOCKS = new Map<string, Intl.DateTimeFormat>();

function clock(zone: string): Intl.DateTimeFormat {
  let held = CLOCKS.get(zone);
  if (!held) {
    held = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    CLOCKS.set(zone, held);
  }
  return held;
}

/** What the zone's own calendar and clock read at an instant. */
interface Wall {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wall(at: number, zone: string): Wall {
  const parts = clock(zone).formatToParts(new Date(at));
  const read = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');
  const hour = read('hour');
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    // Midnight reads as 24 on some builds; it is the day's first hour, not its last.
    hour: hour === 24 ? 0 : hour,
    minute: read('minute'),
    second: read('second'),
  };
}

/** How far ahead of UTC the zone is at `at`, which a DST transition moves. */
function offset(at: number, zone: string): number {
  const it = wall(at, zone);
  const clocked = Date.UTC(it.year, it.month - 1, it.day, it.hour, it.minute, it.second);
  return clocked - Math.floor(at / 1000) * 1000;
}

/**
 * The instant a calendar day begins at in the zone. The offset is read twice
 * because the first reading is taken on the wrong side of a transition when the
 * clocks moved that day; `day` may overflow its month, which is how a walk adds
 * a day without assuming one is 24 hours long.
 */
function startOf(year: number, month: number, day: number, zone: string): number {
  const clocked = Date.UTC(year, month - 1, day);
  const guess = clocked - offset(clocked, zone);
  return clocked - offset(guess, zone);
}

/** `YYYY-MM-DD` as the start of that day where the reader is, or null for a non-date. */
function parseDay(value: string | undefined, zone: string): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const at = startOf(year, month, day, zone);
  // A day the calendar does not have (February 31, or one a zone skipped
  // entirely) comes back as some other day, and is no date at all.
  return dayLabel(at, zone) === value ? at : null;
}

function dayLabel(at: number, zone: string): string {
  const it = wall(at, zone);
  return `${String(it.year).padStart(4, '0')}-${String(it.month).padStart(2, '0')}-${String(it.day).padStart(2, '0')}`;
}

/** The start of the day `days` calendar days from `at`'s, walked as days rather than as hours. */
function addDays(at: number, days: number, zone: string): number {
  const it = wall(at, zone);
  return startOf(it.year, it.month, it.day + days, zone);
}

/** The Monday of `at`'s week where the reader is, which is where Postgres truncates a week to. */
function startOfWeek(at: number, zone: string): number {
  const it = wall(at, zone);
  const weekday = new Date(Date.UTC(it.year, it.month - 1, it.day)).getUTCDay();
  return startOf(it.year, it.month, it.day - ((weekday + 6) % 7), zone);
}

/** Whole days across a period. A day the clocks moved is short or long, and still one day. */
function daysBetween(from: number, to: number): number {
  return Math.round((to - from) / DAY_MS);
}

/**
 * The period as two instants and a bucket. A custom range that does not say
 * two dates, says them backwards, or asks for more than a year is refused: the
 * page must not be handed a trend nobody can read.
 */
export function resolveUsagePeriod(request: UsageRequest, now: Date = new Date()): UsagePeriodView {
  const zone = usageTimeZone(request.timeZone);
  if (request.period !== 'custom') {
    // The end of the reader's today, which is the start of their tomorrow.
    const to = addDays(now.getTime(), 1, zone);
    const from = addDays(to, -PERIOD_DAYS[request.period], zone);
    return view(request.period, from, to);
  }
  const from = parseDay(request.from, zone);
  const last = parseDay(request.to, zone);
  if (from === null || last === null) {
    throw createAppError('A custom period needs `from` and `to` as `YYYY-MM-DD` dates.', 400);
  }
  if (last < from) throw createAppError('A custom period ends before it begins.', 400);
  const to = addDays(last, 1, zone);
  if (daysBetween(from, to) > MAX_CUSTOM_DAYS) {
    throw createAppError(`A custom period covers at most ${MAX_CUSTOM_DAYS} days.`, 400);
  }
  return view('custom', from, to);
}

function view(key: UsagePeriod, from: number, to: number): UsagePeriodView {
  const days = daysBetween(from, to);
  return {
    key,
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    bucket: days > DAY_BUCKET_MAX_DAYS ? 'week' : 'day',
  };
}

/**
 * Every bucket label of the period, oldest first, so a gap reads as a zero. The
 * walk is the reader's calendar, not a count of 86,400,000s: the day the clocks
 * move is one point like any other.
 */
function bucketLabels(period: UsagePeriodView, zone: string): string[] {
  const from = Date.parse(period.from);
  const to = Date.parse(period.to);
  const labels: string[] = [];
  const step = period.bucket === 'week' ? 7 : 1;
  let at = period.bucket === 'week' ? startOfWeek(from, zone) : from;
  while (at < to) {
    labels.push(dayLabel(at, zone));
    at = addDays(at, step, zone);
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
    timeZone: usageTimeZone(request.timeZone),
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

/** The four stored token buckets, which never overlap. */
export interface UsageTokenBuckets {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
}

/**
 * The buckets as the page reads them: a cache write is input (read at full
 * price on its way into the cache), a cache read is cached, and the hit rate is
 * the cached share of everything read. No caching reported at all is no rate.
 */
export function usageTokenSplit(buckets: UsageTokenBuckets): UsageTokenSplit {
  const input = buckets.inputTokens + buckets.cacheCreateTokens;
  const cached = buckets.cacheReadTokens;
  const caching = buckets.cacheReadTokens + buckets.cacheCreateTokens > 0;
  return {
    input,
    output: buckets.outputTokens,
    cached,
    cacheHitRate: caching ? cached / (input + cached) : null,
  };
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
    split: usageTokenSplit(totals),
    calls: totals.calls,
    runs: totals.runs,
  };
}

/** Two amounts as one, cost kept to the cent's own precision. */
function addAmount(a: UsageAmount, b: UsageAmount): UsageAmount {
  return {
    costUsd: exact(a.costUsd + b.costUsd),
    input: a.input + b.input,
    output: a.output + b.output,
    cached: a.cached + b.cached,
  };
}

const NO_AMOUNT: UsageAmount = { costUsd: 0, input: 0, output: 0, cached: 0 };

/**
 * The trend: one point per bucket of the period, each split by job type, and
 * each carrying every measure the page can plot — cost, and the tokens split
 * the way the totals and the runs split them.
 */
export async function usageSeries(
  query: UsageQuery,
  period: UsagePeriodView,
): Promise<UsageSeriesPoint[]> {
  const rows = await readUsageSeries(query, period.bucket);
  const points = new Map<string, UsageSeriesPoint>(
    bucketLabels(period, usageTimeZone(query.timeZone)).map((at) => [
      at,
      { at, ...NO_AMOUNT, byJobType: {} },
    ]),
  );
  for (const row of rows) {
    // A row the labels do not cover cannot happen for a period the query was
    // built from, and inventing a point for it would put it out of order.
    const point = points.get(row.at);
    if (!point) continue;
    const split = usageTokenSplit(row);
    const amount: UsageAmount = {
      costUsd: row.costUsd,
      input: split.input,
      output: split.output,
      cached: split.cached,
    };
    Object.assign(point, addAmount(point, amount));
    point.byJobType[row.jobType] = addAmount(point.byJobType[row.jobType] ?? NO_AMOUNT, amount);
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
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cacheReadTokens: row.cacheReadTokens,
    cacheCreateTokens: row.cacheCreateTokens,
    tokens: row.tokens,
    split: usageTokenSplit(row),
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
