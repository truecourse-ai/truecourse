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
 * on GitHub is a new attempt on the current head, logged either way.
 *
 * A GitHub that refuses to take the check (the account has not accepted the
 * permission) is logged once per repository and the check runs all the same,
 * shown in the product and posted nowhere.
 *
 * Checks are OFF for a repository until its Settings turn them on, and always
 * off for a repository Code has not connected (it has no settings). A pull
 * request into a branch other than the repository's default one is not
 * checked either: only the default branch has stored state to compare with.
 * Unchecked, a new head still stops the check in flight, and nothing new
 * starts or is posted.
 */

import { log } from '@truecourse/core/lib/logger';
import {
  createCheck,
  installationOf,
  type CheckRerunTrigger,
  type OctokitClient,
  type PullRequestTrigger,
} from '@truecourse/github-app';
import {
  pullRequestRef,
  type PullRequestCheckReason,
  type PullRequestCheckRecord,
  type PullRequestRecord,
  type PullRequestStore,
  type RepositoryRecord,
  type RepositoryStore,
} from '@truecourse/shared';
import type { EnqueueResult, JobsMount } from '../jobs/index.js';
import { settleCheck } from '../jobs/pr-check-chain.js';

export interface PullRequestChecksDeps {
  jobs: Pick<JobsMount, 'enqueuePullRequestCheck' | 'cancelCheckJob'>;
  pulls: PullRequestStore;
  repos: RepositoryStore;
  octokitFor: (installationId: number) => OctokitClient;
}

/**
 * What starting a check answered: the attempt's row, and the queue's word.
 * `stale` is a head the pull request no longer has, or a pull request no
 * longer open: nothing was superseded and nothing started. `disabled` is a
 * repository whose checks are off; `other-base` a pull request that targets
 * a branch other than the repository's default one.
 */
export type CheckStart =
  | { status: 'queued'; checkId: string; jobId: string }
  | { status: 'busy' | 'failed' | 'stale' | 'disabled' | 'other-base' };

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
  /**
   * Settle ONE check with `reason`, when it is still open, and nothing else:
   * the check of a job that is already gone (the process died under it, or a
   * disconnect is stopping it). Never a newer attempt of the same pull request.
   */
  settleStopped(checkId: string, reason: 'cancelled' | 'error'): Promise<void>;
  /**
   * A conflict was resolved in the workspace: every open pull request whose
   * latest check settled on a conflict is checked again, whichever conflict it
   * was — a check records no conflict identity, and one going may free any of
   * them. Best-effort.
   */
  rerunBlockedByConflict(workspaceOrgId: string): Promise<void>;
}

/**
 * Whether a pull request is checked: the repository's link when it is, else
 * why not. Only the default branch has stored state to compare a head with,
 * so a pull request into any other branch is not checked.
 */
