/**
 * Pull requests and their checks, in Postgres — the `PullRequestStore`
 * contract of `@truecourse/shared` over `pull_requests` and
 * `pull_request_checks`. A pull request is upserted by (repository, number) as
 * the webhook last saw it; a check is inserted per attempt on a head and only
 * ever patched forward.
 */

import { and, desc, eq, ne, sql } from 'drizzle-orm';
import crypto from 'node:crypto';
import type {
  PullRequestCheckConclusion,
  PullRequestCheckPatch,
  PullRequestCheckReason,
  PullRequestCheckRecord,
  PullRequestCheckReport,
  PullRequestCheckStatus,
  PullRequestRecord,
  PullRequestState,
  PullRequestStore,
} from '@truecourse/shared';
import { pullRequestChecks, pullRequests, type Db } from '@truecourse/db';
import { iso } from './iso.js';

type PullRequestRow = typeof pullRequests.$inferSelect;
type CheckRow = typeof pullRequestChecks.$inferSelect;

function toPullRequest(r: PullRequestRow): PullRequestRecord {
  return {
    repoFullName: r.repoFullName,
    number: r.number,
    workspaceOrgId: r.workspaceOrgId,
    provider: r.provider as PullRequestRecord['provider'],
    title: r.title,
    authorLogin: r.authorLogin,
    headSha: r.headSha,
    headRef: r.headRef,
    baseRef: r.baseRef,
    headRepoFullName: r.headRepoFullName,
    draft: r.draft,
    state: r.state as PullRequestState,
    openedAt: iso(r.openedAt),
    closedAt: r.closedAt === null ? null : iso(r.closedAt),
    updatedAt: iso(r.updatedAt),
  };
}

function toCheck(r: CheckRow): PullRequestCheckRecord {
  return {
    id: r.id,
    repoFullName: r.repoFullName,
    number: r.number,
    headSha: r.headSha,
    attempt: r.attempt,
    mergeBaseSha: r.mergeBaseSha,
    baseCommitSha: r.baseCommitSha,
    status: r.status as PullRequestCheckStatus,
    conclusion: r.conclusion as PullRequestCheckConclusion | null,
    reason: r.reason as PullRequestCheckReason | null,
    jobId: r.jobId,
    guardRunId: r.guardRunId,
    githubCheckRunId: r.githubCheckRunId,
    report: r.report as PullRequestCheckReport | null,
    createdAt: iso(r.createdAt),
    startedAt: r.startedAt === null ? null : iso(r.startedAt),
    settledAt: r.settledAt === null ? null : iso(r.settledAt),
  };
}

/** The constraint that numbers attempts per head (see the schema). */
const ATTEMPT_UNIQUE_CONSTRAINT = 'pull_request_checks_attempt_unique';

const byState = (state: PullRequestState | 'all' | undefined) =>
  state === undefined || state === 'all' ? undefined : eq(pullRequests.state, state);

export class PgPullRequestStore implements PullRequestStore {
  constructor(private readonly db: Db) {}

  async savePullRequest(rec: PullRequestRecord): Promise<void> {
    const values = {
      repoFullName: rec.repoFullName,
      number: rec.number,
      workspaceOrgId: rec.workspaceOrgId,
      provider: rec.provider,
      title: rec.title,
      authorLogin: rec.authorLogin,
      headSha: rec.headSha,
      headRef: rec.headRef,
      baseRef: rec.baseRef,
      headRepoFullName: rec.headRepoFullName,
      draft: rec.draft,
      state: rec.state,
      openedAt: rec.openedAt,
      closedAt: rec.closedAt,
      updatedAt: rec.updatedAt,
    };
    const { repoFullName: _repo, number: _number, ...set } = values;
    await this.db
      .insert(pullRequests)
      .values(values)
      .onConflictDoUpdate({ target: [pullRequests.repoFullName, pullRequests.number], set });
  }

  async getPullRequest(repoFullName: string, number: number): Promise<PullRequestRecord | null> {
    const rows = await this.db
      .select()
      .from(pullRequests)
      .where(and(eq(pullRequests.repoFullName, repoFullName), eq(pullRequests.number, number)))
      .limit(1);
    return rows[0] ? toPullRequest(rows[0]) : null;
  }

  async listPullRequests(
    repoFullName: string,
    opts: { state?: PullRequestState | 'all' } = {},
  ): Promise<PullRequestRecord[]> {
    const rows = await this.db
      .select()
      .from(pullRequests)
      .where(and(eq(pullRequests.repoFullName, repoFullName), byState(opts.state)))
      .orderBy(desc(pullRequests.updatedAt), desc(pullRequests.number));
    return rows.map(toPullRequest);
  }

