/**
 * Pull requests and their checks.
 *
 * A PULL REQUEST is a row the provider's webhook keeps current: who opened it,
 * where its head and base are, whether it is a draft, and whether it is still
 * open. A CHECK is one attempt to judge one head of it: the pipeline runs at
 * the head against what is stored for the base, and the row settles with a
 * conclusion, a reason and the report the surfaces read. A new head or a
 * rerun is a new check; a row never returns to an earlier status.
 *
 * The contract lives in the leaf package because three sides need it and
 * none owns it: `@truecourse/data-store` implements it over Postgres, the
 * GitHub App writes the pull requests through it, and the server's jobs and
 * routes read and settle the checks.
 */

import { z } from 'zod'
import type { RepositoryProviderId } from './repositories.js'

export type PullRequestState = 'open' | 'closed' | 'merged'

/** One pull request of a connected repository, as the webhook last saw it. */
export interface PullRequestRecord {
  repoFullName: string
  number: number
  workspaceOrgId: string
  provider: RepositoryProviderId
  title: string
  authorLogin: string
  /** The newest head the provider reported. */
  headSha: string
  headRef: string
  baseRef: string
  /**
   * The repository the head lives in. Null when the provider did not say (a
   * fork that was deleted), and different from `repoFullName` on a fork.
   */
  headRepoFullName: string | null
  draft: boolean
  state: PullRequestState
  openedAt: string
  closedAt: string | null
  updatedAt: string
}

/** A pull request is a fork's when its head lives elsewhere, or nowhere any more. */
export function isForkPullRequest(pr: Pick<PullRequestRecord, 'repoFullName' | 'headRepoFullName'>): boolean {
  return pr.headRepoFullName === null || pr.headRepoFullName !== pr.repoFullName
}

/** `queued` then `running` then `settled`; never back. */
export type PullRequestCheckStatus = 'queued' | 'running' | 'settled'

export type PullRequestCheckConclusion = 'success' | 'failure' | 'neutral'

/** Why a check concluded as it did — the one word every surface shows. */
export const PULL_REQUEST_CHECK_REASONS = [
  /** The comparison ran: no new failure, no created conflict. */
  'clean',
  /** At least one flow that held at the base fails at the head. */
  'new-failures',
  /** The head creates an open conflict against the rest of the workspace. */
  'conflict',
  /** A setup step, the cold proof or the run's world boot failed at the head. */
  'build-failed',
  /** Nothing is stored at the merge-base commit to compare against. */
  'no-base',
  /** The pull request is a draft. */
  'draft',
  /** A newer head arrived. */
  'superseded',
  /** The pull request closed, the repository disconnected, or a member cancelled. */
  'cancelled',
  /** The workspace's balance ran out; the job paused. */
  'credits',
  /** The job itself failed for a reason that is not the pull request's. */
  'error',
] as const
export type PullRequestCheckReason = (typeof PULL_REQUEST_CHECK_REASONS)[number]

/** The conclusion each reason carries on the provider's check. */
export const CHECK_CONCLUSION_OF_REASON: Record<PullRequestCheckReason, PullRequestCheckConclusion> = {
  clean: 'success',
  'new-failures': 'failure',
  conflict: 'failure',
  'build-failed': 'failure',
  'no-base': 'neutral',
  draft: 'neutral',
  superseded: 'neutral',
  cancelled: 'neutral',
  credits: 'neutral',
  error: 'neutral',
}

// ---------------------------------------------------------------------------
// The report — what a settled check says, in the four parts it is read in
// ---------------------------------------------------------------------------

const FlowRefSchema = z.object({ id: z.string(), title: z.string() })

