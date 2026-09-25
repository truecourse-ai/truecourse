/**
 * Pull requests and their checks.
 *
 *   pull_requests       — one row per pull request of a connected repository,
 *                         written by the provider's webhook and nothing else:
 *                         its head, base, draft flag and state as last seen.
 *                         No pointer to its latest check: that is the newest
 *                         `pull_request_checks` row.
 *   pull_request_checks — one row per ATTEMPT on a head. A rerun or a new head
 *                         inserts; a row never returns to an earlier status.
 *                         `id` is also the provider's `external_id` for the
 *                         check it posts, and `report` is what every surface
 *                         reads once the row settled.
 *
 * What a check PRODUCES (the head's scenario set, report, run, corpus) is not
 * here: those are versions under the pull request's scope on the series
 * tables, and `guard_run_id` names the run that survives.
 */

import { pgTable, text, integer, bigint, boolean, jsonb, timestamp, primaryKey, index, unique } from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });

export const pullRequests = pgTable(
  'pull_requests',
  {
    repoFullName: text('repo_full_name').notNull(),
    number: integer('number').notNull(),
    workspaceOrgId: text('workspace_org_id').notNull(),
    provider: text('provider').notNull(),
    title: text('title').notNull(),
    authorLogin: text('author_login').notNull(),
    /** The newest head the provider reported. */
    headSha: text('head_sha').notNull(),
    headRef: text('head_ref').notNull(),
    baseRef: text('base_ref').notNull(),
    /** Null, or different from `repo_full_name`, on a fork. */
    headRepoFullName: text('head_repo_full_name'),
    draft: boolean('draft').notNull(),
    /** 'open' | 'closed' | 'merged'. */
    state: text('state').notNull(),
    openedAt: ts('opened_at').notNull(),
    closedAt: ts('closed_at'),
    updatedAt: ts('updated_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.repoFullName, t.number] }),
    index('pull_requests_workspace_idx').on(t.workspaceOrgId, t.state, t.updatedAt),
  ],
);

export const pullRequestChecks = pgTable(
  'pull_request_checks',
  {
    id: text('id').primaryKey(),
    repoFullName: text('repo_full_name').notNull(),
    number: integer('number').notNull(),
    headSha: text('head_sha').notNull(),
    /** 1, 2, … per head. */
    attempt: integer('attempt').notNull(),
    /** Null until the job resolved it. */
    mergeBaseSha: text('merge_base_sha'),
    /** The stored base the check used; equals the merge-base today. */
    baseCommitSha: text('base_commit_sha'),
    /** 'queued' | 'running' | 'settled'. */
    status: text('status').notNull(),
    /** 'success' | 'failure' | 'neutral', once settled. */
    conclusion: text('conclusion'),
    /** The one word for why (`PULL_REQUEST_CHECK_REASONS` in shared). */
    reason: text('reason'),
    /** The `jobs` row that carries it. */
    jobId: text('job_id'),
    /** The run the check's pipeline stored. */
    guardRunId: text('guard_run_id'),
    /** The provider's id for the posted check; null when posting was not permitted. */
    githubCheckRunId: bigint('github_check_run_id', { mode: 'number' }),
    /** `PullRequestCheckReport` (shared), once settled. */
    report: jsonb('report').$type<unknown>(),
    createdAt: ts('created_at').notNull(),
    startedAt: ts('started_at'),
    settledAt: ts('settled_at'),
  },
  (t) => [
    unique('pull_request_checks_attempt_unique').on(t.repoFullName, t.number, t.headSha, t.attempt),
    index('pull_request_checks_pr_idx').on(t.repoFullName, t.number, t.createdAt),
  ],
);
