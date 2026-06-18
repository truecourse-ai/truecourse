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
import { createAppError } from '@truecourse/core/lib/errors';
import { resolveProjectForRequest } from '@truecourse/core/config/current-project';
import { readProjectConfig } from '@truecourse/core/config/project-config';
import type { RegistryEntry } from '@truecourse/core/config/registry';
import { analyzeInProcess } from '@truecourse/core/commands/analyze-in-process';
import { diffInProcess } from '@truecourse/core/commands/diff-in-process';
import { buildAnalysisSteps, type StepTracker } from '@truecourse/core/progress';
import { getGit } from '@truecourse/core/lib/git';
import {
  createSocketLlmEstimateHandler,
  createSocketStashConfirmHandler,
  createSocketTracker,
  emitAnalysisProgress,
  emitAnalysisComplete,
  emitViolationsReady,
  emitAnalysisCanceled,
} from '../socket/handlers.js';
import {
  cancelAnalysis,
  registerAnalysis,
  unregisterAnalysis,
} from '@truecourse/core/services/analysis-registry';
import { createLLMProvider, type LLMProvider } from '@truecourse/core/services/llm/provider';
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
import {
  readInferredDecisions,
  readInferredDecisionsAt,
  readDismissedDecisions,
  dismissInferredDecision,
  undismissInferredDecision,
  promoteInferredDecision,
  diffDecisions,
} from '@truecourse/core/lib/inferred-decisions';
import { inferDiffInProcess } from '@truecourse/core/commands/spec-in-process';
import { baselineCommit } from './diff-base.js';
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

    const repo = await resolveProjectForRequest(id);

    // Diff requires a baseline. Fail fast with 400 before the 202 accept
    // so the client doesn't wait on sockets that never come.
    if (mode === 'diff' && !(await readLatest(repo.path))) {
      throw createAppError('Run a full analysis first before checking a diff.', 400);
    }

    const projectConfig = await readProjectConfig(repo.path);
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
    const repo = await resolveProjectForRequest(id);
    const history = await readHistory(repo.path);
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
    const repo = await resolveProjectForRequest(id);
    // EE PR view: read the PR-scoped Code Quality diff the gate persisted under
    // `<repoKey>::pr/<n>` (new/resolved vs the baseline). OSS / no `?pr` → the
    // repo's own working-tree diff.
    const prParam = req.query.pr as string | undefined;
    const diffKey = prParam && /^\d+$/.test(prParam) ? `${repo.path}::pr/${prParam}` : repo.path;
    const result = await getDiffResult(diffKey);
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
// Inferred (undocumented) decisions — the Inferred tab (OSS + EE, shared).
//   GET  /api/repos/:id/inferred           — list (overlay-filtered)
//   POST /api/repos/:id/inferred/dismiss   — { kind, identity }
//   POST /api/repos/:id/inferred/promote   — { kind, identity } → authored contract
// ---------------------------------------------------------------------------

router.get('/:id/inferred', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = await resolveProjectForRequest(req.params.id as string);
    res.json(await readInferredDecisions(repo.path));
  } catch (error) {
    next(error);
  }
});

router.get('/:id/inferred/dismissed', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = await resolveProjectForRequest(req.params.id as string);
    res.json({ decisions: await readDismissedDecisions(repo.path) });
  } catch (error) {
    next(error);
  }
});

// PR diff (EE): undocumented decisions the PR head adds/changes vs the baseline.
router.get('/:id/inferred/diff', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = await resolveProjectForRequest(req.params.id as string);
    const ref = typeof req.query.ref === 'string' ? req.query.ref.trim() : '';
    const head = ref ? await readInferredDecisionsAt({ repoKey: repo.path, commitSha: ref }) : null;
    if (!ref || head == null) {
      res.json({ added: [], changed: [], resolved: [], fellBack: false });
      return;
    }
    const baseCommit = await baselineCommit(repo.path);
    const base = baseCommit
      ? await readInferredDecisionsAt({ repoKey: repo.path, commitSha: baseCommit })
      : null;
    const { added, changed, resolved, fellBack } = diffDecisions(head, base);
    res.json({ added, changed, resolved, fellBack });
  } catch (error) {
    next(error);
  }
});

// OSS Git-Diff: re-run inference on the working tree and diff vs the committed
// `inferredDecisions.json` baseline. (EE uses GET above with a per-commit `?ref`.)
router.post('/:id/inferred/diff', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = await resolveProjectForRequest(req.params.id as string);
    const { added, changed, resolved, fellBack } = await inferDiffInProcess(repo.path);
    res.json({ added, changed, resolved, fellBack });
  } catch (error) {
    next(error);
  }
});

function decisionKeyFromBody(req: Request): { kind: string; identity: string } | null {
  const body = (req.body ?? {}) as { kind?: unknown; identity?: unknown };
  if (typeof body.kind !== 'string' || typeof body.identity !== 'string') return null;
  return { kind: body.kind, identity: body.identity };
}