  async listWorkspacePullRequests(
    workspaceOrgId: string,
    opts: { state?: PullRequestState | 'all' } = {},
  ): Promise<PullRequestRecord[]> {
    // By the row's own workspace: a repository is one workspace's, and a
    // repository only a context source reads has no `repositories` row to
    // join through.
    const rows = await this.db
      .select()
      .from(pullRequests)
      .where(and(eq(pullRequests.workspaceOrgId, workspaceOrgId), byState(opts.state)))
      .orderBy(desc(pullRequests.updatedAt), desc(pullRequests.number));
    return rows.map(toPullRequest);
  }

  async createCheck(input: {
    repoFullName: string;
    number: number;
    headSha: string;
    jobId?: string | null;
  }): Promise<PullRequestCheckRecord> {
    // The attempt is the head's previous plus one, read and written in one
    // statement. Two reruns racing can still read the same number: the unique
    // constraint refuses the second, which takes the next one on its retry.
    for (let tries = 0; ; tries += 1) {
      try {
        const rows = await this.db
          .insert(pullRequestChecks)
          .values({
            id: crypto.randomUUID(),
            repoFullName: input.repoFullName,
            number: input.number,
            headSha: input.headSha,
            attempt: sql`(select coalesce(max(${pullRequestChecks.attempt}), 0) + 1 from ${pullRequestChecks} where ${pullRequestChecks.repoFullName} = ${input.repoFullName} and ${pullRequestChecks.number} = ${input.number} and ${pullRequestChecks.headSha} = ${input.headSha})`,
            status: 'queued',
            jobId: input.jobId ?? null,
            createdAt: new Date().toISOString(),
          })
          .returning();
        return toCheck(rows[0]!);
      } catch (err) {
        const violated =
          (err as { constraint?: string }).constraint ??
          (err as { cause?: { constraint?: string } }).cause?.constraint;
        if (violated !== ATTEMPT_UNIQUE_CONSTRAINT || tries >= 2) throw err;
      }
    }
  }

  async updateCheck(id: string, patch: PullRequestCheckPatch): Promise<PullRequestCheckRecord | null> {
    const rows = await this.db
      .update(pullRequestChecks)
      .set(patch)
      .where(eq(pullRequestChecks.id, id))
      .returning();
    return rows[0] ? toCheck(rows[0]) : null;
  }

  async settleCheck(
    id: string,
    patch: Omit<PullRequestCheckPatch, 'status'>,
  ): Promise<PullRequestCheckRecord | null> {
    const rows = await this.db
      .update(pullRequestChecks)
      .set({ ...patch, status: 'settled', settledAt: patch.settledAt ?? new Date().toISOString() })
      .where(and(eq(pullRequestChecks.id, id), ne(pullRequestChecks.status, 'settled')))
      .returning();
    return rows[0] ? toCheck(rows[0]) : null;
  }

  async getCheck(id: string): Promise<PullRequestCheckRecord | null> {
    const rows = await this.db.select().from(pullRequestChecks).where(eq(pullRequestChecks.id, id)).limit(1);
    return rows[0] ? toCheck(rows[0]) : null;
  }

  async latestCheck(repoFullName: string, number: number): Promise<PullRequestCheckRecord | null> {
    const rows = await this.db
      .select()
      .from(pullRequestChecks)
      .where(and(eq(pullRequestChecks.repoFullName, repoFullName), eq(pullRequestChecks.number, number)))
      .orderBy(desc(pullRequestChecks.createdAt), desc(pullRequestChecks.attempt))
      .limit(1);
    return rows[0] ? toCheck(rows[0]) : null;
  }

  async activeCheck(repoFullName: string, number: number): Promise<PullRequestCheckRecord | null> {
    const rows = await this.db
      .select()
      .from(pullRequestChecks)
      .where(
        and(
          eq(pullRequestChecks.repoFullName, repoFullName),
          eq(pullRequestChecks.number, number),
          ne(pullRequestChecks.status, 'settled'),
        ),
      )
      .orderBy(desc(pullRequestChecks.createdAt))
      .limit(1);
    return rows[0] ? toCheck(rows[0]) : null;
  }

  async listChecksForHead(repoFullName: string, headSha: string): Promise<PullRequestCheckRecord[]> {
    const rows = await this.db
      .select()
      .from(pullRequestChecks)
      .where(and(eq(pullRequestChecks.repoFullName, repoFullName), eq(pullRequestChecks.headSha, headSha)))
      .orderBy(desc(pullRequestChecks.createdAt), desc(pullRequestChecks.attempt));
    return rows.map(toCheck);
  }
}
