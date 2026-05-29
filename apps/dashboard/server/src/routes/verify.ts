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

import { Router, type Request, type Response, type NextFunction } from 'express';
import {
  VERIFY_STEPS,
  readVerifyState,
  verifyInProcess,
  verifyDiffInProcess,
  readVerifyDiff,
} from '@truecourse/core/commands/spec-in-process';
import { resolveProjectForRequest } from '@truecourse/core/config/current-project';
import {
  createSocketSpecTracker,
  emitSpecComplete,
  emitSpecProgress,
} from '../socket/handlers.js';

const router: Router = Router();

router.get(
  '/:id/verify/state',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const repo = resolveProjectForRequest(req.params.id as string);
      const state = readVerifyState(repo.path);
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
      const repo = resolveProjectForRequest(req.params.id as string);
      repoIdForCleanup = req.params.id as string;
      // Verify reuses the same Spec progress socket channel — the
      // popup component is identical to Scan/Apply, just driven by
      // VERIFY_STEPS instead of the spec-side step lists.
      const tracker = createSocketSpecTracker(
        repoIdForCleanup,
        VERIFY_STEPS.map((s) => ({ ...s })),
      );
      const { state } = await verifyInProcess(repo.path, { tracker });
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
  '/:id/verify/diff',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const repo = resolveProjectForRequest(req.params.id as string);
      const diff = readVerifyDiff(repo.path);
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
      const repo = resolveProjectForRequest(req.params.id as string);
      repoIdForCleanup = req.params.id as string;
      const tracker = createSocketSpecTracker(
        repoIdForCleanup,
        VERIFY_STEPS.map((s) => ({ ...s })),
      );
      const { diff } = await verifyDiffInProcess(repo.path, { tracker });
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
