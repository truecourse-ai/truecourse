/**
 * What a pull request event MEANS for its check, and how a check starts: one
 * row per attempt on a head, one check posted on GitHub for it, one job in
 * the workspace's heavy lane behind whatever main chain is waiting there.
 *
 * A new head, a reopen, a base change or "ready for review" judges the head:
 * the check in flight for the pull request, if any, is superseded first — its
 * row settled, its job stopped, GitHub told — and a new attempt starts. A
 * draft is held: the same supersede, then a check settled at once saying it
 * is checked when ready. A close cancels what is in flight. A re-run pressed
 * on GitHub or in the product is a new attempt on the current head.
 *
 * A GitHub that refuses to take the check (the account has not accepted the
 * permission) is logged once per repository and the check runs all the same,
 * shown in the product and posted nowhere.
 */

import { log } from '@truecourse/core/lib/logger';
import {
  createCheck,
  installationOf,
  renderCheckOutput,
  updateCheck,
  type CheckRerunTrigger,
  type OctokitClient,
  type PullRequestTrigger,
} from '@truecourse/github-app';
import {
  CHECK_CONCLUSION_OF_REASON,
  type PullRequestCheckReason,
  type PullRequestCheckRecord,
  type PullRequestRecord,
  type PullRequestStore,
  type RepositoryStore,
} from '@truecourse/shared';
import type { EnqueueResult, JobsMount } from '../jobs/index.js';

export interface PullRequestChecksDeps {
  jobs: Pick<JobsMount, 'enqueuePullRequestCheck' | 'cancel'>;
  pulls: PullRequestStore;
  repos: RepositoryStore;
  octokitFor: (installationId: number) => OctokitClient;
}

/** What starting a check answered: the attempt's row, and the queue's word. */
export type CheckStart = { status: 'queued'; checkId: string; jobId: string } | { status: 'busy' | 'failed' };

export interface PullRequestChecks {
  onPullRequest(trigger: PullRequestTrigger): Promise<void>;
  onCheckRerun(trigger: CheckRerunTrigger): Promise<void>;
  /** A new attempt on the pull request's current head. */
  start(pr: PullRequestRecord, installationId?: number): Promise<CheckStart>;
  /**
   * Settle whatever is in flight for the pull request with `reason`, and stop
   * its job: `superseded` by a newer head, `cancelled` by a close or a
   * disconnect, `error` when the process running it died.
   */
  supersede(repoFullName: string, number: number, reason: 'superseded' | 'cancelled' | 'error'): Promise<void>;
}

