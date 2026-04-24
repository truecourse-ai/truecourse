/**
 * Graph rendering and its per-user UI state (node positions, collapsed
 * state). Graph data derives from LATEST.json (or a historical analysis
 * file / live diff) and is merged at request time with name-keyed UI state
 * from `ui-state.json`.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { createAppError } from '@truecourse/core/lib/errors';
import { resolveProjectForRequest } from '@truecourse/core/config/current-project';
import {
  setPositions,
  clearPositions,
  setCollapsed,
  getScopedPositions,
  getScopedCollapsed,
} from '@truecourse/core/config/ui-state';
import {
  buildStableKeyMap,
  positionsToStable,
  positionsToUuid,
  idsToStable,
  idsToUuid,
} from '@truecourse/core/services/stable-keys';
import { buildUnifiedGraph, type GraphLevel } from '@truecourse/core/services/graph';
import {
  findAnalysisFilename,
  readAnalysis,
  readDiff,
  readLatest,
} from '@truecourse/core/lib/analysis-store';
import type { LatestSnapshot } from '@truecourse/core/types/snapshot';

const router: Router = Router();

// ---------------------------------------------------------------------------
// GET /api/repos/:id/graph — unified graph from LATEST (or diff / historical)
// ---------------------------------------------------------------------------

router.get('/:id/graph', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const repo = resolveProjectForRequest(id);

    const analysisIdParam = req.query.analysisId as string | undefined;
    const level = (req.query.level as string) || 'services';

    let snapshot = readLatest(repo.path);
    if (analysisIdParam && (!snapshot || snapshot.analysis.id !== analysisIdParam)) {
      // Diff view: serve the working-tree graph from diff.json so newly-added
      // modules/methods render as nodes instead of being missing from the baseline.
      const diff = readDiff(repo.path);
      if (diff && diff.id === analysisIdParam) {
        snapshot = {
          head: `diff-${diff.id}`,
          analysis: {
            id: diff.id,
            createdAt: diff.createdAt,
            branch: diff.branch,
            commitHash: diff.commitHash,
            architecture: snapshot?.analysis.architecture ?? 'monolith',
            metadata: null,
            status: 'completed',
          },
          graph: diff.graph,
          violations: diff.newViolations,
        };
      } else {
        const filename = findAnalysisFilename(repo.path, analysisIdParam);
        if (!filename) {
          res.json({ nodes: [], edges: [] });
          return;
        }
        const snap = readAnalysis(repo.path, filename);
        if (!snap) {
          res.json({ nodes: [], edges: [] });
          return;
        }
        // Historical analysis: graph builder takes the same LatestSnapshot shape,
        // so synthesize one. Violations aren't needed except for dependency-
        // violation decoration on edges — a historical view skips that.
        snapshot = {
          head: filename,
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
      }
    }
    if (!snapshot) {
      res.json({ nodes: [], edges: [] });
      return;
    }

    const graphLevel = level.replace(/s$/, '') as GraphLevel;

    // Dependency-specific violation subset (for graph edges decorated w/ severity).
    const serviceIdToName = new Map(snapshot.graph.services.map((s) => [s.id, s.name]));
    const moduleIdToName = new Map(snapshot.graph.modules.map((m) => [m.id, m.name]));
    const dependencyViolations = snapshot.violations
      .filter((v) => !!(v.relatedServiceId || v.relatedModuleId))
      .map((v) => ({
        id: v.id,
        ruleKey: v.ruleKey,
        category: v.type === 'service' ? 'service' : (v.type === 'function' ? 'method' : 'module'),
        title: v.title,
        severity: v.severity,
        serviceName: v.targetServiceId ? serviceIdToName.get(v.targetServiceId) ?? '' : '',
        moduleName: v.targetModuleId ? moduleIdToName.get(v.targetModuleId) ?? null : null,
        targetModuleId: v.targetModuleId ?? null,
        relatedServiceId: v.relatedServiceId ?? null,
        relatedModuleId: v.relatedModuleId ?? null,
        isDependencyViolation: !!(v.relatedServiceId || v.relatedModuleId),
      }));

    const unifiedInput = {
      services: snapshot.graph.services.map((s) => ({
        ...s,
        analysisId: snapshot!.analysis.id,
        createdAt: new Date(snapshot!.analysis.createdAt),
      })),
      serviceDeps: snapshot.graph.serviceDependencies.map((d) => ({
        ...d,
        analysisId: snapshot!.analysis.id,
      })),
      layers: snapshot.graph.layers,
      modules: snapshot.graph.modules.map((m) => ({
        ...m,
        analysisId: snapshot!.analysis.id,
      })),
      moduleDeps: snapshot.graph.moduleDeps.map((d) => ({
        ...d,
        analysisId: snapshot!.analysis.id,
      })),
      methods: snapshot.graph.methods.map((m) => ({
        ...m,
        analysisId: snapshot!.analysis.id,
      })),
      methodDeps: snapshot.graph.methodDeps.map((d) => ({
        ...d,
        analysisId: snapshot!.analysis.id,
      })),
      databases: snapshot.graph.databases.map((d) => ({
        ...d,
        analysisId: snapshot!.analysis.id,
        createdAt: new Date(snapshot!.analysis.createdAt),
      })),
      dbConnections: snapshot.graph.databaseConnections.map((c) => ({
        ...c,
        analysisId: snapshot!.analysis.id,
      })),
      dependencyViolations,
    };

    const graphData = buildUnifiedGraph(graphLevel, unifiedInput);

    // Apply saved positions + collapsed state from ui-state.json (name-keyed).
    const keyMap = buildStableKeyMap({
      services: snapshot.graph.services,
      layers: snapshot.graph.layers,
      modules: snapshot.graph.modules,
      methods: snapshot.graph.methods,
    });
    const savedStablePositions = getScopedPositions(repo.path, snapshot.analysis.branch, level);
    const savedPositions = positionsToUuid(keyMap, savedStablePositions);
    for (const node of graphData.nodes) {
      const pos = savedPositions[node.id];
      if (pos) node.position = pos;
    }

    const savedStableCollapsed = getScopedCollapsed(repo.path, snapshot.analysis.branch, level);
    const collapsedIds = idsToUuid(keyMap, savedStableCollapsed);

    res.set('Cache-Control', 'no-store');
    res.json({ ...graphData, collapsedIds });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// Graph positions / collapsed
// ---------------------------------------------------------------------------

function keyMapFromLatest(latest: LatestSnapshot) {
  return buildStableKeyMap({
    services: latest.graph.services,
    layers: latest.graph.layers,
    modules: latest.graph.modules,
    methods: latest.graph.methods,
  });
}

router.put('/:id/graph/positions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const level = (req.query.level as string) || 'services';
    const { positions } = req.body as { positions: Record<string, { x: number; y: number }> };
    if (!positions || typeof positions !== 'object') {
      throw createAppError('Invalid positions data', 400);
    }

    const repo = resolveProjectForRequest(id);
    const latest = readLatest(repo.path);
    if (!latest) throw createAppError('No analysis found', 404);

    const keyMap = keyMapFromLatest(latest);
    const stablePositions = positionsToStable(keyMap, positions);
    setPositions(repo.path, latest.analysis.branch, level, stablePositions);

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.delete('/:id/graph/positions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const branch = req.query.branch as string | undefined;
    const level = (req.query.level as string) || 'services';
    const repo = resolveProjectForRequest(id);
    clearPositions(repo.path, branch ?? null, level);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.put('/:id/graph/collapsed', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const level = (req.query.level as string) || 'modules';
    const { collapsedIds: ids } = req.body as { collapsedIds: string[] };
    if (!Array.isArray(ids)) throw createAppError('Invalid collapsedIds data', 400);

    const repo = resolveProjectForRequest(id);
    const latest = readLatest(repo.path);
    if (!latest) throw createAppError('No analysis found', 404);

    const keyMap = keyMapFromLatest(latest);
    const stableIds = idsToStable(keyMap, ids);
    setCollapsed(repo.path, latest.analysis.branch, level, stableIds);

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

export default router;
