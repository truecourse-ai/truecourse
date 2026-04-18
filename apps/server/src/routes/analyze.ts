/**
 * Long-running analysis endpoints — full analyze, diff-check, and cancel.
 * All four share the same 202-accepted + socket-progress contract so the
 * dashboard's progress panel + LLM-estimate dialog fire uniformly regardless
 * of which mode the user started.
 *
 *   POST /analyze        — background full analyze; emits analysis:progress, analysis:llm-estimate, analysis:complete
 *   POST /analyze/cancel — aborts whichever run is registered for this repo (analyze OR diff)
 *   POST /diff-check     — background diff against LATEST; same event stream as /analyze
 *   GET  /diff-check     — reads the persisted diff.json (no-op if absent)
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import path from 'node:path';
import { AnalyzeRepoSchema } from '@truecourse/shared';
import { createAppError } from '../middleware/error.js';
import { resolveProjectForRequest } from '../config/current-project.js';
import { readProjectConfig } from '../config/project-config.js';
import { analyzeInProcess } from '../commands/analyze-in-process.js';
import { diffInProcess } from '../commands/diff-in-process.js';
import {
  buildAnalysisSteps,
  createSocketLlmEstimateHandler,
  createSocketTracker,
  emitAnalysisProgress,
  emitAnalysisComplete,
  emitViolationsReady,
  emitAnalysisCanceled,
} from '../socket/handlers.js';
import {
  registerAnalysis,
  unregisterAnalysis,
  cancelAnalysis,
} from '../services/analysis-registry.js';
import { createLLMProvider } from '../services/llm/provider.js';
import { trackEvent, bucketFileCount, bucketDuration } from '../services/telemetry.service.js';
import { readLatest } from '../lib/analysis-store.js';
import { getDiffResult } from '../services/violation-query.service.js';
import { log, popLogger, pushLogger } from '../lib/logger.js';

const router: Router = Router();

// ---------------------------------------------------------------------------
// POST /api/repos/:id/analyze — start full analyze (202 + sockets)
// ---------------------------------------------------------------------------

router.post('/:id/analyze', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const parsed = AnalyzeRepoSchema.safeParse(req.body);
    if (!parsed.success) throw createAppError('Invalid request body', 400);

    const { enabledCategories: globalEnabledCategories, enableLlmRules, skipGit } = parsed.data;

    const repo = resolveProjectForRequest(id);
    const projectConfig = readProjectConfig(repo.path);

    const effectiveCategories = globalEnabledCategories?.length
      ? globalEnabledCategories
      : (projectConfig.enabledCategories ?? undefined);
    const effectiveLlmRules = projectConfig.enableLlmRules ?? enableLlmRules;

    // Register before the 202 so `POST /analyze/cancel` can find this run.
    const abortController = registerAnalysis(id, 'pending');

    res.status(202).json({ message: 'Analysis started', repoId: id });

    const trackerSteps = buildAnalysisSteps(effectiveCategories, effectiveLlmRules);
    const tracker = createSocketTracker(id, trackerSteps);

    const provider = effectiveLlmRules ? createLLMProvider() : undefined;
    if (provider) {
      provider.setRepoId(id);
      provider.setRepoPath(repo.path);
      provider.setAbortSignal(abortController.signal);
    }

    pushLogger({
      filePath: path.join(repo.path, '.truecourse/logs/analyze.log'),
      tee: process.env.TRUECOURSE_DEV === '1',
    });

    try {
      const outcome = await analyzeInProcess(repo, {
        skipGit,
        enabledCategoriesOverride: effectiveCategories,
        enableLlmRulesOverride: effectiveLlmRules,
        tracker,
        signal: abortController.signal,
        provider,
        onLlmEstimate: createSocketLlmEstimateHandler(id),
      });

      emitViolationsReady(id, outcome.analysisId);
      emitAnalysisComplete(id, outcome.analysisId);

      trackEvent('analyze', {
        serviceCount: outcome.serviceCount,
        fileCountRange: bucketFileCount(outcome.fileCount),
        languages: [],
        architecture: outcome.architecture,
        durationRange: bucketDuration(outcome.durationMs),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        log.info(`[Analysis] Cancelled for repo ${id}`);
        emitAnalysisCanceled(id);
      } else {
        log.error(`[Analysis] Failed for repo ${id}: ${error instanceof Error ? error.message : String(error)}`);
        emitAnalysisProgress(id, {
          step: 'error',
          percent: -1,
          detail: error instanceof Error ? error.message : 'Analysis failed',
        });
      }
    } finally {
      unregisterAnalysis(id);
      popLogger();
    }
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// POST /api/repos/:id/analyze/cancel — aborts the active run (analyze or diff)
// ---------------------------------------------------------------------------

router.post('/:id/analyze/cancel', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const canceled = cancelAnalysis(id);
    res.json({ message: canceled ? 'Analysis cancelling' : 'No active analysis' });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// POST /api/repos/:id/diff-check — start diff against LATEST (202 + sockets)
// ---------------------------------------------------------------------------

router.post('/:id/diff-check', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const repo = resolveProjectForRequest(id);

    // Short-circuit: diff requires a baseline. Fail fast with 400 before the
    // 202 accept — otherwise the client would wait on sockets that never come.
    if (!readLatest(repo.path)) {
      throw createAppError('Run a full analysis first before checking a diff.', 400);
    }

    const projectConfig = readProjectConfig(repo.path);
    const effectiveCategories = projectConfig.enabledCategories ?? undefined;
    const effectiveLlmRules = projectConfig.enableLlmRules ?? true;

    const abortController = registerAnalysis(id, 'pending');

    res.status(202).json({ message: 'Diff check started', repoId: id });

    const trackerSteps = buildAnalysisSteps(effectiveCategories, effectiveLlmRules);
    const tracker = createSocketTracker(id, trackerSteps);

    pushLogger({
      filePath: path.join(repo.path, '.truecourse/logs/analyze.log'),
      tee: process.env.TRUECOURSE_DEV === '1',
    });

    try {
      const { diff } = await diffInProcess(repo, {
        tracker,
        signal: abortController.signal,
        onLlmEstimate: createSocketLlmEstimateHandler(id),
      });

      emitViolationsReady(id, diff.id);
      emitAnalysisComplete(id, diff.id);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        log.info(`[Diff] Cancelled for repo ${id}`);
        emitAnalysisCanceled(id);
      } else {
        log.error(`[Diff] Failed for repo ${id}: ${error instanceof Error ? error.message : String(error)}`);
        emitAnalysisProgress(id, {
          step: 'error',
          percent: -1,
          detail: error instanceof Error ? error.message : 'Diff check failed',
        });
      }
    } finally {
      unregisterAnalysis(id);
      popLogger();
    }
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// GET /api/repos/:id/diff-check — return persisted diff.json
// ---------------------------------------------------------------------------

router.get('/:id/diff-check', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const repo = resolveProjectForRequest(id);
    const result = getDiffResult(repo.path);
    if (!result) {
      res.json(null);
      return;
    }
    const { diff, isStale } = result;

    res.json({
      resolvedViolations: diff.resolvedViolations,
      newViolations: diff.newViolations,
      affectedNodeIds: diff.affectedNodeIds,
      summary: diff.summary,
      changedFiles: diff.changedFiles,
      isStale,
      diffAnalysisId: diff.id,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
