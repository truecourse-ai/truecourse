/**
 * The pull request store in memory — the `PullRequestStore` contract of
 * `@truecourse/shared` for a webhook, job or route test that needs the rows
 * without a database. Same rules as the Postgres one: a pull request is
 * upserted by (repository, number), a check is inserted per attempt on a head
 * and only ever patched forward.
 */

import type {
  PullRequestCheckPatch,
  PullRequestCheckRecord,
  PullRequestRecord,
  PullRequestState,
  PullRequestStore,
} from '@truecourse/shared';

export interface MemoryPullRequestStore extends PullRequestStore {
  /** Every row, for assertions. */
  readonly pullRequests: PullRequestRecord[];
  readonly checks: PullRequestCheckRecord[];
}

const key = (repoFullName: string, number: number): string => `${repoFullName}#${number}`;

export function memoryPullRequestStore(clock: () => string = () => new Date().toISOString()): MemoryPullRequestStore {
  const pullRequests = new Map<string, PullRequestRecord>();
  const checks: PullRequestCheckRecord[] = [];
  let ids = 0;

  const byState = (rows: PullRequestRecord[], state: PullRequestState | 'all' | undefined): PullRequestRecord[] =>
    rows
      .filter((pr) => state === undefined || state === 'all' || pr.state === state)
      .sort((a, b) => (a.updatedAt === b.updatedAt ? b.number - a.number : a.updatedAt < b.updatedAt ? 1 : -1));

  /** Newest first: creation order reversed, since the clock may not move between two. */
  const newestFirst = (rows: PullRequestCheckRecord[]): PullRequestCheckRecord[] => [...rows].reverse();

  return {
    get pullRequests() {
      return [...pullRequests.values()];
    },
    checks,
    async savePullRequest(rec) {
      // Timestamps leave as the Postgres store hands them back: ISO with a `Z`.
      const iso = (at: string): string => new Date(at).toISOString();
      pullRequests.set(key(rec.repoFullName, rec.number), {
        ...rec,
        openedAt: iso(rec.openedAt),
        closedAt: rec.closedAt === null ? null : iso(rec.closedAt),
        updatedAt: iso(rec.updatedAt),
      });
    },
    async getPullRequest(repoFullName, number) {
      return pullRequests.get(key(repoFullName, number)) ?? null;
    },
    async listPullRequests(repoFullName, opts = {}) {
      return byState([...pullRequests.values()].filter((pr) => pr.repoFullName === repoFullName), opts.state);
    },
    async listWorkspacePullRequests(workspaceOrgId, opts = {}) {
      return byState([...pullRequests.values()].filter((pr) => pr.workspaceOrgId === workspaceOrgId), opts.state);
    },
    async createCheck(input) {
      const prior = checks.filter(
        (c) => c.repoFullName === input.repoFullName && c.number === input.number && c.headSha === input.headSha,
      );
      ids += 1;
      const check: PullRequestCheckRecord = {
        id: `check_${ids}`,
        repoFullName: input.repoFullName,
        number: input.number,
        headSha: input.headSha,
        attempt: Math.max(0, ...prior.map((c) => c.attempt)) + 1,
        mergeBaseSha: null,
        baseCommitSha: null,
        status: 'queued',
        conclusion: null,
        reason: null,
        jobId: input.jobId ?? null,
        guardRunId: null,
        githubCheckRunId: null,
        report: null,
        createdAt: clock(),
        startedAt: null,
        settledAt: null,
      };
      checks.push(check);
      return { ...check };
    },
    async updateCheck(id, patch: PullRequestCheckPatch) {
      const index = checks.findIndex((c) => c.id === id);
      if (index < 0) return null;
      checks[index] = { ...checks[index]!, ...patch };
      return { ...checks[index]! };
    },
    async settleCheck(id, patch) {
      const index = checks.findIndex((c) => c.id === id && c.status !== 'settled');
      if (index < 0) return null;
      checks[index] = { ...checks[index]!, ...patch, status: 'settled', settledAt: patch.settledAt ?? clock() };
      return { ...checks[index]! };
    },
    async getCheck(id) {
      const check = checks.find((c) => c.id === id);
      return check ? { ...check } : null;
    },
    async latestCheck(repoFullName, number) {
      return newestFirst(checks.filter((c) => c.repoFullName === repoFullName && c.number === number))[0] ?? null;
    },
    async activeCheck(repoFullName, number) {
      return (
        newestFirst(
          checks.filter((c) => c.repoFullName === repoFullName && c.number === number && c.status !== 'settled'),
        )[0] ?? null
      );
    },
    async listChecksForHead(repoFullName, headSha) {
      return newestFirst(checks.filter((c) => c.repoFullName === repoFullName && c.headSha === headSha));
    },
  };
}
