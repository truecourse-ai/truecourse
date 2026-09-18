/**
 * Usage: what a workspace's runs spent at the model, over time.
 *
 * One read behind the Settings › Usage page (`GET /api/usage`), composed the
 * way Home is: the server folds every number and names every value, so the page
 * draws what it was told and computes nothing of its own. Three shapes over the
 * same filtered slice — the period's totals, the trend bucketed by day or by
 * week with one line per job type, and the runs that spent it.
 *
 * Cost is a CEILING in USD: every input-side token is priced at the list input
 * rate and prompt-cache discounts are ignored, the same arithmetic the
 * pre-flight estimate uses, so the real bill lands at or below what is shown.
 */

import type { JobStatus } from './jobs.js';

/** How far back the page reads. `custom` takes its two dates from the address. */
export const USAGE_PERIODS = ['7d', '30d', '90d', 'custom'] as const;
export type UsagePeriod = (typeof USAGE_PERIODS)[number];

/** The job types that can spend at the model. A `context.sync` reaches no model. */
export const USAGE_JOB_TYPES = [
  'context.scan',
  'repo.guard-setup',
  'repo.guard-generate',
  'repo.guard-run',
] as const;
export type UsageJobType = (typeof USAGE_JOB_TYPES)[number];

/** What each job type is called, in the product's words rather than its id. */
export const USAGE_JOB_TYPE_WORD: Record<UsageJobType, string> = {
  'context.scan': 'Document scan',
  'repo.guard-setup': 'Flow setup',
  'repo.guard-generate': 'Flow generation',
  'repo.guard-run': 'Flow run',
};

/** A job type's word, or its id for one with no word of its own. */
export function usageJobTypeWord(jobType: string): string {
  return USAGE_JOB_TYPE_WORD[jobType as UsageJobType] ?? jobType;
}

/** Whether a day's or a week's worth of spend is one point of the trend. */
export type UsageBucket = 'day' | 'week';

/** The period the answer covers, resolved to two instants and a bucket. */
export interface UsagePeriodView {
  key: UsagePeriod;
  /** Inclusive ISO instant. */
  from: string;
  /** Exclusive ISO instant. */
  to: string;
  bucket: UsageBucket;
}

/** The period's spend in one line. */
export interface UsageTotals {
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  /** The four buckets added up: the one number the page shows. */
  tokens: number;
  calls: number;
  /** Runs that spent anything in the period. */
  runs: number;
}

/** One job type's share of a bucket. */
export interface UsageAmount {
  costUsd: number;
  tokens: number;
}

/** One point of the trend: a day, or the week that starts on it. */
export interface UsageSeriesPoint {
  /** The bucket's first day, `YYYY-MM-DD` where the reader is. */
  at: string;
  costUsd: number;
  tokens: number;
  /** The same two numbers per job type; a type that spent nothing is absent. */
  byJobType: Record<string, UsageAmount>;
}

/**
 * One run that spent, four corners' worth: what it was and where, how it ended,
 * what it cost and when. `runId` is null for a job whose run record never
 * opened, and such a row opens nowhere.
 */
export interface UsageRunRow {
  /** The job that spent it — the row's identity, since a run record may be absent. */
  jobId: string;
  runId: string | null;
  jobType: string;
  /** The job type's word: Document scan, Flow generation, … */
  title: string;
  /** `owner/repo`, or null for the workspace's own work. */
  repository: string | null;
  /** The repository's slug, for the address a row opens. Null with no repository. */
  repoId: string | null;
  costUsd: number;
  tokens: number;
  calls: number;
  /** The model that did most of the work. */
  model: string;
  /** The first call. */
  startedAt: string;
  /** The last one. */
  finishedAt: string;
  /** First call to last. */
  durationMs: number;
  /** How the job ended; null while it is still going. */
  outcome: JobStatus | null;
}

/**
 * One value a filter offers. `count` is the faceted number — how many runs
 * picking it would leave, given what the OTHER dimension already keeps;
 * `total` is what it holds on its own in the period.
 */
export interface UsageFacet {
  value: string;
  label: string;
  count: number;
  total: number;
}

/** `GET /api/usage`, the whole page in one answer. */
export interface UsageResponse {
  period: UsagePeriodView;
  /** When the workspace's record begins; null when nothing has ever spent. */
  since: string | null;
  totals: UsageTotals;
  /** Oldest first, one point per bucket of the period, gaps included as zeros. */
  series: UsageSeriesPoint[];
  /** Newest first. */
  runs: UsageRunRow[];
  /** The repositories that spent in the period, by slug. */
  repositories: UsageFacet[];
  /** The job types that spent in the period. */
  jobTypes: UsageFacet[];
}
