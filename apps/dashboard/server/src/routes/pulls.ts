/**
 * Pull requests, as the product reads them.
 *
 *   GET  /api/repos/:id/pulls?state=open|closed|merged|all  a repository's pull
 *        requests, newest update first, each with its latest check in one
 *        line — the values behind the Pull request filter on Code › Runs and
 *        Agent.
 *   GET  /api/repos/:id/pulls/:number/checks/:checkId  one check with its
 *        full report — what the check's run on the Agent page shows.
 *   POST /api/repos/:id/pulls/:number/rerun            a new attempt on the
 *        pull request's current head; 202 with the check and its job.
 *   GET  /api/context/pull-requests                     every open pull
 *        request of the workspace whose latest check settled, with the
 *        conflicts it created and the sections it moved — the rows Context ›
 *        Documents and Conflicts add for it.
 *
 * The repository routes sit behind the project resolver, so another
 * workspace's repository answers 404 like every other repository route. A
 * pull request row names the workspace whose check it was, which can differ
 * from the repository's when a source-only repository was checked in one
 * workspace and connected in another: a row of another workspace is not
 * listed, not read and not re-run here either.
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import { createAppError } from '@truecourse/core/lib/errors';
import { resolveProjectForRequest } from '@truecourse/core/config/current-project';
import type {
  PullRequestCheckRecord,
  PullRequestCheckSummary,
  PullRequestListItem,
  PullRequestState,
  PullRequestStore,
  WorkspacePullRequestRow,
} from '@truecourse/shared';
import { orgOf } from '../services/workspace-llm.service.js';
import type { PullRequestChecks } from '../services/pull-request-checks.service.js';

export interface PullsRouterDeps {
  pulls: PullRequestStore;
  /** Absent when GitHub is not configured: a re-run then answers 503. */
  checks: PullRequestChecks | null;
}

const STATES: readonly (PullRequestState | 'all')[] = ['open', 'closed', 'merged', 'all'];

function stateOf(req: Request): PullRequestState | 'all' {
  const raw = req.query.state ?? 'open';
  if (typeof raw !== 'string' || !STATES.includes(raw as PullRequestState | 'all')) {
    throw createAppError(`state must be one of ${STATES.join(', ')}.`, 400);
  }
  return raw as PullRequestState | 'all';
}

function numberOf(req: Request): number {
  const number = Number(req.params.number);
  if (!Number.isInteger(number) || number <= 0) throw createAppError('The pull request number must be a positive integer.', 400);
  return number;
}

/** A check in one line: its state and the counts its report carries. */
function summarize(check: PullRequestCheckRecord): PullRequestCheckSummary {
  const report = check.report;
  return {
    id: check.id,
    attempt: check.attempt,
    status: check.status,
    conclusion: check.conclusion,
    reason: check.reason,
    createdAt: check.createdAt,
    settledAt: check.settledAt,
    counts: report
      ? {
          conflictsCreated: report.conflictsCreated.length,
          sectionsMoved: report.sectionsMoved.length,
          newFailures: report.run?.counts.newFailures ?? 0,
          preExisting: report.run?.counts.preExisting ?? 0,
          fixed: report.run?.counts.fixed ?? 0,
        }
      : null,
  };
}

export function createPullsRouter(deps: PullsRouterDeps): Router {
  const router = Router();

  router.get('/:id/pulls', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const org = orgOf(req);
      const repo = await resolveProjectForRequest(org, req.params.id as string);
      const state = stateOf(req);
      const items: PullRequestListItem[] = [];
      for (const pr of await deps.pulls.listPullRequests(repo.name, { state })) {
        if (pr.workspaceOrgId !== org) continue;
        const latest = await deps.pulls.latestCheck(pr.repoFullName, pr.number);
        items.push({ ...pr, check: latest ? summarize(latest) : null });
      }
      res.json({ pullRequests: items });
    } catch (e) {
      next(e);
    }
  });

  router.get('/:id/pulls/:number/checks/:checkId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const org = orgOf(req);
      const repo = await resolveProjectForRequest(org, req.params.id as string);
      const number = numberOf(req);
      const pr = await deps.pulls.getPullRequest(repo.name, number);
      const check = await deps.pulls.getCheck(req.params.checkId as string);
      if (!pr || pr.workspaceOrgId !== org || !check || check.repoFullName !== repo.name || check.number !== number) {
        res.status(404).json({ error: 'No such check.' });
        return;
      }
      res.json({ check });
    } catch (e) {
      next(e);
    }
  });

  router.post('/:id/pulls/:number/rerun', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const org = orgOf(req);
      const repo = await resolveProjectForRequest(org, req.params.id as string);
      const pr = await deps.pulls.getPullRequest(repo.name, numberOf(req));
      if (!pr || pr.workspaceOrgId !== org) {
        res.status(404).json({ error: 'No such pull request.' });
        return;
      }
      if (!deps.checks) {
        res.status(503).json({ error: 'GitHub is not configured on this server, so pull requests cannot be checked.' });
        return;
      }
      if (pr.state !== 'open') {
        res.status(409).json({ error: `#${pr.number} is ${pr.state}; only an open pull request is checked.` });
        return;
      }
      // A draft is held everywhere else; a re-run does not judge it early.
      if (pr.draft) {
        res.status(409).json({ error: `#${pr.number} is a draft; it is checked when it is ready for review.` });
        return;
      }
      if (await deps.pulls.activeCheck(pr.repoFullName, pr.number)) {
        res.status(409).json({ error: `#${pr.number} is being checked now.` });
        return;
      }
      const started = await deps.checks.start(pr);
      if (started.status !== 'queued') {
        res.status(409).json({ error: `#${pr.number}'s check could not be started: ${started.status}.` });
        return;
      }
      res.status(202).json({ checkId: started.checkId, jobId: started.jobId });
    } catch (e) {
      next(e);
    }
  });

  return router;
}

/** The workspace-wide read, mounted at `/api/context`. */
export function createWorkspacePullsRouter(deps: Pick<PullsRouterDeps, 'pulls'>): Router {
  const router = Router();

  router.get('/pull-requests', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const org = orgOf(req);
      const rows: WorkspacePullRequestRow[] = [];
      for (const pr of await deps.pulls.listWorkspacePullRequests(org, { state: 'open' })) {
        const check = await deps.pulls.latestCheck(pr.repoFullName, pr.number);
        if (!check || check.status !== 'settled' || !check.report) continue;
        // A settled check carries all three; the narrowing is for the type.
        if (!check.conclusion || !check.reason || !check.settledAt) continue;
        rows.push({
          ...pr,
          check: {
            id: check.id,
            conclusion: check.conclusion,
            reason: check.reason,
            settledAt: check.settledAt,
            conflictsCreated: check.report.conflictsCreated,
            sectionsMoved: check.report.sectionsMoved,
          },
        });
      }
      res.json({ pullRequests: rows });
    } catch (e) {
      next(e);
    }
  });

  return router;
}
