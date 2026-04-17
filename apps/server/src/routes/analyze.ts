import { Router, type Request, type Response, type NextFunction } from 'express';
import { eq } from 'drizzle-orm';
import { AnalyzeRepoSchema } from '@truecourse/shared';
import { createAppError } from '../middleware/error.js';
import { getGit } from '../lib/git.js';
import { resolveProjectForRequest } from '../config/current-project.js';
import { readProjectConfig } from '../config/project-config.js';
import { db, initializeProjectDb, withProjectDb } from '../config/database.js';
import { analyses } from '../db/schema.js';
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
import path from 'node:path';

/**
 * Routes that trigger or cancel analysis. Mounted WITHOUT `projectResolver`
 * because POST /analyze creates the project's PGlite on first run —
 * `projectResolver` would reject with NO_PROJECT_DB before the handler could
 * bootstrap it. Everything inside the handler that reads/writes the DB is
 * scoped via its own `withProjectDb`.
 */
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

    let branch: string | null = null;
    let commitHash: string | null = null;
    if (!skipGit) {
      const git = await getGit(repo.path);
      branch = (await git.branch()).current || null;
      commitHash = (await git.revparse(['HEAD'])).trim();
    }

    // Bootstrap .truecourse/db/ on first run so the subsequent `withProjectDb`
    // can open it. Also invalidates any stale cache entry if the user
    // deleted the DB dir while the server was running.
    await initializeProjectDb(repo);

    // Insert the `running` row synchronously so the client gets a real
    // analysisId in the 202. `analyzeInProcess` reuses it via
    // `existingAnalysisId`.
    const runningAnalysisId = await withProjectDb(repo, async () => {
      const [row] = await db
        .insert(analyses)
        .values({
          id: crypto.randomUUID(),
          branch,
          status: 'running',
          architecture: 'unknown',
          commitHash,
        })
        .returning();
      return row.id;
    });

    res.status(202).json({
      message: 'Analysis started',
      repoId: id,
      branch,
      analysisId: runningAnalysisId,
    });

    const abortController = registerAnalysis(id, runningAnalysisId);

    const trackerSteps = buildAnalysisSteps(effectiveCategories, effectiveLlmRules);
    const tracker = createSocketTracker(id, trackerSteps);

    const provider = effectiveLlmRules ? createLLMProvider() : undefined;
    if (provider) {
      provider.setRepoId(id);
      provider.setRepoPath(repo.path);
      provider.setAbortSignal(abortController.signal);
    }

    // Route the pipeline's internal logs into the target repo's analyze.log
    // for the duration of this request. Route-level events (above) stay in
    // the dashboard log. popLogger in finally restores the dashboard sink.
    pushLogger({
      filePath: path.join(repo.path, '.truecourse/logs/analyze.log'),
      tee: process.env.TRUECOURSE_DEV === '1',
    });

    try {
      const outcome = await analyzeInProcess(repo, {
        existingAnalysisId: runningAnalysisId,
        branch,
        commitHash,
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
              analysisId: runningAnalysisId,
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

            function onProceed(data: { analysisId: string; proceed: boolean }) {
              if (data.analysisId !== runningAnalysisId) return;
              cleanup();
              io.to(room).emit('analysis:llm-resolved', {
                analysisId: runningAnalysisId,
                proceed: data.proceed,
              });
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
    const repo = resolveProjectForRequest(id);
    const canceled = cancelAnalysis(id);
    if (canceled) {
      await withProjectDb(repo, async () => {
        await db.update(analyses).set({ status: 'cancelling' }).where(eq(analyses.status, 'running'));
      });
    }
    res.json({ message: canceled ? 'Analysis cancelling' : 'No active analysis' });
  } catch (error) {
    next(error);
  }
});

export default router;
