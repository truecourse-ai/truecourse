/**
 * Verify routes — the dashboard surface for Module 3 (contract drift).
 *
 *   GET   /api/repos/:id/verify/state
 *           Read the persisted verify-state.json. Returns 404 if no
 *           verify run has been recorded yet — the dashboard then
 *           shows a "Run verify" CTA. Cheap; no compute.
 *
 *   POST  /api/repos/:id/verify/run
 *           Run verifyInProcess, persist the state, return it. Same
 *           code path as the CLI's `truecourse verify`.
 */

import path from 'node:path';
import { Router, type Request, type Response, type NextFunction } from 'express';
import {
  VERIFY_STEPS,
  readVerifyState,
  readVerifyRunState,
  verifyInProcess,
  verifyDiffInProcess,
  readVerifyDiff,
  readVerifyHistory,
  deleteVerifyRun,
  type VerifyState,
} from '@truecourse/core/commands/spec-in-process';
import { resolveProjectForRequest } from '@truecourse/core/config/current-project';
import { loadSpec } from '@truecourse/core/lib/spec-store';
import { getGit, isGitRepo, NOT_A_GIT_REPO_MESSAGE } from '@truecourse/core/lib/git';
import {
  createSocketSpecTracker,
  createSocketStashConfirmHandler,
  emitSpecComplete,
  emitSpecProgress,
} from '../socket/handlers.js';

const router: Router = Router();

/**
 * Mirror of the analyze run's stash decision: clean tree / subdir-repo /
 * non-git → 'stash' (no prompt); dirty → prompt the client via the shared
 * `analysis:stash-confirm-*` socket dialog.
 */
async function resolveVerifyStashDecision(
  repoId: string,
  repoPath: string,
): Promise<'stash' | 'no-stash' | 'cancel'> {
  let modifiedCount = 0;
  let untrackedCount = 0;
  try {
    const git = await getGit(repoPath);
    const status = await git.status();
    if (status.isClean()) return 'stash';
    const gitRoot = (await git.revparse(['--show-toplevel'])).trim();
    if (path.resolve(repoPath) !== path.resolve(gitRoot)) return 'stash';
    modifiedCount =
      status.modified.length + status.staged.length + status.deleted.length + status.created.length;
    untrackedCount = status.not_added.length;
  } catch {
    return 'stash';
  }
  return createSocketStashConfirmHandler(repoId)({ modifiedCount, untrackedCount });
}

router.get(
  '/:id/verify/state',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const repo = await resolveProjectForRequest(req.params.id as string);
      // `?ref=<commit>` (EE ref switcher) → that commit's persisted snapshot;
      // omitted → the repo's latest verify state.
      const ref = typeof req.query.ref === 'string' ? req.query.ref.trim() : '';
      const state = ref
        ? await loadSpec<VerifyState>({ repoKey: repo.path, commitSha: ref }, 'verifyState')
        : await readVerifyState(repo.path);
      if (!state) {
        res.status(404).json({ error: 'No verify run has been recorded yet.' });
        return;
      }
      res.json(state);
    } catch (e) {
      next(e);
    }
  },
);

router.post(
  '/:id/verify/run',
  async (req: Request, res: Response, next: NextFunction) => {
    let repoIdForCleanup: string | null = null;
    try {
      const repo = await resolveProjectForRequest(req.params.id as string);
      repoIdForCleanup = req.params.id as string;
      if (!(await isGitRepo(repo.path))) {
        res.status(400).json({ error: NOT_A_GIT_REPO_MESSAGE });
        return;
      }
      // Verify reuses the same Spec progress socket channel — the
      // popup component is identical to Scan/Apply, just driven by
      // VERIFY_STEPS instead of the spec-side step lists.
      // Like a full analyze, ask to stash a dirty tree first so the baseline
      // reflects the committed state.
      const stashDecision = await resolveVerifyStashDecision(repoIdForCleanup, repo.path);
      if (stashDecision === 'cancel') {
        res.status(409).json({ error: 'Verify canceled.', canceled: true });
        return;
      }
      const tracker = createSocketSpecTracker(
        repoIdForCleanup,
        VERIFY_STEPS.map((s) => ({ ...s })),
      );
      const { state } = await verifyInProcess(repo.path, {
        tracker,
        skipStash: stashDecision === 'no-stash',
        source: 'dashboard',
      });
      emitSpecComplete(repoIdForCleanup, 'verify');
      res.json(state);
    } catch (e) {
      if (repoIdForCleanup) {
        emitSpecProgress(repoIdForCleanup, {
          step: 'error',
          percent: 100,
          detail: (e as Error).message,
        });
      }
      next(e);
    }
  },
);

router.get(
  '/:id/verify/history',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const repo = await resolveProjectForRequest(req.params.id as string);
      res.json(await readVerifyHistory(repo.path));
    } catch (e) {
      next(e);
    }
  },
);

router.get(
  '/:id/verify/runs/:runId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const repo = await resolveProjectForRequest(req.params.id as string);
      const state = await readVerifyRunState(repo.path, req.params.runId as string);
      if (!state) {
        res.status(404).json({ error: 'Verify run not found.' });
        return;
      }
      res.json(state);
    } catch (e) {
      next(e);
    }
  },
);

router.delete(
  '/:id/verify/runs/:runId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const repo = await resolveProjectForRequest(req.params.id as string);
      const deleted = await deleteVerifyRun(repo.path, req.params.runId as string);
      if (!deleted) {
        res.status(404).json({ error: 'Verify run not found.' });
        return;
      }
      res.json({ deleted: true });
    } catch (e) {
      next(e);
    }
  },
);

router.get(
  '/:id/verify/diff',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const repo = await resolveProjectForRequest(req.params.id as string);
      const diff = await readVerifyDiff(repo.path);
      if (!diff) {
        res.status(404).json({ error: 'No verify diff has been computed yet.' });
        return;
      }
      res.json(diff);
    } catch (e) {
      next(e);
    }
  },
);

router.post(
  '/:id/verify/diff',
  async (req: Request, res: Response, next: NextFunction) => {
    let repoIdForCleanup: string | null = null;
    try {
      const repo = await resolveProjectForRequest(req.params.id as string);
      repoIdForCleanup = req.params.id as string;
      const tracker = createSocketSpecTracker(
        repoIdForCleanup,
        VERIFY_STEPS.map((s) => ({ ...s })),
      );
      const { diff } = await verifyDiffInProcess(repo.path, { tracker, source: 'dashboard' });
      emitSpecComplete(repoIdForCleanup, 'verify');
      res.json(diff);
    } catch (e) {
      if (repoIdForCleanup) {
        emitSpecProgress(repoIdForCleanup, {
          step: 'error',
          percent: 100,
          detail: (e as Error).message,
        });
      }
      next(e);
    }
  },
);

export default router;