router.post('/:id/inferred/dismiss', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const key = decisionKeyFromBody(req);
    if (!key) {
      res.status(400).json({ error: 'kind and identity required' });
      return;
    }
    const repo = await resolveProjectForRequest(req.params.id as string);
    await dismissInferredDecision(repo.path, key.kind, key.identity);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.post('/:id/inferred/promote', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const key = decisionKeyFromBody(req);
    if (!key) {
      res.status(400).json({ error: 'kind and identity required' });
      return;
    }
    const repo = await resolveProjectForRequest(req.params.id as string);
    const result = await promoteInferredDecision(repo.path, key.kind, key.identity);
    if (result === 'not-found') {
      res.status(404).json({ error: 'inferred decision not found' });
      return;
    }
    if (result === 'unavailable') {
      res.status(409).json({ error: 'inferred contract unavailable; re-infer and retry' });
      return;
    }
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.post('/:id/inferred/restore', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const key = decisionKeyFromBody(req);
    if (!key) {
      res.status(400).json({ error: 'kind and identity required' });
      return;
    }
    const repo = await resolveProjectForRequest(req.params.id as string);
    await undismissInferredDecision(repo.path, key.kind, key.identity);
    res.json({ ok: true });
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
    const repo = await resolveProjectForRequest(id);

    const latest = await readLatest(repo.path);
    if (latest?.analysis.id === analysisId) {
      // Usage records live on the per-analysis file, not LATEST.
      const snap = await readAnalysis(repo.path, latest.head);
      res.json(snap?.usage ?? []);
      return;
    }

    const filename = await findAnalysisFilename(repo.path, analysisId);
    if (!filename) {
      res.json([]);
      return;
    }
    const snap = await readAnalysis(repo.path, filename);
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
    const repo = await resolveProjectForRequest(id);

    const filename = await findAnalysisFilename(repo.path, analysisId);
    if (!filename) throw createAppError('Analysis not found', 404);

    await deleteAnalysisFile(repo.path, filename);
    await removeFromHistory(repo.path, analysisId);

    // If we just deleted the head, rebuild LATEST from the now-most-recent
    // remaining analysis (or clear it + diff.json).
    const latest = await readLatest(repo.path);
    if (latest?.head === filename) {
      await rebuildLatestFromHistory(repo.path);
      await deleteDiff(repo.path);
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

// Mirror of CLI `resolveStashDecision` for the dashboard. Returns 'stash' /
// 'no-stash' / 'cancel'. Skips the prompt when the tree is clean, when the
// repo is a subdirectory of a larger git repo (analyze-core would skip the
// stash anyway), or when git is unavailable.
async function resolveStashDecisionForRoute(
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

async function runFullAnalyze(id: string, repo: RegistryEntry, opts: StartRunOptions): Promise<void> {
  const stashDecision = await resolveStashDecisionForRoute(id, repo.path);
  if (stashDecision === 'cancel') {
    emitAnalysisCanceled(id);
    return;
  }

  const provider: LLMProvider | undefined = opts.effectiveLlmRules ? createLLMProvider() : undefined;
  if (provider) {
    provider.setRepoId(id);
    provider.setRepoPath(repo.path);
    provider.setAbortSignal(opts.signal);
  }

  const outcome = await analyzeInProcess(repo, {
    skipGit: opts.skipGit,
    skipStash: stashDecision === 'no-stash',
    enabledCategoriesOverride: opts.effectiveCategories,
    enableLlmRulesOverride: opts.effectiveLlmRules,
    tracker: opts.tracker,
    signal: opts.signal,
    provider,
    source: 'dashboard',
    onLlmEstimate: createSocketLlmEstimateHandler(id),
  });

  emitViolationsReady(id, outcome.analysisId);
  emitAnalysisComplete(id, outcome.analysisId);
}

async function runDiffAnalyze(id: string, repo: RegistryEntry, opts: Pick<StartRunOptions, 'tracker' | 'signal'>): Promise<void> {
  const { diff } = await diffInProcess(repo, {
    tracker: opts.tracker,
    signal: opts.signal,
    source: 'dashboard',
    onLlmEstimate: createSocketLlmEstimateHandler(id),
  });

  emitViolationsReady(id, diff.id);
  emitAnalysisComplete(id, diff.id);
}

// ---------------------------------------------------------------------------
// LATEST rebuild (used by DELETE when the deleted analysis was the head)
// ---------------------------------------------------------------------------

async function rebuildLatestFromHistory(repoPath: string): Promise<void> {
  const files = await listAnalyses(repoPath);
  if (files.length === 0) {
    await deleteLatest(repoPath);
    return;
  }
  const newest = files[files.length - 1];
  const snap = await readAnalysis(repoPath, newest);
  if (!snap) {
    await deleteLatest(repoPath);
    return;
  }
  // Walk forward through snapshots applying added/resolved to reconstruct
  // the currently-active violation set.
  const active = new Map<string, Awaited<ReturnType<typeof readAnalysis>>>();
  for (const fname of files) {
    const s = await readAnalysis(repoPath, fname);
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

  await writeLatest(repoPath, latest);
}

export default router;
