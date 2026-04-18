import { Router, type Request, type Response, type NextFunction } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createAppError } from '../middleware/error.js';
import { getGit } from '../lib/git.js';
import { resolveProjectForRequest } from '../config/current-project.js';
import { diffInProcess } from '../commands/diff-in-process.js';
import type { LatestSnapshot } from '../types/snapshot.js';
import {
  setPositions,
  clearPositions,
  setCollapsed,
  getScopedPositions,
  getScopedCollapsed,
} from '../config/ui-state.js';
import {
  buildStableKeyMap,
  positionsToStable,
  positionsToUuid,
  idsToStable,
  idsToUuid,
} from '../services/stable-keys.js';
import { buildUnifiedGraph, type GraphLevel } from '../services/graph.service.js';
import {
  deleteAnalysis as deleteAnalysisFile,
  deleteDiff,
  deleteLatest,
  listAnalyses,
  readAnalysis,
  readDiff,
  readHistory,
  readLatest,
  removeFromHistory,
  writeLatest,
} from '../lib/analysis-store.js';
import { getDiffResult } from '../services/violation-query.service.js';

const router: Router = Router();

// ---------------------------------------------------------------------------
// GET /api/repos/:id/analyses — list (from history.json)
// ---------------------------------------------------------------------------

router.get(
  '/:id/analyses',
  async (req: Request, res: Response, next: NextFunction) => {
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
  },
);

// ---------------------------------------------------------------------------
// GET /api/repos/:id/analyses/:analysisId/usage
// ---------------------------------------------------------------------------