function checkable(
  pr: PullRequestRecord,
  link: RepositoryRecord | null,
): { link: RepositoryRecord } | { status: 'disabled' | 'other-base'; why: string } {
  if (!link) return { status: 'disabled', why: 'the repository is not connected in Code' };
  if (!link.checkPullRequests) return { status: 'disabled', why: 'checks are off for this repository' };
  if (pr.baseRef !== link.defaultBranch) {
    return { status: 'other-base', why: `it targets ${pr.baseRef}, not the default branch ${link.defaultBranch ?? '(unknown)'}` };
  }
  return { link };
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
   * The installation a pull request's checks read GitHub through: the one the
   * event named, else the repository's link. Null when neither has one.
   */
  async function installationFor(pr: PullRequestRecord, given?: number): Promise<number | null> {
    if (given !== undefined) return given;
    const link = await deps.repos.getRepo(pr.repoFullName);
    return link ? installationOf(link) : null;
  }

  /** Settle a check with a reason alone, telling GitHub through the pull request's installation. */
  async function settleWith(
    check: PullRequestCheckRecord,
    reason: PullRequestCheckReason,
  ): Promise<{ settled: PullRequestCheckRecord | null; pr: PullRequestRecord | null }> {
    const pr = await deps.pulls.getPullRequest(check.repoFullName, check.number);
    const installationId = pr ? await installationFor(pr) : null;
    return { settled: await settleCheck(deps, check.id, installationId, { reason }, null), pr };
  }

  const supersede: PullRequestChecks['supersede'] = async (repoFullName, number, reason) => {
    const active = await deps.pulls.activeCheck(repoFullName, number);
    if (!active) return;
    // The row first, so the jobs' own settles find it settled and leave it,
    // and a link of its chain still queued does nothing when it starts.
    const { settled, pr } = await settleWith(active, reason);
    // Stopped and waited for (the wait is bounded): a running coordinator holds
    // the pull request's single-flight key until it unwinds, and the next
    // attempt's enqueue would find the key taken. The webhook does not wait
    // on this. The job is the one the SETTLED row names: a link that started
    // between the read and the settle wrote its own id, and is the one to stop.
    const workspaceOrgId = pr?.workspaceOrgId;
    const jobId = settled?.jobId;
    if (workspaceOrgId && jobId) {
      await deps.jobs.cancelCheckJob(workspaceOrgId, jobId).catch((err: unknown) => {
        log.warn(`[checks] could not stop the jobs of ${repoFullName}#${number}: ${(err as Error).message}`);
      });
    }
  };

  const start: PullRequestChecks['start'] = async (pr, given) => {
    const installationId = await installationFor(pr, given);
    if (installationId === null) {
      log.warn(`[checks] ${pr.repoFullName}#${pr.number} has no installation to check through`);
      return { status: 'failed' };
    }
    // The head as stored NOW: a re-run carries a row read a moment ago, and a
    // push landing in between must not have its fresh check superseded by a
    // check of the head it just replaced.
    const stored = await deps.pulls.getPullRequest(pr.repoFullName, pr.number);
    if (!stored || stored.state !== 'open' || stored.headSha !== pr.headSha) {
      log.info(`[checks] ${pr.repoFullName}#${pr.number} at ${pr.headSha.slice(0, 8)} not started: the pull request moved on`);
      return { status: 'stale' };
    }
    await supersede(pr.repoFullName, pr.number, 'superseded');
    const verdict = checkable(pr, await deps.repos.getRepo(pr.repoFullName));
    if (!('link' in verdict)) {
      log.info(`[checks] ${pr.repoFullName}#${pr.number} at ${pr.headSha.slice(0, 8)} not checked: ${verdict.why}`);
      return { status: verdict.status };
    }
    const octokit = deps.octokitFor(installationId);
    let check = await deps.pulls.createCheck({ repoFullName: pr.repoFullName, number: pr.number, headSha: pr.headSha });
    const githubCheckRunId = await postQueued(octokit, check);
    check = (await deps.pulls.updateCheck(check.id, { githubCheckRunId })) ?? check;
    const outcome = await deps.jobs.enqueuePullRequestCheck({
      repoId: verdict.link.slug,
      repoFullName: pr.repoFullName,
      workspaceOrgId: pr.workspaceOrgId,
      source: 'pull-request',
      number: pr.number,
      headSha: pr.headSha,
      checkId: check.id,
      installationId,
    });
    if (outcome.status !== 'queued') {
      // Another replica still runs the check this one superseded (a cancel
      // here cannot reach it), or its unwinding outlasted the wait: the row
      // just made would wait for nobody. The head goes unchecked until a
      // re-run or the next push.
      log.warn(`[checks] ${pr.repoFullName}#${pr.number} at ${pr.headSha.slice(0, 8)} not checked: its earlier attempt is still running`);
      await settleCheck(deps, check.id, installationId, { reason: 'cancelled' }, null);
      return { status: 'busy' };
    }
    await deps.pulls.updateCheck(check.id, { jobId: outcome.jobId });
    return { status: 'queued', checkId: check.id, jobId: outcome.jobId };
  };

  /** A draft's check: settled at once, saying so. Nothing is posted for a repository whose checks are off. */
  async function hold(pr: PullRequestRecord, installationId: number): Promise<void> {
    await supersede(pr.repoFullName, pr.number, 'superseded');
    const verdict = checkable(pr, await deps.repos.getRepo(pr.repoFullName));
    if (!('link' in verdict)) {
      log.info(`[checks] ${pr.repoFullName}#${pr.number} draft not held: ${verdict.why}`);
      return;
    }
    const octokit = deps.octokitFor(installationId);
    let check = await deps.pulls.createCheck({ repoFullName: pr.repoFullName, number: pr.number, headSha: pr.headSha });
    const githubCheckRunId = await postQueued(octokit, check);
    check = (await deps.pulls.updateCheck(check.id, { githubCheckRunId })) ?? check;
    await settleCheck(deps, check.id, installationId, { reason: 'draft' }, null);
  }

  return {
    start,
    supersede,
    async settleStopped(checkId, reason) {
      const check = await deps.pulls.getCheck(checkId);
      if (check && check.status !== 'settled') await settleWith(check, reason);
    },
    async rerunBlockedByConflict(workspaceOrgId) {
      const pulls = (await deps.pulls.listWorkspacePullRequests(workspaceOrgId, { state: 'open' })).filter((pr) => !pr.draft);
      const latest = await deps.pulls.latestChecks(pulls);
      for (const pr of pulls) {
        try {
          const check = latest.get(pullRequestRef(pr.repoFullName, pr.number));
          if (check?.status === 'settled' && check.reason === 'conflict') await start(pr);
        } catch (err) {
          log.warn(`[checks] could not re-check ${pr.repoFullName}#${pr.number}: ${(err as Error).message}`);
        }
      }
    },
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
        const at = `${trigger.repoFullName}@${trigger.headSha.slice(0, 8)}`;
        if (checks.length === 0) log.info(`[checks] re-run of ${at}: no check of ours on that head, nothing re-run`);
        for (const number of new Set(checks.map((c) => c.number))) {
          const pr = await deps.pulls.getPullRequest(trigger.repoFullName, number);
          // The current head only: a re-run of an old head would judge a head
          // the pull request no longer has.
          if (!pr || pr.state !== 'open' || pr.headSha !== trigger.headSha) {
            const why = !pr
              ? 'the pull request is unknown'
              : pr.state !== 'open'
                ? `the pull request is ${pr.state}`
                : `the pull request's head is now ${pr.headSha.slice(0, 8)}`;
            log.info(`[checks] re-run of ${at} for #${number} not started: ${why}`);
            continue;
          }
          log.info(`[checks] re-run of ${at} for #${number}: ${pr.draft ? 'held as a draft' : 'a new attempt'}`);
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
