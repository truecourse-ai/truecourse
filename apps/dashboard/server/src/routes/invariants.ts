/**
 * Invariants HTTP surface — stub Phase 1 UI per docs/INVARIANTS.md § Discovery UX.
 *
 *   GET    /api/repos/:id/invariants                 — active list
 *   DELETE /api/repos/:id/invariants/:slug           — retire active
 *   POST   /api/repos/:id/invariants/suggest         — trigger discovery (202; streams over socket)
 *   GET    /api/repos/:id/invariant-drafts           — pending review queue
 *   POST   /api/repos/:id/invariant-drafts/:draftId/accept
 *   POST   /api/repos/:id/invariant-drafts/:draftId/reject
 *
 * All routes are mounted at `/api/repos` under `projectResolver`. Discovery is
 * fire-and-forget: 202 returns immediately, progress events stream over the
 * `repo:<id>` socket room as `invariants:progress` / `invariants:complete` /
 * `invariants:failed`.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import path from 'node:path';
import { resolveProjectForRequest } from '@truecourse/core/config/current-project';
import { createAppError } from '@truecourse/core/lib/errors';
import {
  suggestInvariants,
  acceptDraft,
  rejectDraft,
  retireBySlug,
  listActive,
  listPendingDrafts,
  type ProgressEvent,
} from '@truecourse/core/services/invariants';
import { createLLMProvider } from '@truecourse/core/services/llm/provider';
import { log, popLogger, pushLogger } from '@truecourse/core/lib/logger';
import {
  emitInvariantsProgress,
  emitInvariantsComplete,
  emitInvariantsFailed,
} from '../socket/handlers.js';

const router: Router = Router();

// Track in-progress suggest runs so a second POST returns 409 instead of
// double-spawning LLM calls.
const activeSuggests = new Set<string>();

// ---------------------------------------------------------------------------
// GET /api/repos/:id/invariants — active list
// ---------------------------------------------------------------------------

router.get('/:id/invariants', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const repo = resolveProjectForRequest(id);
    const active = listActive(repo.path);
    res.json(active);
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// GET /api/repos/:id/invariant-drafts — review queue
// ---------------------------------------------------------------------------

router.get('/:id/invariant-drafts', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const repo = resolveProjectForRequest(id);
    const drafts = listPendingDrafts(repo.path);
    res.json(drafts);
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// POST /api/repos/:id/invariants/suggest — trigger discovery (202)
// Body: `{ mode?: 'full' | 'diff' }` (defaults to 'full').
// ---------------------------------------------------------------------------

router.post('/:id/invariants/suggest', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const repo = resolveProjectForRequest(id);

    if (activeSuggests.has(id)) {
      throw createAppError('Invariant discovery is already running for this repo', 409);
    }

    const mode: 'full' | 'diff' = req.body?.mode === 'diff' ? 'diff' : 'full';
    activeSuggests.add(id);
    res.status(202).json({ message: 'Invariant discovery started', repoId: id, mode });

    pushLogger({
      filePath: path.join(repo.path, '.truecourse/logs/invariants.log'),
      tee: process.env.TRUECOURSE_DEV === '1',
    });

    const llm = createLLMProvider();
    llm.setRepoPath(repo.path);
    llm.setRepoId(id);

    try {
      const result = await suggestInvariants({
        repoPath: repo.path,
        mode,
        llm,
        onProgress: (event: ProgressEvent) => emitInvariantsProgress(id, event),
      });
      emitInvariantsComplete(id, {
        drafts: result.drafts.length,
        pluginsRun: result.pluginsRun,
        pluginsSkipped: result.pluginsSkipped,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error(`[Invariants] suggest failed for repo ${id}: ${message}`);
      emitInvariantsFailed(id, message);
    } finally {
      activeSuggests.delete(id);
      popLogger();
    }
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// POST /api/repos/:id/invariant-drafts/:draftId/accept
// ---------------------------------------------------------------------------

router.post(
  '/:id/invariant-drafts/:draftId/accept',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      const draftId = req.params.draftId as string;
      const repo = resolveProjectForRequest(id);

      try {
        const result = acceptDraft(repo.path, draftId);
        res.json({ slug: result.slug, invariant: result.invariant });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (/not found/i.test(message)) {
          throw createAppError(`Draft "${draftId}" not found`, 404);
        }
        throw err;
      }
    } catch (error) {
      next(error);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/repos/:id/invariant-drafts/:draftId/reject
// ---------------------------------------------------------------------------

router.post(
  '/:id/invariant-drafts/:draftId/reject',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      const draftId = req.params.draftId as string;
      const repo = resolveProjectForRequest(id);

      try {
        rejectDraft(repo.path, draftId);
        res.json({ ok: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (/not found/i.test(message)) {
          throw createAppError(`Draft "${draftId}" not found`, 404);
        }
        throw err;
      }
    } catch (error) {
      next(error);
    }
  },
);

// ---------------------------------------------------------------------------
// DELETE /api/repos/:id/invariants/:slug — retire an active invariant
// ---------------------------------------------------------------------------

router.delete('/:id/invariants/:slug', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const slug = req.params.slug as string;
    const repo = resolveProjectForRequest(id);

    const removed = retireBySlug(repo.path, slug);
    if (!removed) throw createAppError(`No active invariant with slug "${slug}"`, 404);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

export default router;
