/**
 * The LLM USAGE store — what a workspace's runs spent at the model.
 *
 * One seam, ONE implementation: the Postgres store (`@truecourse/data-store`),
 * installed at boot. Nothing is installed by default, and a read that arrives
 * before boot says so rather than inventing a workspace that spent nothing.
 *
 * The unit is one (job, subject): a subject is a KIND of agent session, so a
 * generate's dozens of flow-worker sessions are one row for the kind and its
 * one-turn realization matches are another. {@link UsageStore.record} is an ADD — it folds a flush's tokens,
 * calls and cost onto the row and widens its interval — which is what lets a
 * meter write while the run is still going and leaves the spend on record when
 * the run dies.
 */

import type { JobStatus } from '@truecourse/shared';

/** One flush of spend, folded onto its (job, subject) row. */
export interface UsageDelta {
  workspaceOrgId: string;
  /** `owner/repo`; null for the work the workspace itself does. */
  repoFullName: string | null;
  jobType: string;
  jobId: string;
  /** The run record this job opened, when it has one by now. */
  runId: string | null;
  subjectKind: UsageSubjectKind;
  /** The session kind, or — on a row written before every call became a turn of
   *  a session — the stage name. */
  subject: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  calls: number;
  costUsd: number;
  /** The first call in this flush. */
  startedAt: string;
  /** The last one. */
  finishedAt: string;
}

/**
 * What a usage row is FOR. Every row written now is a `session`: one per session
 * kind per job, because every LLM call the product makes is a turn of one.
 * `stage` is what a row written before that says, and is still read.
 */
export type UsageSubjectKind = 'stage' | 'session';

/** The slice every read is over: a workspace, a period, and the two filters. */
export interface UsageQuery {
  workspaceOrgId: string;
  /** Inclusive ISO instant. */
  from: string;
  /** Exclusive ISO instant. */
  to: string;
  /**
   * The reader's IANA zone, which is what a day and a week are truncated to.
   * Absent is UTC. The name must be one the tz database has: a zone Postgres
   * does not know fails the query rather than falling back.
   */
  timeZone?: string;
  repoFullName?: string;
  jobType?: string;
}

/** The period's spend, added up. */
export interface UsageTotalsRecord {
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  calls: number;
  /** Jobs that spent anything. */
  runs: number;
}

/** One bucket's spend under one job type, in the four stored token buckets. */
export interface UsageSeriesRecord {
  /** The bucket's first day, `YYYY-MM-DD` in the query's zone. */
  at: string;
  jobType: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
}

/** One job's spend, with how the job ended. */
export interface UsageRunRecord {
  jobId: string;
  runId: string | null;
  jobType: string;
  repoFullName: string | null;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  /** The four buckets added up. */
  tokens: number;
  calls: number;
  /** The model the run ran on. Every row of a run names the same one; a run a
   *  FALLBACK model also served reports whichever did the most work. */
  model: string;
  startedAt: string;
  finishedAt: string;
  /** From the `jobs` row; null when the job is still going or left no row. */
  outcome: JobStatus | null;
}

/** One cell of the (repository × job type) cross-tab the filters are faceted from. */
export interface UsageFacetCell {
  repoFullName: string | null;
  jobType: string;
  /** Jobs that spent under this pair. */
  runs: number;
}

export interface UsageStore {
  /**
   * Fold one flush onto its (job, subject) row, creating it the first time.
   * Answers the row's id, which is what a credit debit charges against.
   */
  record(delta: UsageDelta): Promise<string>;
  /** Name the run on every row of a job that was written before it opened. */
  attachRun(jobId: string, runId: string): Promise<void>;
  totals(query: UsageQuery): Promise<UsageTotalsRecord>;
  series(query: UsageQuery, bucket: 'day' | 'week'): Promise<UsageSeriesRecord[]>;
  /** Newest first, at most `limit`. */
  runs(query: UsageQuery, limit: number): Promise<UsageRunRecord[]>;
  /** The cross-tab over the period, with NEITHER filter applied. */
  facets(query: UsageQuery): Promise<UsageFacetCell[]>;
  /** When this workspace's record begins; null when nothing ever spent. */
  since(workspaceOrgId: string): Promise<string | null>;
}

/** Reaching the store before boot installed it is a bug — say so, don't invent. */
const NOT_INSTALLED = 'No LLM usage store installed (boot did not run installDbStores).';

class UninstalledUsageStore implements UsageStore {
  private fail(): never {
    throw new Error(NOT_INSTALLED);
  }
  record(): Promise<string> {
    this.fail();
  }
  attachRun(): Promise<void> {
    this.fail();
  }
  totals(): Promise<UsageTotalsRecord> {
    this.fail();
  }
  series(): Promise<UsageSeriesRecord[]> {
    this.fail();
  }
  runs(): Promise<UsageRunRecord[]> {
    this.fail();
  }
  facets(): Promise<UsageFacetCell[]> {
    this.fail();
  }
  since(): Promise<string | null> {
    this.fail();
  }
}

const unavailable = new UninstalledUsageStore();
let active: UsageStore = unavailable;

export function setUsageStore(store: UsageStore): void {
  active = store;
}

export function resetUsageStore(): void {
  active = unavailable;
}

/** Whether boot installed the usage store. */
export function usageStoreInstalled(): boolean {
  return active !== unavailable;
}

export const recordUsage = (delta: UsageDelta): Promise<string> => active.record(delta);

export const attachUsageRun = (jobId: string, runId: string): Promise<void> =>
  active.attachRun(jobId, runId);

export const readUsageTotals = (query: UsageQuery): Promise<UsageTotalsRecord> =>
  active.totals(query);

export const readUsageSeries = (
  query: UsageQuery,
  bucket: 'day' | 'week',
): Promise<UsageSeriesRecord[]> => active.series(query, bucket);

export const readUsageRuns = (query: UsageQuery, limit: number): Promise<UsageRunRecord[]> =>
  active.runs(query, limit);

export const readUsageFacets = (query: UsageQuery): Promise<UsageFacetCell[]> =>
  active.facets(query);

export const usageSince = (workspaceOrgId: string): Promise<string | null> =>
  active.since(workspaceOrgId);