export const PullRequestCheckReportSchema = z.object({
  base: z.object({
    /** The merge-base the provider resolved, or null when it could not be. */
    mergeBase: z.string().nullable(),
    /** The stored default-branch commit the check compared against. */
    commit: z.string().nullable(),
    /** When there was no base: the newest default-branch commit that has one. */
    nearestWithBase: z.string().nullable(),
  }),
  fork: z.boolean(),
  /** Conflicts the head creates against the rest of the workspace. */
  conflictsCreated: z.array(
    z.object({
      docs: z.tuple([z.string(), z.string()]),
      sections: z.tuple([z.array(z.string()), z.array(z.string())]),
      note: z.string(),
      /** The changed document's path in the repository, and its section heading's line at the head. */
      path: z.string().nullable(),
      line: z.number().int().positive().nullable(),
      blocksRepositories: z.array(z.string()),
    }),
  ),
  /** Sections whose text moved, with the flows bound to each. */
  sectionsMoved: z.array(z.object({ doc: z.string(), anchor: z.string(), flows: z.array(FlowRefSchema) })),
  /** Other repositories whose slice the merge would move. */
  repositoriesAffected: z.array(z.object({ repoFullName: z.string(), slug: z.string() })),
  run: z
    .object({
      runId: z.string(),
      counts: z.object({
        newFailures: z.number().int().nonnegative(),
        preExisting: z.number().int().nonnegative(),
        fixed: z.number().int().nonnegative(),
        newlyBlocked: z.number().int().nonnegative(),
        added: z.number().int().nonnegative(),
        retired: z.number().int().nonnegative(),
      }),
      newFailures: z.array(
        FlowRefSchema.extend({
          scenarioIds: z.array(z.string()),
          label: z.enum(['bug', 'doc-drift', 'test-defect']).optional(),
        }),
      ),
      preExisting: z.array(FlowRefSchema),
      fixed: z.array(FlowRefSchema),
      newlyBlocked: z.array(FlowRefSchema.extend({ why: z.string() })),
    })
    .nullable(),
  specHalf: z.enum(['ran', 'no-documents-changed', 'not-a-source']),
  codeHalf: z.enum(['ran', 'stopped-by-conflict', 'not-connected', 'not-run']),
})
export type PullRequestCheckReport = z.infer<typeof PullRequestCheckReportSchema>

/** One attempt to check one head of a pull request. */
export interface PullRequestCheckRecord {
  /** Also the provider's `external_id` for the check it posts. */
  id: string
  repoFullName: string
  number: number
  headSha: string
  /** 1, 2, … per head: a rerun is the next attempt. */
  attempt: number
  /** The merge-base the provider resolved; null until the job did. */
  mergeBaseSha: string | null
  /** The stored base the check used. Equals the merge-base today; its own column so the rule can change. */
  baseCommitSha: string | null
  status: PullRequestCheckStatus
  conclusion: PullRequestCheckConclusion | null
  reason: PullRequestCheckReason | null
  /** The job that carries it. */
  jobId: string | null
  /** The run the check's pipeline stored, once it did. */
  guardRunId: string | null
  /** The provider's id for the posted check; null when posting was not permitted. */
  githubCheckRunId: number | null
  report: PullRequestCheckReport | null
  createdAt: string
  startedAt: string | null
  settledAt: string | null
}

/** What a settle or a progress update may change on a check. */
export type PullRequestCheckPatch = Partial<
  Pick<
    PullRequestCheckRecord,
    | 'mergeBaseSha'
    | 'baseCommitSha'
    | 'status'
    | 'conclusion'
    | 'reason'
    | 'jobId'
    | 'guardRunId'
    | 'githubCheckRunId'
    | 'report'
    | 'startedAt'
    | 'settledAt'
  >
>

/** Reading and writing pull requests and their checks. */
export interface PullRequestStore {
  /** Upsert by (repository, number): the webhook writes what it last saw. */
  savePullRequest(rec: PullRequestRecord): Promise<void>
  getPullRequest(repoFullName: string, number: number): Promise<PullRequestRecord | null>
  /** One repository's pull requests, newest update first. */
  listPullRequests(
    repoFullName: string,
    opts?: { state?: PullRequestState | 'all' },
  ): Promise<PullRequestRecord[]>
  /** Every pull request of a workspace's repositories, newest update first. */
  listWorkspacePullRequests(
    workspaceOrgId: string,
    opts?: { state?: PullRequestState | 'all' },
  ): Promise<PullRequestRecord[]>
  /** A new attempt on a head: `attempt` is the head's previous plus one, status `queued`. */
  createCheck(input: {
    repoFullName: string
    number: number
    headSha: string
    jobId?: string | null
  }): Promise<PullRequestCheckRecord>
  /** Returns the patched row, or null when the id names none. */
  updateCheck(id: string, patch: PullRequestCheckPatch): Promise<PullRequestCheckRecord | null>
  getCheck(id: string): Promise<PullRequestCheckRecord | null>
  /** The newest check of a pull request, whatever its status. */
  latestCheck(repoFullName: string, number: number): Promise<PullRequestCheckRecord | null>
  /** The check still queued or running for a pull request, if any. */
  activeCheck(repoFullName: string, number: number): Promise<PullRequestCheckRecord | null>
  /**
   * Every check of one head, newest first. A re-run asked for on the
   * provider names only the head (a fork's check run carries no pull request),
   * so this is how the host finds the pull request to judge again.
   */
  listChecksForHead(repoFullName: string, headSha: string): Promise<PullRequestCheckRecord[]>
}
