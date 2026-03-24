import { Router, type Request, type Response, type NextFunction } from 'express';
import { eq, desc, and, sql } from 'drizzle-orm';
import { db } from '../config/database.js';
import {
  repos,
  analyses,
  services,
  serviceDependencies,
  layers,
  deterministicViolations,
  violations,
  databases,
  databaseConnections,
  modules,
  methods,
  moduleDeps,
  methodDeps,
  codeViolations,
  analysisUsage,
} from '../db/schema.js';
import { AnalyzeRepoSchema } from '@truecourse/shared';
import { createAppError } from '../middleware/error.js';
import { simpleGit } from 'simple-git';
import fs from 'node:fs';
import path from 'node:path';
import { runAnalysis, runDiffAnalysis } from '../services/analyzer.service.js';
import { persistAnalysisResult } from '../services/analysis-persistence.service.js';
import { detectAndPersistFlows } from '../services/flow.service.js';
import {
  emitAnalysisProgress,
  emitAnalysisComplete,
  emitViolationsReady,
  emitAnalysisCanceled,
  emitCodeReviewProgress,
  emitCodeReviewReady,
  StepTracker,
} from '../socket/handlers.js';
import {
  registerAnalysis,
  unregisterAnalysis,
  cancelAnalysis,
} from '../services/analysis-registry.js';
import { buildUnifiedGraph, type GraphLevel } from '../services/graph.service.js';
import {
  loadActiveViolations,
  loadActiveCodeViolations,
} from '../services/violation-lifecycle.service.js';
import { runViolationPipeline } from '../services/violation-pipeline.service.js';
import { createLLMProvider } from '../services/llm/provider.js';

/** SQL filter to exclude diff analyses */
const notDiffAnalysis = sql`(${analyses.metadata}->>'isDiffAnalysis')::boolean IS NOT TRUE`;

const router: Router = Router();

