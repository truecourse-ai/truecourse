/**
 * All endpoints under the `/api/repos/:id/analyses` noun:
 *
 *   POST   /analyses          — start a run (body: `{mode, skipGit?}`)
 *   POST   /analyses/cancel   — abort the active run (either mode)
 *   GET    /analyses          — history list
 *   GET    /analyses/diff     — current diff.json contents
 *   GET    /analyses/:id/usage
 *   DELETE /analyses/:id
 *
 * Mounted at `/api/repos` under `projectResolver`.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import path from 'node:path';
import { AnalyzeRepoSchema } from '@truecourse/shared';
import { createAppError } from '../middleware/error.js';
import { resolveProjectForRequest } from '@truecourse/core/config/current-project';
import { readProjectConfig } from '@truecourse/core/config/project-config';
import type { RegistryEntry } from '@truecourse/core/config/registry';
import { analyzeInProcess } from '@truecourse/core/commands/analyze-in-process';
import { diffInProcess } from '@truecourse/core/commands/diff-in-process';
import {
  buildAnalysisSteps,
  createSocketLlmEstimateHandler,
  createSocketTracker,
  emitAnalysisProgress,
  emitAnalysisComplete,
  emitViolationsReady,
  emitAnalysisCanceled,
  type StepTracker,
} from '../socket/handlers.js';
import {
  cancelAnalysis,
  registerAnalysis,
  unregisterAnalysis,
} from '@truecourse/core/services/analysis-registry';
import { createLLMProvider, type LLMProvider } from '@truecourse/core/services/llm/provider';
import { trackEvent, bucketFileCount, bucketDuration } from '../services/telemetry.service.js';
import { getDiffResult } from '@truecourse/core/services/violation-query';
import {
  deleteAnalysis as deleteAnalysisFile,
  deleteDiff,
  deleteLatest,
  findAnalysisFilename,
  listAnalyses,
  readAnalysis,
  readHistory,
  readLatest,
  removeFromHistory,
  writeLatest,
} from '@truecourse/core/lib/analysis-store';
import type { LatestSnapshot } from '@truecourse/core/types/snapshot';
import { log, popLogger, pushLogger } from '@truecourse/core/lib/logger';

const router: Router = Router();

// ---------------------------------------------------------------------------
// POST /api/repos/:id/analyses — start a run (mode: 'full' | 'diff')
// ---------------------------------------------------------------------------

router.post('/:id/analyses', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const parsed = AnalyzeRepoSchema.safeParse(req.body);
    if (!parsed.success) throw createAppError('Invalid request body', 400);
    const { mode, skipGit } = parsed.data;

    const repo = resolveProjectForRequest(id);

    // Diff requires a baseline. Fail fast with 400 before the 202 accept
    // so the client doesn't wait on sockets that never come.
    if (mode === 'diff' && !readLatest(repo.path)) {
      throw createAppError('Run a full analysis first before checking a diff.', 400);
    }

    const projectConfig = readProjectConfig(repo.path);
    const effectiveCategories = projectConfig.enabledCategories ?? undefined;
    const effectiveLlmRules = projectConfig.enableLlmRules ?? true;

    // Register before the 202 so POST /analyses/cancel can find this run.
    const abortController = registerAnalysis(id, 'pending');

    res.status(202).json({ message: `${mode === 'diff' ? 'Diff check' : 'Analysis'} started`, repoId: id, mode });

    const trackerSteps = buildAnalysisSteps(effectiveCategories, effectiveLlmRules);
    const tracker = createSocketTracker(id, trackerSteps);

    pushLogger({
      filePath: path.join(repo.path, '.truecourse/logs/analyze.log'),
      tee: process.env.TRUECOURSE_DEV === '1',
    });

    try {
      if (mode === 'full') {
        await runFullAnalyze(id, repo, {
          skipGit,
          effectiveCategories,
          effectiveLlmRules,
          tracker,
          signal: abortController.signal,
        });
      } else {
        await runDiffAnalyze(id, repo, {
          tracker,
          signal: abortController.signal,
        });
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        log.info(`[${mode === 'diff' ? 'Diff' : 'Analysis'}] Cancelled for repo ${id}`);
        emitAnalysisCanceled(id);
      } else {
        log.error(
          `[${mode === 'diff' ? 'Diff' : 'Analysis'}] Failed for repo ${id}: ${error instanceof Error ? error.message : String(error)}`,
        );
        emitAnalysisProgress(id, {
          step: 'error',
          percent: -1,
          detail: error instanceof Error ? error.message : `${mode === 'diff' ? 'Diff check' : 'Analysis'} failed`,
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
// POST /api/repos/:id/analyses/cancel — abort active run (either mode)
// ---------------------------------------------------------------------------

router.post('/:id/analyses/cancel', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const canceled = cancelAnalysis(id);
    res.json({ message: canceled ? 'Analysis cancelling' : 'No active analysis' });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// GET /api/repos/:id/analyses — list (from history.json)
// ---------------------------------------------------------------------------

router.get('/:id/analyses', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const repo = resolveProjectForRequest(id);
    const history = readHistory(repo.path);
    const entries = history.analyses
      .filter((e) => !(e.metadata as Record<string, unknown> | null)?.isDiffAnalysis)
      .slice(-20)
      .reverse();

    res.json(
      entries.map((e) => ({
        id: e.id,
        status: 'completed',
        branch: e.branch,
        commitHash: e.commitHash,
        architecture: null,
        createdAt: e.createdAt,
        serviceCount: e.counts.services,
        violationsBySeverity: e.counts.violations.bySeverity,
        durationMs: e.usage.durationMs,
        totalTokens: e.usage.totalTokens,
        totalCost: e.usage.totalCostUsd,
        provider: e.usage.provider,
      })),
    );
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// GET /api/repos/:id/analyses/diff — current diff.json contents
// ---------------------------------------------------------------------------

router.get('/:id/analyses/diff', async (req: Request, res: Response, next: NextFunction) => {
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

// ---------------------------------------------------------------------------
// GET /api/repos/:id/analyses/:analysisId/usage
// ---------------------------------------------------------------------------

router.get('/:id/analyses/:analysisId/usage', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const analysisId = req.params.analysisId as string;
    const repo = resolveProjectForRequest(id);

    const latest = readLatest(repo.path);
    if (latest?.analysis.id === analysisId) {
      // Usage records live on the per-analysis file, not LATEST.
      const snap = readAnalysis(repo.path, latest.head);
      res.json(snap?.usage ?? []);
      return;
    }

    const filename = findAnalysisFilename(repo.path, analysisId);
    if (!filename) {
      res.json([]);
      return;
    }
    const snap = readAnalysis(repo.path, filename);
    res.json(snap?.usage ?? []);
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/repos/:id/analyses/:analysisId
// ---------------------------------------------------------------------------

router.delete('/:id/analyses/:analysisId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const analysisId = req.params.analysisId as string;
    const repo = resolveProjectForRequest(id);

    const filename = findAnalysisFilename(repo.path, analysisId);
    if (!filename) throw createAppError('Analysis not found', 404);

    deleteAnalysisFile(repo.path, filename);
    removeFromHistory(repo.path, analysisId);

    // If we just deleted the head, rebuild LATEST from the now-most-recent
    // remaining analysis (or clear it + diff.json).
    const latest = readLatest(repo.path);
    if (latest?.head === filename) {
      rebuildLatestFromHistory(repo.path);
      deleteDiff(repo.path);
    }

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// Mode-specific bodies
// ---------------------------------------------------------------------------

interface StartRunOptions {
  skipGit?: boolean;
  effectiveCategories?: string[];
  effectiveLlmRules: boolean;
  tracker: StepTracker;
  signal: AbortSignal;
}

async function runFullAnalyze(id: string, repo: RegistryEntry, opts: StartRunOptions): Promise<void> {
  const provider: LLMProvider | undefined = opts.effectiveLlmRules ? createLLMProvider() : undefined;
  if (provider) {
    provider.setRepoId(id);
    provider.setRepoPath(repo.path);
    provider.setAbortSignal(opts.signal);
  }

  const outcome = await analyzeInProcess(repo, {
    skipGit: opts.skipGit,
    enabledCategoriesOverride: opts.effectiveCategories,
    enableLlmRulesOverride: opts.effectiveLlmRules,
    tracker: opts.tracker,
    signal: opts.signal,
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
}

async function runDiffAnalyze(id: string, repo: RegistryEntry, opts: Pick<StartRunOptions, 'tracker' | 'signal'>): Promise<void> {
  const { diff } = await diffInProcess(repo, {
    tracker: opts.tracker,
    signal: opts.signal,
    onLlmEstimate: createSocketLlmEstimateHandler(id),
  });

  emitViolationsReady(id, diff.id);
  emitAnalysisComplete(id, diff.id);
}

// ---------------------------------------------------------------------------
// LATEST rebuild (used by DELETE when the deleted analysis was the head)
// ---------------------------------------------------------------------------

function rebuildLatestFromHistory(repoPath: string): void {
  const files = listAnalyses(repoPath);
  if (files.length === 0) {
    deleteLatest(repoPath);
    return;
  }
  const newest = files[files.length - 1];
  const snap = readAnalysis(repoPath, newest);
  if (!snap) {
    deleteLatest(repoPath);
    return;
  }
  // Walk forward through snapshots applying added/resolved to reconstruct
  // the currently-active violation set.
  const active = new Map<string, ReturnType<typeof readAnalysis>>();
  for (const fname of files) {
    const s = readAnalysis(repoPath, fname);
    if (!s) continue;
    for (const r of s.violations.resolved) active.delete(r.id);
    for (const a of s.violations.added) active.set(a.id, s);
  }
  const serviceById = new Map(snap.graph.services.map((s) => [s.id, s.name]));
  const moduleById = new Map(snap.graph.modules.map((m) => [m.id, m.name]));
  const methodById = new Map(snap.graph.methods.map((m) => [m.id, m.name]));
  const databaseById = new Map(snap.graph.databases.map((d) => [d.id, d.name]));

  const latest: LatestSnapshot = {
    head: newest,
    analysis: {
      id: snap.id,
      createdAt: snap.createdAt,
      branch: snap.branch,
      commitHash: snap.commitHash,
      architecture: snap.architecture,
      metadata: snap.metadata,
      status: 'completed',
    },
    graph: snap.graph,
    violations: [],
  };

  for (const snapshot of new Set(active.values())) {
    if (!snapshot) continue;
    for (const v of snapshot.violations.added) {
      if (!active.has(v.id)) continue;
      latest.violations.push({
        ...v,
        targetServiceName: v.targetServiceId ? serviceById.get(v.targetServiceId) ?? null : null,
        targetModuleName: v.targetModuleId ? moduleById.get(v.targetModuleId) ?? null : null,
        targetMethodName: v.targetMethodId ? methodById.get(v.targetMethodId) ?? null : null,
        targetDatabaseName: v.targetDatabaseId ? databaseById.get(v.targetDatabaseId) ?? null : null,
      });
    }
  }

  writeLatest(repoPath, latest);
}

export default router;
