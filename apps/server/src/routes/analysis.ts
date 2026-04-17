import { Router, type Request, type Response, type NextFunction } from 'express';
import { eq, desc, and, sql } from 'drizzle-orm';
import { db } from '../config/database.js';
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
import {
  analyses,
  services,
  serviceDependencies,
  layers,
  violations,
  databases,
  databaseConnections,
  modules,
  methods,
  moduleDeps,
  methodDeps,
  analysisUsage,
} from '../db/schema.js';
import { createAppError } from '../middleware/error.js';
import { getGit } from '../lib/git.js';
import { resolveProjectForRequest } from '../config/current-project.js';
import fs from 'node:fs';
import path from 'node:path';
import { buildUnifiedGraph, type GraphLevel } from '../services/graph.service.js';

/** SQL filter to exclude diff analyses */
const notDiffAnalysis = sql`(${analyses.metadata}->>'isDiffAnalysis')::boolean IS NOT TRUE`;

const router: Router = Router();

// GET /api/repos/:id/analyses - List past analyses (enhanced with counts)
router.get(
  '/:id/analyses',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      resolveProjectForRequest(id);

      const analysisList = await db
        .select({
          id: analyses.id,
          status: analyses.status,
          branch: analyses.branch,
          commitHash: analyses.commitHash,
          architecture: analyses.architecture,
          metadata: analyses.metadata,
          createdAt: analyses.createdAt,
        })
        .from(analyses)
        .where(notDiffAnalysis)
        .orderBy(desc(analyses.createdAt))
        .limit(20);

      // Enrich with counts per analysis
      const enriched = await Promise.all(
        analysisList.map(async (a) => {
          const [serviceCount, violationCounts, usageSummary] = await Promise.all([
            db.select({ count: sql<number>`count(*)::int` }).from(services).where(eq(services.analysisId, a.id)).then(([r]) => r.count),
            db.select({
              severity: violations.severity,
              count: sql<number>`count(*)::int`,
            }).from(violations).where(eq(violations.analysisId, a.id)).groupBy(violations.severity),
            db.select({
              totalDurationMs: sql<number>`coalesce(sum(${analysisUsage.durationMs}), 0)::int`,
              totalTokens: sql<number>`coalesce(sum(${analysisUsage.totalTokens}), 0)::int`,
              totalCost: sql<string | null>`case when sum(case when ${analysisUsage.costUsd} is not null then 1 else 0 end) > 0 then sum(${analysisUsage.costUsd}::numeric)::text else null end`,
              provider: sql<string | null>`max(${analysisUsage.provider})`,
              callCount: sql<number>`count(*)::int`,
            }).from(analysisUsage).where(eq(analysisUsage.analysisId, a.id)).then(([r]) => r),
          ]);

          const violationsBySeverity: Record<string, number> = {};
          for (const { severity, count } of violationCounts) {
            violationsBySeverity[severity] = count;
          }

          const meta = a.metadata as Record<string, unknown> | null;
          return {
            ...a,
            metadata: undefined, // don't send raw metadata to client
            serviceCount,
            violationsBySeverity,
            durationMs: usageSummary.totalDurationMs,
            totalTokens: usageSummary.totalTokens,
            totalCost: usageSummary.totalCost,
            provider: usageSummary.provider,
          };
        }),
      );

      res.json(enriched);
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/repos/:id/analyses/:analysisId/usage - Usage breakdown for an analysis
router.get(
  '/:id/analyses/:analysisId/usage',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const analysisId = req.params.analysisId as string;

      const rows = await db
        .select()
        .from(analysisUsage)
        .where(eq(analysisUsage.analysisId, analysisId));

      res.json(rows);
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/repos/:id/graph - Get graph data
router.get(
  '/:id/graph',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      const branch = req.query.branch as string | undefined;

      const repo = resolveProjectForRequest(id);

      const analysisId = req.query.analysisId as string | undefined;
      let analysis;

      if (analysisId) {
        const [specific] = await db
          .select()
          .from(analyses)
          .where(eq(analyses.id, analysisId))
          .limit(1);
        if (!specific) {
          res.json({ nodes: [], edges: [] });
          return;
        }
        analysis = specific;
      } else {
        // Find the latest non-diff analysis for the branch
        const conditions = [notDiffAnalysis];
        if (branch) {
          conditions.push(eq(analyses.branch, branch));
        }

        const latestAnalysis = await db
          .select()
          .from(analyses)
          .where(and(...conditions))
          .orderBy(desc(analyses.createdAt))
          .limit(1);

        if (latestAnalysis.length === 0) {
          res.json({ nodes: [], edges: [] });
          return;
        }
        analysis = latestAnalysis[0];
      }

      const level = (req.query.level as string) || 'services';

      // Fetch all data in parallel
      const [
        analysisServices,
        analysisDeps,
        analysisDatabases,
        analysisDbConnections,
        analysisLayers,
        analysisModules,
        analysisModuleDeps,
        analysisMethods,
        analysisMethodDeps,
        analysisViolationRows,
      ] = await Promise.all([
        db.select().from(services).where(eq(services.analysisId, analysis.id)),
        db.select().from(serviceDependencies).where(eq(serviceDependencies.analysisId, analysis.id)),
        db.select().from(databases).where(eq(databases.analysisId, analysis.id)),
        db.select().from(databaseConnections).where(eq(databaseConnections.analysisId, analysis.id)),
        db.select().from(layers).where(eq(layers.analysisId, analysis.id)),
        db.select().from(modules).where(eq(modules.analysisId, analysis.id)),
        db.select().from(moduleDeps).where(eq(moduleDeps.analysisId, analysis.id)),
        db.select().from(methods).where(eq(methods.analysisId, analysis.id)),
        db.select().from(methodDeps).where(eq(methodDeps.analysisId, analysis.id)),
        db.select({
          id: violations.id,
          ruleKey: violations.ruleKey,
          type: violations.type,
          title: violations.title,
          severity: violations.severity,
          targetServiceId: violations.targetServiceId,
          targetModuleId: violations.targetModuleId,
          relatedServiceId: violations.relatedServiceId,
          relatedModuleId: violations.relatedModuleId,
        }).from(violations).where(eq(violations.analysisId, analysis.id)),
      ]);

      const serviceIdToName = new Map(analysisServices.map((s) => [s.id, s.name]));
      const moduleIdToName = new Map(analysisModules.map((m) => [m.id, m.name]));

      const dependencyViolations = analysisViolationRows
        .filter((v) => !!(v.relatedServiceId || v.relatedModuleId))
        .map((v) => ({
          id: v.id,
          ruleKey: v.ruleKey,
          category: v.type === 'service' ? 'service' : (v.type === 'function' ? 'method' : 'module'),
          title: v.title,
          severity: v.severity,
          serviceName: v.targetServiceId ? (serviceIdToName.get(v.targetServiceId) ?? '') : '',
          moduleName: v.targetModuleId ? (moduleIdToName.get(v.targetModuleId) ?? null) : null,
          targetModuleId: v.targetModuleId || null,
          relatedServiceId: v.relatedServiceId || null,
          relatedModuleId: v.relatedModuleId || null,
          isDependencyViolation: !!(v.relatedServiceId || v.relatedModuleId),
        }));

      const layerData = analysisLayers.map((l) => ({
        id: l.id,
        serviceName: l.serviceName,
        serviceId: l.serviceId,
        layer: l.layer,
        fileCount: l.fileCount,
        filePaths: l.filePaths as string[],
        confidence: l.confidence,
        evidence: l.evidence as string[],
      }));

      const unifiedInput = {
        services: analysisServices,
        serviceDeps: analysisDeps,
        layers: layerData,
        modules: analysisModules,
        moduleDeps: analysisModuleDeps,
        methods: analysisMethods,
        methodDeps: analysisMethodDeps,
        databases: analysisDatabases,
        dbConnections: analysisDbConnections,
        dependencyViolations: dependencyViolations,
      };

      const graphLevel = level.replace(/s$/, '') as GraphLevel;
      const graphData = buildUnifiedGraph(graphLevel, unifiedInput);

      // Apply saved positions + collapsed state from <repo>/.truecourse/ui-state.json.
      // Stored by stable name-based keys so they survive re-analysis.
      const keyMap = buildStableKeyMap({
        services: analysisServices,
        layers: layerData,
        modules: analysisModules,
        methods: analysisMethods,
      });
      const savedStablePositions = getScopedPositions(repo.path, analysis.branch, level);
      const savedPositions = positionsToUuid(keyMap, savedStablePositions);
      for (const node of graphData.nodes) {
        const pos = savedPositions[node.id];
        if (pos) node.position = pos;
      }

      const savedStableCollapsed = getScopedCollapsed(repo.path, analysis.branch, level);
      const collapsedIds = idsToUuid(keyMap, savedStableCollapsed);

      res.set('Cache-Control', 'no-store');
      res.json({ ...graphData, collapsedIds });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Load the analysis + enough row data to build a stable-key map. Returns
 * `{ repo, analysis, keyMap }` or null if no analysis exists for the repo/branch.
 */
async function resolveKeyMap(
  id: string,
  branch: string | undefined,
): Promise<
  | {
      repo: ReturnType<typeof resolveProjectForRequest>;
      analysis: typeof analyses.$inferSelect;
      keyMap: ReturnType<typeof buildStableKeyMap>;
    }
  | null
> {
  const repo = resolveProjectForRequest(id);

  const conditions = [notDiffAnalysis];
  if (branch) conditions.push(eq(analyses.branch, branch));

  const [latest] = await db
    .select()
    .from(analyses)
    .where(and(...conditions))
    .orderBy(desc(analyses.createdAt))
    .limit(1);

  if (!latest) return null;

  const [analysisServices, analysisLayers, analysisModules, analysisMethods] = await Promise.all([
    db.select().from(services).where(eq(services.analysisId, latest.id)),
    db.select().from(layers).where(eq(layers.analysisId, latest.id)),
    db.select().from(modules).where(eq(modules.analysisId, latest.id)),
    db.select().from(methods).where(eq(methods.analysisId, latest.id)),
  ]);

  const keyMap = buildStableKeyMap({
    services: analysisServices,
    layers: analysisLayers.map((l) => ({
      id: l.id,
      serviceName: l.serviceName,
      serviceId: l.serviceId,
      layer: l.layer,
      fileCount: l.fileCount,
      filePaths: l.filePaths as string[],
      confidence: l.confidence,
      evidence: l.evidence as string[],
    })),
    modules: analysisModules,
    methods: analysisMethods,
  });

  return { repo, analysis: latest, keyMap };
}

// PUT /api/repos/:id/graph/positions - Save node positions
router.put(
  '/:id/graph/positions',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      const branch = req.query.branch as string | undefined;
      const level = (req.query.level as string) || 'services';
      const { positions } = req.body as { positions: Record<string, { x: number; y: number }> };

      if (!positions || typeof positions !== 'object') {
        throw createAppError('Invalid positions data', 400);
      }

      const resolved = await resolveKeyMap(id, branch);
      if (!resolved) throw createAppError('No analysis found', 404);

      const stablePositions = positionsToStable(resolved.keyMap, positions);
      setPositions(resolved.repo.path, resolved.analysis.branch, level, stablePositions);

      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/repos/:id/graph/positions - Reset to auto layout
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
  }
);

// DELETE /api/repos/:id/analyses/:analysisId - Delete a specific analysis
router.delete(
  '/:id/analyses/:analysisId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const analysisId = req.params.analysisId as string;

      const existing = await db.select({ id: analyses.id }).from(analyses).where(eq(analyses.id, analysisId));
      if (existing.length === 0) {
        throw createAppError('Analysis not found', 404);
      }

      await db.delete(analyses).where(eq(analyses.id, analysisId));
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  }
);

// PUT /api/repos/:id/graph/collapsed - Save collapsed node IDs for a mode
router.put(
  '/:id/graph/collapsed',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      const branch = req.query.branch as string | undefined;
      const level = (req.query.level as string) || 'modules';
      const { collapsedIds: ids } = req.body as { collapsedIds: string[] };

      if (!Array.isArray(ids)) {
        throw createAppError('Invalid collapsedIds data', 400);
      }

      const resolved = await resolveKeyMap(id, branch);
      if (!resolved) throw createAppError('No analysis found', 404);

      const stableIds = idsToStable(resolved.keyMap, ids);
      setCollapsed(resolved.repo.path, resolved.analysis.branch, level, stableIds);

      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/repos/:id/files - File tree from the actual repository
router.get(
  '/:id/files',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      const ref = req.query.ref as string | undefined;
      const repo = resolveProjectForRequest(id);

      const git = await getGit(repo.path);
      // Use git ls-files to get tracked files (respects .gitignore)
      const result = await git.raw(['ls-files']);
      const files = result.split('\n').filter((f) => f.length > 0);

      // In working-tree mode, also include untracked files
      if (ref === 'working-tree') {
        const untrackedResult = await git.raw(['ls-files', '--others', '--exclude-standard']);
        const untrackedFiles = untrackedResult.split('\n').filter((f) => f.length > 0);
        for (const f of untrackedFiles) {
          if (!files.includes(f)) {
            files.push(f);
          }
        }
      }

      res.json({ root: repo.path, files });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/repos/:id/changes - Pending git changes
router.get(
  '/:id/changes',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      const repo = resolveProjectForRequest(id);

      const git = await getGit(repo.path);
      const statusResult = await git.status();

      const changedFiles: Array<{ path: string; status: 'new' | 'modified' | 'deleted' }> = [];

      for (const f of statusResult.not_added) {
        changedFiles.push({ path: f, status: 'new' });
      }
      for (const f of statusResult.created) {
        changedFiles.push({ path: f, status: 'new' });
      }
      for (const f of statusResult.modified) {
        changedFiles.push({ path: f, status: 'modified' });
      }
      for (const f of statusResult.staged) {
        // staged files not already captured
        if (!changedFiles.some((cf) => cf.path === f)) {
          changedFiles.push({ path: f, status: 'modified' });
        }
      }
      for (const f of statusResult.deleted) {
        changedFiles.push({ path: f, status: 'deleted' });
      }

      // Find latest normal analysis and its services to match affected services
      const latestAnalysis = await db
        .select()
        .from(analyses)
        .where(notDiffAnalysis)
        .orderBy(desc(analyses.createdAt))
        .limit(1);

      const affectedServices: string[] = [];

      if (latestAnalysis.length > 0) {
        const analysisServices = await db
          .select()
          .from(services)
          .where(eq(services.analysisId, latestAnalysis[0].id));

        for (const svc of analysisServices) {
          const svcRoot = svc.rootPath;
          const isAffected = changedFiles.some(
            (cf) => cf.path.startsWith(svcRoot + '/') || cf.path === svcRoot
          );
          if (isAffected) {
            affectedServices.push(svc.id);
          }
        }
      }

      res.json({ changedFiles, affectedServices });
    } catch (error) {
      next(error);
    }
  }
);


// GET /api/repos/:id/diff-check - Load saved diff check from DB
router.get(
  '/:id/diff-check',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      resolveProjectForRequest(id);

      // Find latest diff analysis (metadata.isDiffAnalysis = true)
      const [diffAnalysis] = await db
        .select()
        .from(analyses)
        .where(sql`(${analyses.metadata}->>'isDiffAnalysis')::boolean IS TRUE`)
        .orderBy(desc(analyses.createdAt))
        .limit(1);

      if (!diffAnalysis) {
        res.json(null);
        return;
      }

      const metadata = diffAnalysis.metadata as Record<string, unknown> | null;

      // Check staleness: compare baselineAnalysisId vs latest normal analysis
      const [latestAnalysis] = await db
        .select({ id: analyses.id })
        .from(analyses)
        .where(notDiffAnalysis)
        .orderBy(desc(analyses.createdAt))
        .limit(1);

      const baselineAnalysisId = metadata?.baselineAnalysisId as string | undefined;
      const isStale = latestAnalysis ? baselineAnalysisId !== latestAnalysis.id : false;

      // Load violations for the diff analysis, grouped by status
      const diffViolationRows = await db
        .select({
          id: violations.id,
          type: violations.type,
          title: violations.title,
          content: violations.content,
          severity: violations.severity,
          status: violations.status,
          targetServiceId: violations.targetServiceId,
          targetServiceName: services.name,
          targetDatabaseId: violations.targetDatabaseId,
          targetModuleId: violations.targetModuleId,
          targetModuleName: modules.name,
          targetMethodId: violations.targetMethodId,
          targetMethodName: methods.name,
          targetTable: violations.targetTable,
          fixPrompt: violations.fixPrompt,
          createdAt: violations.createdAt,
        })
        .from(violations)
        .leftJoin(services, eq(violations.targetServiceId, services.id))
        .leftJoin(modules, eq(violations.targetModuleId, modules.id))
        .leftJoin(methods, eq(violations.targetMethodId, methods.id))
        .where(eq(violations.analysisId, diffAnalysis.id));

      const newViolations = diffViolationRows
        .filter((v) => v.status === 'new')
        .map((v) => ({
          type: v.type,
          title: v.title,
          content: v.content,
          severity: v.severity,
          targetServiceId: v.targetServiceId,
          targetModuleId: v.targetModuleId,
          targetMethodId: v.targetMethodId,
          targetServiceName: v.targetServiceName,
          targetModuleName: v.targetModuleName,
          targetMethodName: v.targetMethodName,
          fixPrompt: v.fixPrompt,
        }));

      const resolvedViolations = diffViolationRows
        .filter((v) => v.status === 'resolved')
        .map((v) => ({
          id: v.id,
          type: v.type,
          title: v.title,
          content: v.content,
          severity: v.severity,
          targetServiceId: v.targetServiceId,
          targetServiceName: v.targetServiceName,
          targetDatabaseId: v.targetDatabaseId,
          targetModuleId: v.targetModuleId,
          targetModuleName: v.targetModuleName,
          targetMethodId: v.targetMethodId,
          targetMethodName: v.targetMethodName,
          targetTable: v.targetTable,
          fixPrompt: v.fixPrompt,
          createdAt: v.createdAt.toISOString(),
        }));

      // Load new code violations for this diff analysis (from unified violations table)
      const diffCodeViolationRows = await db
        .select()
        .from(violations)
        .where(and(eq(violations.analysisId, diffAnalysis.id), sql`${violations.filePath} IS NOT NULL`));

      const newCodeViolations = diffCodeViolationRows
        .filter((v) => v.status === 'new')
        .map((cv) => ({
          type: 'code' as const,
          title: cv.title,
          content: cv.content,
          severity: cv.severity,
          targetServiceId: null,
          targetModuleId: null,
          targetMethodId: null,
          targetServiceName: null,
          targetModuleName: null,
          targetMethodName: null,
          fixPrompt: cv.fixPrompt,
          filePath: cv.filePath,
          lineStart: cv.lineStart,
        }));

      const resolvedCodeViolations = diffCodeViolationRows
        .filter((v) => v.status === 'resolved')
        .map((cv) => ({
          id: cv.id,
          type: 'code' as const,
          title: cv.title,
          content: cv.content,
          severity: cv.severity,
          targetServiceId: null,
          targetServiceName: null,
          targetDatabaseId: null,
          targetDatabaseName: null,
          targetModuleId: null,
          targetModuleName: null,
          targetMethodId: null,
          targetMethodName: null,
          targetTable: null,
          fixPrompt: cv.fixPrompt,
          filePath: cv.filePath,
          lineStart: cv.lineStart,
          createdAt: cv.createdAt.toISOString(),
        }));

      const allNewViolations = [...newViolations, ...newCodeViolations];
      const allResolvedViolations = [...resolvedViolations, ...resolvedCodeViolations];

      res.json({
        resolvedViolations: allResolvedViolations,
        newViolations: allNewViolations,
        affectedNodeIds: metadata?.affectedNodeIds || { services: [], layers: [], modules: [], methods: [] },
        summary: metadata?.summary || { newCount: allNewViolations.length, resolvedCount: allResolvedViolations.length },
        changedFiles: metadata?.changedFiles || [],
        isStale,
        diffAnalysisId: diffAnalysis.id,
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/repos/:id/file-content - Read a file from the repository
router.get(
  '/:id/file-content',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      const filePath = req.query.path as string;
      const ref = req.query.ref as string | undefined;

      if (!filePath) {
        throw createAppError('Missing "path" query parameter', 400);
      }

      const repo = resolveProjectForRequest(id);

      // Resolve and validate path is within repo
      const resolved = path.resolve(repo.path, filePath);
      if (!resolved.startsWith(path.resolve(repo.path) + path.sep) && resolved !== path.resolve(repo.path)) {
        throw createAppError('Path traversal not allowed', 403);
      }

      let content: string;

      if (ref === 'working-tree') {
        // Working tree mode: read from filesystem
        if (!fs.existsSync(resolved)) {
          throw createAppError('File not found', 404);
        }
        const stat = fs.statSync(resolved);
        if (!stat.isFile()) {
          throw createAppError('Path is not a file', 400);
        }
        content = fs.readFileSync(resolved, 'utf-8');
      } else {
        // Default: read committed content from HEAD
        const git = await getGit(repo.path);
        try {
          content = await git.show([`HEAD:${filePath}`]);
        } catch {
          // File doesn't exist in HEAD (new untracked file) — fall back to filesystem
          if (!fs.existsSync(resolved)) {
            throw createAppError('File not found', 404);
          }
          const stat = fs.statSync(resolved);
          if (!stat.isFile()) {
            throw createAppError('Path is not a file', 400);
          }
          content = fs.readFileSync(resolved, 'utf-8');
        }
      }

      // Detect language from extension
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
  }
);

export default router;