router.get(
  '/:id/analyses/:analysisId/usage',
  async (req: Request, res: Response, next: NextFunction) => {
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

      const filename = await findAnalysisFilename(repo.path, analysisId);
      if (!filename) {
        res.json([]);
        return;
      }
      const snap = readAnalysis(repo.path, filename);
      res.json(snap?.usage ?? []);
    } catch (error) {
      next(error);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/repos/:id/graph — unified graph from LATEST
// ---------------------------------------------------------------------------

router.get(
  '/:id/graph',
  async (req: Request, res: Response, next: NextFunction) => {
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
          const filename = await findAnalysisFilename(repo.path, analysisIdParam);
          if (!filename) {
            res.json({ nodes: [], edges: [] });
            return;
          }
          const snap = readAnalysis(repo.path, filename);
          if (!snap) {
            res.json({ nodes: [], edges: [] });
            return;
          }
          // Build a minimal LatestSnapshot view for the historical file so the
          // graph builder can operate on the same shape. Use the snapshot's
          // own graph; violations are not needed for graph rendering except
          // for dependency-violation decoration.
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
  },
);

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

router.put(
  '/:id/graph/positions',
  async (req: Request, res: Response, next: NextFunction) => {
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
  },
);

router.delete(
  '/:id/graph/positions',
  async (req: Request, res: Response, next: NextFunction) => {
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
  },
);

router.put(
  '/:id/graph/collapsed',
  async (req: Request, res: Response, next: NextFunction) => {
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
  },
);

// ---------------------------------------------------------------------------
// DELETE /api/repos/:id/analyses/:analysisId
// ---------------------------------------------------------------------------

router.delete(
  '/:id/analyses/:analysisId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      const analysisId = req.params.analysisId as string;
      const repo = resolveProjectForRequest(id);

      const filename = await findAnalysisFilename(repo.path, analysisId);
      if (!filename) throw createAppError('Analysis not found', 404);

      deleteAnalysisFile(repo.path, filename);
      removeFromHistory(repo.path, analysisId);

      // If we just deleted the head, rebuild LATEST from the now-most-recent
      // remaining analysis (or clear it + diff.json).
      const latest = readLatest(repo.path);
      if (latest?.head === filename) {
        await rebuildLatestFromHistory(repo.path);
        deleteDiff(repo.path);
      }

      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  },
);

async function rebuildLatestFromHistory(repoPath: string): Promise<void> {
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
  // Walk backwards through snapshots collecting the "active" violation set —
  // start from the oldest, apply added/resolved to reach current state.
  const sorted = [...files];
  const active = new Map<string, ReturnType<typeof readAnalysis>>();
  for (const fname of sorted) {
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
    violations: [], // Best-effort rebuild — populated from the snapshot that owns each active id.
  };

  // Walk active violations and attach denormalized names using the newest snapshot's graph.
  // Rows from older snapshots may reference IDs that don't exist in `snap.graph` — leave those as null.
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

// ---------------------------------------------------------------------------
// GET /api/repos/:id/files  — git ls-files
// ---------------------------------------------------------------------------

router.get(
  '/:id/files',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      const ref = req.query.ref as string | undefined;
      const repo = resolveProjectForRequest(id);

      const git = await getGit(repo.path);
      const result = await git.raw(['ls-files']);
      const files = result.split('\n').filter((f) => f.length > 0);

      if (ref === 'working-tree') {
        const untrackedResult = await git.raw(['ls-files', '--others', '--exclude-standard']);
        const untrackedFiles = untrackedResult.split('\n').filter((f) => f.length > 0);
        for (const f of untrackedFiles) {
          if (!files.includes(f)) files.push(f);
        }
      }

      res.json({ root: repo.path, files });
    } catch (error) {
      next(error);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/repos/:id/changes — pending git changes + affected services
// ---------------------------------------------------------------------------

router.get(
  '/:id/changes',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      const repo = resolveProjectForRequest(id);

      const git = await getGit(repo.path);
      const statusResult = await git.status();
      const changedFiles: Array<{ path: string; status: 'new' | 'modified' | 'deleted' }> = [];

      for (const f of statusResult.not_added) changedFiles.push({ path: f, status: 'new' });
      for (const f of statusResult.created) changedFiles.push({ path: f, status: 'new' });
      for (const f of statusResult.modified) changedFiles.push({ path: f, status: 'modified' });
      for (const f of statusResult.staged) {
        if (!changedFiles.some((cf) => cf.path === f)) changedFiles.push({ path: f, status: 'modified' });
      }
      for (const f of statusResult.deleted) changedFiles.push({ path: f, status: 'deleted' });

      const latest = readLatest(repo.path);
      const affectedServices: string[] = [];
      if (latest) {
        for (const svc of latest.graph.services) {
          const svcRoot = svc.rootPath;
          const isAffected = changedFiles.some(
            (cf) => cf.path.startsWith(svcRoot + '/') || cf.path === svcRoot,
          );
          if (isAffected) affectedServices.push(svc.id);
        }
      }

      res.json({ changedFiles, affectedServices });
    } catch (error) {
      next(error);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/repos/:id/diff-check — analyze working tree, compare vs LATEST
// ---------------------------------------------------------------------------

router.post(
  '/:id/diff-check',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      const repo = resolveProjectForRequest(id);

      const { diff } = await diffInProcess(repo);

      res.json({
        resolvedViolations: diff.resolvedViolations,
        newViolations: diff.newViolations,
        affectedNodeIds: diff.affectedNodeIds,
        summary: diff.summary,
        changedFiles: diff.changedFiles,
        isStale: false,
        diffAnalysisId: diff.id,
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('Run a full analysis first')) {
        next(createAppError(error.message, 400));
        return;
      }
      next(error);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/repos/:id/diff-check — return diff.json
// ---------------------------------------------------------------------------

router.get(
  '/:id/diff-check',
  async (req: Request, res: Response, next: NextFunction) => {
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
  },
);

// ---------------------------------------------------------------------------
// GET /api/repos/:id/file-content — read file from repo (unchanged)
// ---------------------------------------------------------------------------

router.get(
  '/:id/file-content',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      const filePath = req.query.path as string;
      const ref = req.query.ref as string | undefined;
      if (!filePath) throw createAppError('Missing "path" query parameter', 400);

      const repo = resolveProjectForRequest(id);
      const resolved = path.resolve(repo.path, filePath);
      if (
        !resolved.startsWith(path.resolve(repo.path) + path.sep) &&
        resolved !== path.resolve(repo.path)
      ) {
        throw createAppError('Path traversal not allowed', 403);
      }

      let content: string;

      if (ref === 'working-tree') {
        if (!fs.existsSync(resolved)) throw createAppError('File not found', 404);
        const stat = fs.statSync(resolved);
        if (!stat.isFile()) throw createAppError('Path is not a file', 400);
        content = fs.readFileSync(resolved, 'utf-8');
      } else {
        const git = await getGit(repo.path);
        try {
          content = await git.show([`HEAD:${filePath}`]);
        } catch {
          if (!fs.existsSync(resolved)) throw createAppError('File not found', 404);
          const stat = fs.statSync(resolved);
          if (!stat.isFile()) throw createAppError('Path is not a file', 400);
          content = fs.readFileSync(resolved, 'utf-8');
        }
      }

      const ext = path.extname(resolved).slice(1).toLowerCase();
      const langMap: Record<string, string> = {
        ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
        json: 'json', md: 'markdown', css: 'css', html: 'html', yaml: 'yaml',
        yml: 'yaml', sql: 'sql', sh: 'shell', py: 'python', go: 'go',
        rs: 'rust', java: 'java', rb: 'ruby', php: 'php', c: 'c',
        cpp: 'cpp', h: 'c', hpp: 'cpp',
      };
      const language = langMap[ext] || 'text';

      res.json({ content, language });
    } catch (error) {
      next(error);
    }
  },
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function findAnalysisFilename(repoPath: string, analysisId: string): Promise<string | null> {
  for (const name of listAnalyses(repoPath).reverse()) {
    const snap = readAnalysis(repoPath, name);
    if (snap?.id === analysisId) return name;
  }
  return null;
}

export default router;
