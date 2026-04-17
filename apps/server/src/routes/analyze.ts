import { Router, type Request, type Response, type NextFunction } from 'express';
import path from 'node:path';
import { AnalyzeRepoSchema } from '@truecourse/shared';
import { createAppError } from '../middleware/error.js';
import { resolveProjectForRequest } from '../config/current-project.js';
import { readProjectConfig } from '../config/project-config.js';
import { analyzeInProcess } from '../commands/analyze-in-process.js';
import {
  buildAnalysisSteps,
  createSocketTracker,
  emitAnalysisProgress,
  emitAnalysisComplete,
  emitViolationsReady,
  emitAnalysisCanceled,
} from '../socket/handlers.js';
import { getIO } from '../socket/index.js';
import {
  registerAnalysis,
  unregisterAnalysis,
  cancelAnalysis,
} from '../services/analysis-registry.js';
import { createLLMProvider } from '../services/llm/provider.js';
import { trackEvent, bucketFileCount, bucketDuration } from '../services/telemetry.service.js';
import { log, popLogger, pushLogger } from '../lib/logger.js';

const router: Router = Router();

// POST /api/repos/:id/analyze
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

    // Register for cancellation before we start so the `cancel` route can
    // find this run. The analysisId is assigned inside `analyzeInProcess`,
    // so we correlate by repo id on the socket events.
    const abortController = registerAnalysis(id, 'pending');

    res.status(202).json({
      message: 'Analysis started',
      repoId: id,
    });

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
        onLlmEstimate: (estimate) =>
          new Promise<boolean>((resolve) => {
            const io = getIO();
            const room = `repo:${id}`;

            io.to(room).emit('analysis:llm-estimate', {
              repoId: id,
              estimate: {
                totalEstimatedTokens: estimate.totalEstimatedTokens,
                tiers: estimate.tiers,
                uniqueFileCount: estimate.uniqueFileCount,
                uniqueRuleCount: estimate.uniqueRuleCount,
              },
            });

            const timeout = setTimeout(() => {
              cleanup();
              resolve(true);
            }, 60_000);

            function onProceed(data: { repoId: string; proceed: boolean }) {
              if (data.repoId !== id) return;
              cleanup();
              io.to(room).emit('analysis:llm-resolved', { repoId: id, proceed: data.proceed });
              resolve(data.proceed);
            }

            function cleanup() {
              clearTimeout(timeout);
              for (const [, socket] of io.sockets.sockets) {
                socket.removeListener('analysis:llm-proceed', onProceed);
              }
            }

            for (const [, socket] of io.sockets.sockets) {
              socket.on('analysis:llm-proceed', onProceed);
            }
          }),
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

// POST /api/repos/:id/analyze/cancel
router.post('/:id/analyze/cancel', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const canceled = cancelAnalysis(id);
    res.json({ message: canceled ? 'Analysis cancelling' : 'No active analysis' });
  } catch (error) {
    next(error);
  }
});

export default router;