// POST /api/repos/:id/analyze - Trigger analysis
router.post(
  '/:id/analyze',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;

      const parsed = AnalyzeRepoSchema.safeParse(req.body);
      if (!parsed.success) {
        throw createAppError('Invalid request body', 400);
      }

      const [repo] = await db
        .select()
        .from(repos)
        .where(eq(repos.id, id))
        .limit(1);

      if (!repo) {
        throw createAppError('Repo not found', 404);
      }

      // Detect current branch and commit hash (never checkout — analyze what's on disk)
      const git = simpleGit(repo.path);
      const branch = (await git.branch()).current || null;
      const commitHash = (await git.revparse(['HEAD'])).trim();

      // Respond immediately, run analysis asynchronously
      res.status(202).json({ message: 'Analysis started', repoId: id, branch });

      // Register analysis for cancellation support
      const abortController = registerAnalysis(id, 'pending');

      // Run analysis in the background
      try {
        const tracker = new StepTracker(id, [
          { key: 'parse', label: 'Parsing repository' },
          { key: 'detect', label: 'Deterministic checks' },
          { key: 'enrich', label: 'Enriching detections' },
          { key: 'architecture', label: 'Architecture analysis' },
          { key: 'persist', label: 'Saving results' },
          { key: 'code-review', label: 'Code review' },
        ]);

        tracker.start('parse', 'Starting analysis...');

        const result = await runAnalysis(repo.path, branch ?? undefined, (progress) => {
          // Forward analyzer progress as detail on the 'parse' step
          tracker.detail('parse', progress.detail ?? 'Analyzing...');
        });

        // Get previous analysis positions (mapped by service name)
        const prevConditions = [eq(analyses.repoId, id), notDiffAnalysis];
        if (branch) prevConditions.push(eq(analyses.branch, branch));
        const prevAnalyses = await db
          .select()
          .from(analyses)
          .where(and(...prevConditions))
          .orderBy(desc(analyses.createdAt))
          .limit(1);

        let prevPositionsByName: Record<string, { x: number; y: number }> = {};
        let prevLayerPositions: Record<string, { x: number; y: number }> | null = null;
        if (prevAnalyses.length > 0 && prevAnalyses[0].nodePositions) {
          const allPrev = prevAnalyses[0].nodePositions as Record<string, unknown>;
          // Support both namespaced and legacy flat formats
          const prevServicePositions = (allPrev.services || allPrev) as Record<string, { x: number; y: number }>;
          prevLayerPositions = (allPrev.layers as Record<string, { x: number; y: number }>) || null;
          const prevServices = await db
            .select()
            .from(services)
            .where(eq(services.analysisId, prevAnalyses[0].id));
          for (const svc of prevServices) {
            if (prevServicePositions[svc.id]) {
              prevPositionsByName[svc.name] = prevServicePositions[svc.id];
            }
          }
        }

        // Clean up old diff analyses and legacy diff checks for this repo
        const oldDiffAnalyses = await db
          .select({ id: analyses.id })
          .from(analyses)
          .where(and(
            eq(analyses.repoId, id),
            sql`(${analyses.metadata}->>'isDiffAnalysis')::boolean IS TRUE`,
          ));
        for (const da of oldDiffAnalyses) {
          await db.delete(analyses).where(eq(analyses.id, da.id));
        }

        // Persist analysis using shared service
        const { analysisId: newAnalysisId, serviceIdMap, moduleIdMap, methodIdMap, dbIdMap } =
          await persistAnalysisResult({ repoId: id, branch, result, commitHash });

        const analysis = { id: newAnalysisId };

        // Load previous active violations for lifecycle tracking.
        // The new analysis we just created has no violations yet, so we fetch the 2 latest
        // non-diff analyses and use the second one (the one before this run).
        const prevConditionsForLifecycle = [eq(analyses.repoId, id), notDiffAnalysis];
        if (branch) prevConditionsForLifecycle.push(eq(analyses.branch, branch));
        const prevAnalysesForLifecycle = await db
          .select({ id: analyses.id })
          .from(analyses)
          .where(and(...prevConditionsForLifecycle))
          .orderBy(desc(analyses.createdAt))
          .limit(2);
        // The first one is the analysis we just created; get the second if it exists
        const previousAnalysisId = prevAnalysesForLifecycle.length > 1 ? prevAnalysesForLifecycle[1].id : null;

        let previousActiveViolations: Awaited<ReturnType<typeof loadActiveViolations>> = [];
        let previousActiveCodeViolations: Awaited<ReturnType<typeof loadActiveCodeViolations>> = [];
        let previousDeterministicViolations: { id: string; ruleKey: string; category: string; title: string; description: string; severity: string; serviceName: string; moduleName: string | null; methodName: string | null }[] = [];

        if (previousAnalysisId) {
          // Load violations from previous analysis directly
          const prevViolationRows = await db
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
              ruleKey: violations.ruleKey,
              deterministicViolationId: violations.deterministicViolationId,
              firstSeenAnalysisId: violations.firstSeenAnalysisId,
              firstSeenAt: violations.firstSeenAt,
            })
            .from(violations)
            .leftJoin(services, eq(violations.targetServiceId, services.id))
            .leftJoin(modules, eq(violations.targetModuleId, modules.id))
            .leftJoin(methods, eq(violations.targetMethodId, methods.id))
            .where(eq(violations.analysisId, previousAnalysisId));

          previousActiveViolations = prevViolationRows.filter(
            (v) => v.status === 'new' || v.status === 'unchanged'
          );

          const prevCodeViolationRows = await db
            .select()
            .from(codeViolations)
            .where(eq(codeViolations.analysisId, previousAnalysisId));

          previousActiveCodeViolations = prevCodeViolationRows
            .filter((v) => v.status === 'new' || v.status === 'unchanged')
            .map((r) => ({
              id: r.id,
              filePath: r.filePath,
              lineStart: r.lineStart,
              lineEnd: r.lineEnd,
              columnStart: r.columnStart,
              columnEnd: r.columnEnd,
              ruleKey: r.ruleKey,
              severity: r.severity,
              title: r.title,
              content: r.content,
              snippet: r.snippet,
              fixPrompt: r.fixPrompt,
              firstSeenAnalysisId: r.firstSeenAnalysisId,
              firstSeenAt: r.firstSeenAt,
            }));

          // Load previous deterministic violations
          previousDeterministicViolations = await db
            .select({
              id: deterministicViolations.id,
              ruleKey: deterministicViolations.ruleKey,
              category: deterministicViolations.category,
              title: deterministicViolations.title,
              description: deterministicViolations.description,
              severity: deterministicViolations.severity,
              serviceName: deterministicViolations.serviceName,
              moduleName: deterministicViolations.moduleName,
              methodName: deterministicViolations.methodName,
            })
            .from(deterministicViolations)
            .where(eq(deterministicViolations.analysisId, previousAnalysisId));
        }

        // Detect and persist flows
        try {
          await detectAndPersistFlows(newAnalysisId, result);
        } catch (flowError) {
          console.error('[Flows] Detection failed:', flowError instanceof Error ? flowError.message : String(flowError));
        }

        // Carry over node positions from previous analysis (namespaced)
        const carryOver: Record<string, unknown> = {};
        if (Object.keys(prevPositionsByName).length > 0) {
          const newServicePositions: Record<string, { x: number; y: number }> = {};
          for (const [name, newId] of serviceIdMap) {
            if (prevPositionsByName[name]) {
              newServicePositions[newId] = prevPositionsByName[name];
            }
          }
          if (Object.keys(newServicePositions).length > 0) {
            carryOver.services = newServicePositions;
          }
        }
        if (prevLayerPositions) {
          const newLayerPositions: Record<string, { x: number; y: number }> = {};
          const prevServices = prevAnalyses.length > 0
            ? await db.select().from(services).where(eq(services.analysisId, prevAnalyses[0].id))
            : [];
          const prevIdToName = new Map(prevServices.map((s) => [s.id, s.name]));
          for (const [key, pos] of Object.entries(prevLayerPositions)) {
            const name = prevIdToName.get(key);
            if (name) {
              const newId = serviceIdMap.get(name);
              if (newId) newLayerPositions[newId] = pos;
            } else {
              newLayerPositions[key] = pos;
            }
          }
          if (Object.keys(newLayerPositions).length > 0) {
            carryOver.layers = newLayerPositions;
          }
        }
        if (Object.keys(carryOver).length > 0) {
          await db
            .update(analyses)
            .set({ nodePositions: carryOver })
            .where(eq(analyses.id, analysis.id));
        }

        // Update repo lastAnalyzedAt
        await db
          .update(repos)
          .set({ lastAnalyzedAt: new Date(), updatedAt: new Date() })
          .where(eq(repos.id, id));

        // Incremental file detection: only review changed files if previous commit hash exists
        let changedFileSet: Set<string> | undefined;
        if (previousAnalysisId) {
          const [prevAnalysisRow] = await db
            .select({ commitHash: analyses.commitHash })
            .from(analyses)
            .where(eq(analyses.id, previousAnalysisId))
            .limit(1);
          if (prevAnalysisRow?.commitHash) {
            try {
              const diffOutput = await git.diff([prevAnalysisRow.commitHash, 'HEAD', '--name-only']);
              const changedFiles = diffOutput.trim().split('\n').filter(Boolean);
              if (changedFiles.length > 0) {
                changedFileSet = new Set(changedFiles);
                console.log(`[Analysis] Incremental: ${changedFiles.length} changed files since ${prevAnalysisRow.commitHash.slice(0, 8)}`);
              }
            } catch (diffError) {
              console.log(`[Analysis] Could not compute diff, reviewing all files: ${diffError instanceof Error ? diffError.message : String(diffError)}`);
            }
          }
        }

        // Run violation pipeline (deterministic + LLM + code rules + persistence)
        tracker.done('parse', `${result.services.length} services, ${result.fileAnalyses?.length ?? 0} files`);

        const provider = createLLMProvider();
        provider.setAnalysisId(newAnalysisId);
        provider.setRepoId(id);
        provider.setAbortSignal(abortController.signal);
        let codeReviewPromise: Promise<void> | null = null;
        try {
          const pipelineResult = await runViolationPipeline({
            repoId: id,
            repoPath: repo.path,
            analysisId: newAnalysisId,
            result,
            serviceIdMap,
            moduleIdMap,
            methodIdMap,
            dbIdMap,
            previousActiveViolations,
            previousActiveCodeViolations,
            previousDeterministicViolations,
            changedFileSet,
            tracker,
            provider,
            signal: abortController.signal,
          });

          emitViolationsReady(id, analysis.id);
          codeReviewPromise = pipelineResult.codeReviewPromise;
        } catch (violationError) {
          // Don't log AbortError as a failure — it's expected on cancel
          if (violationError instanceof DOMException && violationError.name === 'AbortError') {
            console.log(`[Violations] Cancelled for repo ${id}`);
          } else {
            console.error(
              `[Violations] Failed for repo ${id}:`,
              violationError instanceof Error ? violationError.message : String(violationError)
            );
          }
          // Still emit violations:ready so clients don't hang waiting
          emitViolationsReady(id, analysis.id);
        }

        // Flush LLM usage records for flows 1+2
        try {
          await provider.flushUsage();
        } catch (usageError) {
          console.error('[Usage] Failed to record usage:', usageError instanceof Error ? usageError.message : String(usageError));
        }

        // Mark code review as triggered before completing so it appears in the final checklist state
        if (codeReviewPromise) {
          tracker.start('code-review', 'Running in background...');
        } else {
          tracker.done('code-review', 'Skipped');
        }

        emitAnalysisComplete(id, analysis.id);

        // Fire-and-forget: background code review with deferred cleanup
        if (codeReviewPromise) {
          console.log(`[CodeReview] Started background code review for repo ${id}`);
          emitCodeReviewProgress(id, analysis.id);
          codeReviewPromise
            .then(() => provider.flushUsage())
            .then(() => {
              console.log(`[CodeReview] Completed for repo ${id}`);
              emitCodeReviewReady(id, analysis.id);
            })
            .catch((err) => {
              if (err instanceof DOMException && err.name === 'AbortError') {
                console.log(`[CodeReview] Cancelled for repo ${id}`);
              } else {
                console.error(`[CodeReview] Failed for repo ${id}:`, err instanceof Error ? err.message : String(err));
              }
              // Always emit so UI doesn't hang
              emitCodeReviewReady(id, analysis.id);
            })
            .finally(() => unregisterAnalysis(id));
        } else {
          unregisterAnalysis(id);
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          console.log(`[Analysis] Cancelled for repo ${id}`);
        } else {
          console.error(
            `[Analysis] Failed for repo ${id}:`,
            error instanceof Error ? error.message : String(error)
          );
          emitAnalysisProgress(id, {
            step: 'error',
            percent: -1,
            detail: error instanceof Error ? error.message : 'Analysis failed',
          });
        }
        unregisterAnalysis(id);
      }
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/repos/:id/analyze/cancel - Cancel in-progress analysis
router.post(
  '/:id/analyze/cancel',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      const canceled = cancelAnalysis(id);
      if (canceled) {
        emitAnalysisCanceled(id);
        res.json({ message: 'Analysis cancelled' });
      } else {
        throw createAppError('No active analysis for this repo', 404);
      }
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/repos/:id/analyses - List past analyses (enhanced with counts)
router.get(
  '/:id/analyses',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;

      const [repo] = await db
        .select()
        .from(repos)
        .where(eq(repos.id, id))
        .limit(1);

      if (!repo) {
        throw createAppError('Repo not found', 404);
      }

      const analysisList = await db
        .select({
          id: analyses.id,
          branch: analyses.branch,
          architecture: analyses.architecture,
          createdAt: analyses.createdAt,
        })
        .from(analyses)
        .where(and(eq(analyses.repoId, id), notDiffAnalysis))
        .orderBy(desc(analyses.createdAt))
        .limit(20);

      // Enrich with counts per analysis
      const enriched = await Promise.all(
        analysisList.map(async (a) => {
          const [serviceCount, violationCounts, codeViolationCounts, usageSummary] = await Promise.all([
            db.select({ count: sql<number>`count(*)::int` }).from(services).where(eq(services.analysisId, a.id)).then(([r]) => r.count),
            db.select({
              severity: violations.severity,
              count: sql<number>`count(*)::int`,
            }).from(violations).where(eq(violations.analysisId, a.id)).groupBy(violations.severity),
            db.select({
              severity: codeViolations.severity,
              count: sql<number>`count(*)::int`,
            }).from(codeViolations).where(eq(codeViolations.analysisId, a.id)).groupBy(codeViolations.severity),
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

          const codeViolationsBySeverity: Record<string, number> = {};
          for (const { severity, count } of codeViolationCounts) {
            codeViolationsBySeverity[severity] = count;
          }

          return {
            ...a,
            serviceCount,
            violationsBySeverity,
            codeViolationsBySeverity,
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

      const [repo] = await db
        .select()
        .from(repos)
        .where(eq(repos.id, id))
        .limit(1);

      if (!repo) {
        throw createAppError('Repo not found', 404);
      }

      // If analysisId is provided, load that specific analysis (verify it belongs to repo)
      const analysisId = req.query.analysisId as string | undefined;
      let analysis;

      if (analysisId) {
        const [specific] = await db
          .select()
          .from(analyses)
          .where(and(eq(analyses.id, analysisId), eq(analyses.repoId, id)))
          .limit(1);
        if (!specific) {
          res.json({ nodes: [], edges: [] });
          return;
        }
        analysis = specific;
      } else {
        // Find the latest non-diff analysis for the branch
        const conditions = [eq(analyses.repoId, id), notDiffAnalysis];
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
      const graphLevel = level.replace(/s$/, '') as GraphLevel;

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
        analysisDetViolations,
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
        db.select().from(deterministicViolations).where(eq(deterministicViolations.analysisId, analysis.id)),
      ]);

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

      const graphData = buildUnifiedGraph(graphLevel, {
        services: analysisServices,
        serviceDeps: analysisDeps,
        layers: layerData,
        modules: analysisModules,
        moduleDeps: analysisModuleDeps,
        methods: analysisMethods,
        methodDeps: analysisMethodDeps,
        databases: analysisDatabases,
        dbConnections: analysisDbConnections,
        deterministicViolations: analysisDetViolations,
      });

      // Include saved node positions if any (namespaced by level)
      const allPositions = analysis.nodePositions as Record<string, unknown> | null;
      const savedPositions = allPositions?.[level] as Record<string, { x: number; y: number }> | undefined;
      if (savedPositions) {
        for (const node of graphData.nodes) {
          const pos = savedPositions[node.id];
          if (pos) {
            node.position = pos;
          }
        }
      }

      // Include collapsed IDs for this level
      const collapsed = (allPositions?.collapsedIds as Record<string, string[]>) || {};
      const collapsedIds = collapsed[level] || [];

      res.set('Cache-Control', 'no-store');
      res.json({ ...graphData, collapsedIds });
    } catch (error) {
      next(error);
    }
  }
);

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

      const conditions = [eq(analyses.repoId, id), notDiffAnalysis];
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
        throw createAppError('No analysis found', 404);
      }

      const existing = (latestAnalysis[0].nodePositions as Record<string, unknown>) || {};
      const merged = { ...existing, [level]: positions };

      await db
        .update(analyses)
        .set({ nodePositions: merged })
        .where(eq(analyses.id, latestAnalysis[0].id));

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

      const conditions = [eq(analyses.repoId, id), notDiffAnalysis];
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
        throw createAppError('No analysis found', 404);
      }

      const existing = (latestAnalysis[0].nodePositions as Record<string, unknown>) || {};
      delete existing[level];
      const merged = Object.keys(existing).length > 0 ? existing : null;

      await db
        .update(analyses)
        .set({ nodePositions: merged })
        .where(eq(analyses.id, latestAnalysis[0].id));

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

      const conditions = [eq(analyses.repoId, id), notDiffAnalysis];
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
        throw createAppError('No analysis found', 404);
      }

      const existing = (latestAnalysis[0].nodePositions as Record<string, unknown>) || {};
      const existingCollapsed = (existing.collapsedIds as Record<string, string[]>) || {};
      const merged = { ...existing, collapsedIds: { ...existingCollapsed, [level]: ids } };

      await db
        .update(analyses)
        .set({ nodePositions: merged })
        .where(eq(analyses.id, latestAnalysis[0].id));

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

      const [repo] = await db
        .select()
        .from(repos)
        .where(eq(repos.id, id))
        .limit(1);

      if (!repo) {
        throw createAppError('Repo not found', 404);
      }

      const git = simpleGit(repo.path);
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

      const [repo] = await db
        .select()
        .from(repos)
        .where(eq(repos.id, id))
        .limit(1);

      if (!repo) {
        throw createAppError('Repo not found', 404);
      }

      const git = simpleGit(repo.path);
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
        .where(and(eq(analyses.repoId, id), notDiffAnalysis))
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

// POST /api/repos/:id/diff-check - Run diff analysis with LLM diffing
router.post(
  '/:id/diff-check',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;

      const [repo] = await db
        .select()
        .from(repos)
        .where(eq(repos.id, id))
        .limit(1);

      if (!repo) {
        throw createAppError('Repo not found', 404);
      }

      // Find latest normal analysis (exclude diff analyses)
      const [latestAnalysis] = await db
        .select({ id: analyses.id })
        .from(analyses)
        .where(and(eq(analyses.repoId, id), notDiffAnalysis))
        .orderBy(desc(analyses.createdAt))
        .limit(1);

      if (!latestAnalysis) {
        res.status(409).json({ error: 'Switch to Normal mode and run an analysis first' });
        return;
      }

      // Load previous active violations for lifecycle tracking
      const prevViolationRows = await db
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
          ruleKey: violations.ruleKey,
          deterministicViolationId: violations.deterministicViolationId,
          firstSeenAnalysisId: violations.firstSeenAnalysisId,
          firstSeenAt: violations.firstSeenAt,
        })
        .from(violations)
        .leftJoin(services, eq(violations.targetServiceId, services.id))
        .leftJoin(modules, eq(violations.targetModuleId, modules.id))
        .leftJoin(methods, eq(violations.targetMethodId, methods.id))
        .where(eq(violations.analysisId, latestAnalysis.id));

      const previousActiveViolations = prevViolationRows.filter(
        (v) => v.status === 'new' || v.status === 'unchanged'
      );

      // Load previous active code violations
      const prevCodeViolationRows = await db
        .select()
        .from(codeViolations)
        .where(eq(codeViolations.analysisId, latestAnalysis.id));

      const previousActiveCodeViolations = prevCodeViolationRows
        .filter((v) => v.status === 'new' || v.status === 'unchanged')
        .map((r) => ({
          id: r.id,
          filePath: r.filePath,
          lineStart: r.lineStart,
          lineEnd: r.lineEnd,
          columnStart: r.columnStart,
          columnEnd: r.columnEnd,
          ruleKey: r.ruleKey,
          severity: r.severity,
          title: r.title,
          content: r.content,
          snippet: r.snippet,
          fixPrompt: r.fixPrompt,
          firstSeenAnalysisId: r.firstSeenAnalysisId,
          firstSeenAt: r.firstSeenAt,
        }));

      const git = simpleGit(repo.path);
      const branch = (await git.branch()).current || undefined;

      // Phase 1: Run analysis on dirty tree + get changed files
      const diffAnalysis = await runDiffAnalysis({
        repoPath: repo.path,
        branch,
        onProgress: (progress) => {
          emitAnalysisProgress(id, progress);
        },
      });

      const result = diffAnalysis.analysisResult;
      const changedFiles = diffAnalysis.changedFiles;

      // Delete old diff analyses (cascade deletes their violations)
      const oldDiffAnalyses = await db
        .select({ id: analyses.id })
        .from(analyses)
        .where(and(
          eq(analyses.repoId, id),
          sql`(${analyses.metadata}->>'isDiffAnalysis')::boolean IS TRUE`,
        ));
      for (const da of oldDiffAnalyses) {
        await db.delete(analyses).where(eq(analyses.id, da.id));
      }

      // Persist the diff analysis — get real DB IDs
      const { analysisId: diffAnalysisId, serviceIdMap, moduleIdMap, methodIdMap, dbIdMap } =
        await persistAnalysisResult({
          repoId: id,
          branch: branch || null,
          result,
          metadata: { isDiffAnalysis: true },
        });

      // Load previous deterministic violations for lifecycle
      const prevDetViolations = await db
        .select({
          id: deterministicViolations.id,
          ruleKey: deterministicViolations.ruleKey,
          category: deterministicViolations.category,
          title: deterministicViolations.title,
          description: deterministicViolations.description,
          severity: deterministicViolations.severity,
          serviceName: deterministicViolations.serviceName,
          moduleName: deterministicViolations.moduleName,
          methodName: deterministicViolations.methodName,
        })
        .from(deterministicViolations)
        .where(eq(deterministicViolations.analysisId, latestAnalysis.id));

      const changedFileSet = new Set(changedFiles.filter((f) => f.status !== 'deleted').map((f) => f.path));

      // Run violation pipeline
      const diffProvider = createLLMProvider();
      diffProvider.setAnalysisId(diffAnalysisId);
      const pipelineResult = await runViolationPipeline({
        repoId: id,
        repoPath: repo.path,
        analysisId: diffAnalysisId,
        result,
        serviceIdMap,
        moduleIdMap,
        methodIdMap,
        dbIdMap,
        previousActiveViolations,
        previousActiveCodeViolations,
        previousDeterministicViolations: prevDetViolations,
        changedFileSet,
        onProgress: (progress) => emitAnalysisProgress(id, progress),
        provider: diffProvider,
      });
      try { await diffProvider.flushUsage(); } catch { /* best-effort */ }
      // Compute affected node IDs from changed files + new violations
      const affectedServices = new Set<string>();
      for (const svc of result.services) {
        const relRoot = path.relative(repo.path, svc.rootPath);
        for (const file of changedFiles) {
          if (file.path.startsWith(relRoot + '/') || file.path === relRoot) {
            affectedServices.add(svc.name);
          }
        }
      }

      const affectedModules = new Set<string>();
      const affectedMethods = new Set<string>();
      for (const v of (pipelineResult.newViolations || [])) {
        if (v.targetServiceName) affectedServices.add(v.targetServiceName);
        if (v.targetModuleName && v.targetServiceName) {
          affectedModules.add(`${v.targetServiceName}::${v.targetModuleName}`);
        }
        if (v.targetMethodName && v.targetModuleName && v.targetServiceName) {
          affectedMethods.add(`${v.targetServiceName}::${v.targetModuleName}::${v.targetMethodName}`);
        }
      }

      const affectedNodeIds = {
        services: [...affectedServices],
        layers: [] as string[],
        modules: [...affectedModules],
        methods: [...affectedMethods],
      };

      // Build resolved arch violations for the response
      const resolvedSet = new Set(pipelineResult.resolvedViolationIds || []);
      const resolvedArchViolations = previousActiveViolations
        .filter((v) => resolvedSet.has(v.id))
        .map((v) => ({
          id: v.id,
          type: v.type,
          title: v.title,
          content: v.content,
          severity: v.severity,
          targetServiceId: v.targetServiceId,
          targetServiceName: v.targetServiceName,
          targetDatabaseId: v.targetDatabaseId ?? null,
          targetDatabaseName: null,
          targetModuleId: v.targetModuleId,
          targetModuleName: v.targetModuleName,
          targetMethodId: v.targetMethodId,
          targetMethodName: v.targetMethodName,
          targetTable: v.targetTable ?? null,
          fixPrompt: v.fixPrompt,
          createdAt: v.firstSeenAt?.toISOString() ?? new Date().toISOString(),
        }));

      // Load code violations from DB (pipeline persisted them with lifecycle status)
      const diffCodeViolationRows = await db
        .select()
        .from(codeViolations)
        .where(eq(codeViolations.analysisId, diffAnalysisId));

      const newCodeViolationItems = diffCodeViolationRows
        .filter((cv) => cv.status === 'new')
        .map((cv) => ({
          type: 'code' as const,
          title: cv.title,
          content: cv.content,
          severity: cv.severity,
          targetServiceId: null as string | null,
          targetModuleId: null as string | null,
          targetMethodId: null as string | null,
          targetServiceName: null as string | null,
          targetModuleName: null as string | null,
          targetMethodName: null as string | null,
          fixPrompt: cv.fixPrompt,
          filePath: cv.filePath,
          lineStart: cv.lineStart,
        }));

      const resolvedCodeViolations = diffCodeViolationRows
        .filter((cv) => cv.status === 'resolved')
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

      const allNewViolations = [...(pipelineResult.newViolations || []), ...newCodeViolationItems];
      const allResolvedViolations = [...resolvedArchViolations, ...resolvedCodeViolations];

      // Compute summary once — single source of truth
      const summary = {
        newCount: allNewViolations.length,
        resolvedCount: allResolvedViolations.length,
      };

      // Store metadata in diff analysis (after all data is ready)
      await db
        .update(analyses)
        .set({
          metadata: {
            isDiffAnalysis: true,
            changedFiles,
            affectedNodeIds,
            summary,
            baselineAnalysisId: latestAnalysis.id,
          },
        })
        .where(eq(analyses.id, diffAnalysisId));

      // Clear progress bar
      emitAnalysisProgress(id, { step: 'complete', percent: 100, detail: 'Diff check complete' });

      res.json({
        changedFiles,
        resolvedViolations: allResolvedViolations,
        newViolations: allNewViolations,
        affectedNodeIds,
        summary,
        isStale: false,
        diffAnalysisId,
      });
    } catch (error) {
      const repoId = req.params.id as string;
      emitAnalysisProgress(repoId, { step: 'error', percent: -1, detail: error instanceof Error ? error.message : 'Diff check failed' });
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

      const [repo] = await db
        .select()
        .from(repos)
        .where(eq(repos.id, id))
        .limit(1);

      if (!repo) {
        throw createAppError('Repo not found', 404);
      }

      // Find latest diff analysis (metadata.isDiffAnalysis = true)
      const [diffAnalysis] = await db
        .select()
        .from(analyses)
        .where(and(
          eq(analyses.repoId, id),
          sql`(${analyses.metadata}->>'isDiffAnalysis')::boolean IS TRUE`,
        ))
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
        .where(and(eq(analyses.repoId, id), notDiffAnalysis))
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

      // Load new code violations for this diff analysis
      const diffCodeViolationRows = await db
        .select()
        .from(codeViolations)
        .where(eq(codeViolations.analysisId, diffAnalysis.id));

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

      const [repo] = await db
        .select()
        .from(repos)
        .where(eq(repos.id, id))
        .limit(1);

      if (!repo) {
        throw createAppError('Repo not found', 404);
      }

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
        const git = simpleGit(repo.path);
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
