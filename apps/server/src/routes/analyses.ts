/**
 * CRUD over stored analysis files (history / per-analysis usage / delete).
 * Mounted at `/api/repos` under `projectResolver`.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { createAppError } from '../middleware/error.js';
import { resolveProjectForRequest } from '../config/current-project.js';
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
} from '../lib/analysis-store.js';
import type { LatestSnapshot } from '../types/snapshot.js';

const router: Router = Router();

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
// Helpers
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

  // Populate with denormalized rows from the snapshots that own each active id.
  // Rows from older snapshots may reference graph ids that don't exist in the
  // newest graph — we surface them with null names rather than dropping them.
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