export function createPullRequestChecks(deps: PullRequestChecksDeps): PullRequestChecks {
  /** Repositories GitHub already refused a check for, so it is said once. */
  const refused = new Set<string>();

  /** Post a queued check on GitHub; null when GitHub refuses it. */
  async function postQueued(
    octokit: OctokitClient,
    check: PullRequestCheckRecord,
  ): Promise<number | null> {
    try {
      return await createCheck(octokit, check.repoFullName, { headSha: check.headSha, externalId: check.id });
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 403 && !refused.has(check.repoFullName)) {
        refused.add(check.repoFullName);
        log.warn(
          `[checks] GitHub refused to take a check for ${check.repoFullName}: the account has not accepted the checks permission. Checks run here and are not posted until it does.`,
        );
      } else if (status !== 403) {
        log.warn(`[checks] could not post a check for ${check.repoFullName}#${check.number}: ${(err as Error).message}`);
      }
      return null;
    }
  }

  /**
   * Settle a row with a reason and move GitHub's check with it, when one was
   * posted. A row that settled meanwhile (its job got there first) keeps its
   * word, and GitHub is not told twice.
   */
  async function settle(
    octokit: OctokitClient,
    check: PullRequestCheckRecord,
    reason: PullRequestCheckReason,
  ): Promise<void> {
    const settled = await deps.pulls.settleCheck(check.id, {
      conclusion: CHECK_CONCLUSION_OF_REASON[reason],
      reason,
    });
    if (!settled || check.githubCheckRunId === null) return;
    try {
      await updateCheck(octokit, check.repoFullName, check.githubCheckRunId, {
        status: 'completed',
        reason,
        output: renderCheckOutput(reason, null, null),
      });
    } catch (err) {
      log.warn(`[checks] could not move GitHub's check for ${check.repoFullName}#${check.number}: ${(err as Error).message}`);
    }
  }

  /** The installation a pull request's checks read GitHub through. */
  async function installationFor(pr: PullRequestRecord, given?: number): Promise<number | null> {
    if (given !== undefined) return given;
    const link = await deps.repos.getRepo(pr.repoFullName);
    return link ? installationOf(link) : null;
  }

  const supersede: PullRequestChecks['supersede'] = async (repoFullName, number, reason) => {
    const active = await deps.pulls.activeCheck(repoFullName, number);
    if (!active) return;
    const pr = await deps.pulls.getPullRequest(repoFullName, number);
    const installationId = pr ? await installationFor(pr) : null;
    // The row first, so the job's own settle finds it settled and leaves it.
    if (installationId !== null) await settle(deps.octokitFor(installationId), active, reason);
    else await deps.pulls.settleCheck(active.id, { conclusion: 'neutral', reason });
    if (active.jobId) await deps.jobs.cancel(active.jobId);
  };

  const start: PullRequestChecks['start'] = async (pr, given) => {
    const installationId = await installationFor(pr, given);
    const link = await deps.repos.getRepo(pr.repoFullName);
    if (installationId === null) {
      log.warn(`[checks] ${pr.repoFullName}#${pr.number} has no installation to check through`);
      return { status: 'failed' };
    }
    await supersede(pr.repoFullName, pr.number, 'superseded');
    const octokit = deps.octokitFor(installationId);
    let check = await deps.pulls.createCheck({ repoFullName: pr.repoFullName, number: pr.number, headSha: pr.headSha });
    const githubCheckRunId = await postQueued(octokit, check);
    check = (await deps.pulls.updateCheck(check.id, { githubCheckRunId })) ?? check;
    const outcome = await deps.jobs.enqueuePullRequestCheck({
      // A repository only a source reads has no slug; the socket room is the name's.
      repoId: link?.slug ?? pr.repoFullName,
      repoFullName: pr.repoFullName,
      workspaceOrgId: pr.workspaceOrgId,
      source: 'pull-request',
      number: pr.number,
      headSha: pr.headSha,
      checkId: check.id,
      installationId,
    });
    if (outcome.status !== 'queued') {
      // Another replica still runs the check this one superseded: the row
      // just made would wait for nobody. The head goes unchecked until a
      // re-run or the next push.
      log.warn(`[checks] ${pr.repoFullName}#${pr.number} at ${pr.headSha.slice(0, 8)} not checked: its earlier attempt is still running elsewhere`);
      await settle(octokit, check, 'cancelled');
      return { status: 'busy' };
    }
    await deps.pulls.updateCheck(check.id, { jobId: outcome.jobId });
    return { status: 'queued', checkId: check.id, jobId: outcome.jobId };
  };

  /** A draft's check: settled at once, saying so. */
  async function hold(pr: PullRequestRecord, installationId: number): Promise<void> {
    await supersede(pr.repoFullName, pr.number, 'superseded');
    const octokit = deps.octokitFor(installationId);
    let check = await deps.pulls.createCheck({ repoFullName: pr.repoFullName, number: pr.number, headSha: pr.headSha });
    const githubCheckRunId = await postQueued(octokit, check);
    check = (await deps.pulls.updateCheck(check.id, { githubCheckRunId })) ?? check;
    await settle(octokit, check, 'draft');
  }

  return {
    start,
    supersede,
    async onPullRequest(trigger) {
      const { pr, installationId, effect } = trigger;
      try {
        if (effect === 'check') await start(pr, installationId);
        else if (effect === 'draft') await hold(pr, installationId);
        else if (effect === 'close') await supersede(pr.repoFullName, pr.number, 'cancelled');
      } catch (err) {
        log.error(`[checks] ${pr.repoFullName}#${pr.number} ${effect}: ${(err as Error).message}`);
      }
    },
    async onCheckRerun(trigger) {
      try {
        const checks = trigger.checkId
          ? [await deps.pulls.getCheck(trigger.checkId)].filter((c): c is PullRequestCheckRecord => c !== null)
          : await deps.pulls.listChecksForHead(trigger.repoFullName, trigger.headSha);
        for (const number of new Set(checks.map((c) => c.number))) {
          const pr = await deps.pulls.getPullRequest(trigger.repoFullName, number);
          // The current head only: a re-run of an old head would judge a head
          // the pull request no longer has.
          if (!pr || pr.state !== 'open' || pr.headSha !== trigger.headSha) continue;
          if (pr.draft) await hold(pr, trigger.installationId);
          else await start(pr, trigger.installationId);
        }
      } catch (err) {
        log.error(`[checks] re-run of ${trigger.repoFullName}@${trigger.headSha.slice(0, 8)}: ${(err as Error).message}`);
      }
    },
  };
}

export type { EnqueueResult };
