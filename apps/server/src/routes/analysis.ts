import { Router, type Request, type Response, type NextFunction } from 'express';
import { eq, desc, and } from 'drizzle-orm';
import { db } from '../config/database.js';
import {
  repos,
  analyses,
  services,
  serviceDependencies,
  layers,
  layerDependencies,
  insights,
  databases,
  databaseConnections,
} from '../db/schema.js';
import { AnalyzeRepoSchema } from '@truecourse/shared';
import { createAppError } from '../middleware/error.js';
import { simpleGit } from 'simple-git';
import { runAnalysis } from '../services/analyzer.service.js';
import {
  emitAnalysisProgress,
  emitAnalysisComplete,
  emitInsightsReady,
} from '../socket/handlers.js';
import { buildGraphData, buildLayerGraphData } from '../services/graph.service.js';
import { generateInsights } from '../services/insight.service.js';
import { getAllDefaultRules } from '@truecourse/analyzer';
import { v4 as uuidv4 } from 'uuid';

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

      // Detect current branch (never checkout — analyze what's on disk)
      const git = simpleGit(repo.path);
      const branch = (await git.branch()).current || null;

      // Respond immediately, run analysis asynchronously
      res.status(202).json({ message: 'Analysis started', repoId: id, branch });

      // Run analysis in the background
      try {
        emitAnalysisProgress(id, {
          step: 'starting',
          percent: 0,
          detail: 'Starting analysis...',
        });

        const result = await runAnalysis(repo.path, branch ?? undefined, (progress) => {
          emitAnalysisProgress(id, progress);
        });

        // Get previous analysis positions (mapped by service name)
        const prevConditions = [eq(analyses.repoId, id)];
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

        // Save analysis to database
        const [analysis] = await db
          .insert(analyses)
          .values({
            repoId: id,
            branch: branch || null,
            architecture: result.architecture,
            metadata: result.metadata,
          })
          .returning();

        // Save services
        const serviceIdMap = new Map<string, string>();

        for (const svc of result.services) {
          const [savedService] = await db
            .insert(services)
            .values({
              analysisId: analysis.id,
              name: svc.name,
              rootPath: svc.rootPath,
              type: svc.type,
              framework: svc.framework || null,
              fileCount: svc.fileCount,
              layerSummary: svc.layers,
            })
            .returning();

          serviceIdMap.set(svc.name, savedService.id);
        }

        // Save service dependencies
        for (const dep of result.dependencies) {
          const sourceId = serviceIdMap.get(dep.source);
          const targetId = serviceIdMap.get(dep.target);

          if (sourceId && targetId) {
            const depType = dep.httpCalls && dep.httpCalls.length > 0 ? 'http' : 'import';
            const depCount = dep.dependencies.length + (dep.httpCalls?.length || 0);

            await db.insert(serviceDependencies).values({
              analysisId: analysis.id,
              sourceServiceId: sourceId,
              targetServiceId: targetId,
              dependencyCount: depCount,
              dependencyType: depType,
            });
          }
        }

        // Save layer details
        if (result.layerDetails) {
          for (const detail of result.layerDetails) {
            const serviceId = serviceIdMap.get(detail.serviceName);
            if (serviceId) {
              await db.insert(layers).values({
                analysisId: analysis.id,
                serviceId,
                serviceName: detail.serviceName,
                layer: detail.layer,
                fileCount: detail.fileCount,
                filePaths: detail.filePaths,
                confidence: Math.round(detail.confidence * 100),
                evidence: detail.evidence,
              });
            }
          }
        }

        // Save layer dependencies
        if (result.layerDependencies) {
          for (const dep of result.layerDependencies) {
            await db.insert(layerDependencies).values({
              analysisId: analysis.id,
              sourceServiceName: dep.sourceServiceName,
              sourceLayer: dep.sourceLayer,
              targetServiceName: dep.targetServiceName,
              targetLayer: dep.targetLayer,
              dependencyCount: dep.dependencyCount,
              isViolation: dep.isViolation,
              violationReason: dep.violationReason || null,
            });
          }

        }

        // Save detected databases
        const dbIdMap = new Map<string, string>();
        if (result.databaseResult && result.databaseResult.databases.length > 0) {

          for (const dbInfo of result.databaseResult.databases) {
            const [savedDb] = await db.insert(databases).values({
              analysisId: analysis.id,
              name: dbInfo.name,
              type: dbInfo.type,
              driver: dbInfo.driver,
              connectionConfig: dbInfo.connectionEnvVar ? { envVar: dbInfo.connectionEnvVar } : null,
              tables: dbInfo.tables,
              dbRelations: dbInfo.relations,
              connectedServices: dbInfo.connectedServices,
            }).returning();

            dbIdMap.set(dbInfo.name, savedDb.id);
          }

          for (const conn of result.databaseResult.connections) {
            const serviceId = serviceIdMap.get(conn.serviceName);
            const databaseId = dbIdMap.get(conn.databaseName);
            if (serviceId && databaseId) {
              await db.insert(databaseConnections).values({
                analysisId: analysis.id,
                serviceId,
                databaseId,
                driver: conn.driver,
              });
            }
          }
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
          // Layer positions use service group IDs which change on re-analysis;
          // remap using service name → new ID
          const newLayerPositions: Record<string, { x: number; y: number }> = {};
          const prevServices = prevAnalyses.length > 0
            ? await db.select().from(services).where(eq(services.analysisId, prevAnalyses[0].id))
            : [];
          const prevIdToName = new Map(prevServices.map((s) => [s.id, s.name]));
          for (const [key, pos] of Object.entries(prevLayerPositions)) {
            // Service group positions: old service ID → name → new service ID
            const name = prevIdToName.get(key);
            if (name) {
              const newId = serviceIdMap.get(name);
              if (newId) newLayerPositions[newId] = pos;
            } else {
              // Database or other nodes — keep as-is
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

        // Generate LLM insights before completing
        try {
          emitAnalysisProgress(id, {
            step: 'insights',
            percent: 90,
            detail: 'Generating insights...',
          });

          const analysisServices = result.services.map((s) => ({
            id: serviceIdMap.get(s.name)!,
            name: s.name,
            type: s.type,
            framework: s.framework || undefined,
            fileCount: s.fileCount,
            layerSummary: s.layers,
          }));

          const analysisDeps = result.dependencies.map((d) => ({
            sourceServiceName: d.source,
            targetServiceName: d.target,
            dependencyCount: d.dependencies.length + (d.httpCalls?.length || 0),
            dependencyType: d.httpCalls && d.httpCalls.length > 0 ? 'http' : 'import',
          }));

          const violationDescriptions = (result.layerDependencies || [])
            .filter((d) => d.isViolation)
            .map((v) => `${v.sourceLayer} → ${v.targetLayer} in ${v.sourceServiceName}: ${v.violationReason || 'layer violation'}`);

          // Gather enabled LLM rules for insight generation
          const allRules = getAllDefaultRules();
          const enabledLlmRules = allRules
            .filter((r) => r.type === 'llm' && r.enabled && r.prompt)
            .map((r) => ({ name: r.name, severity: r.severity, prompt: r.prompt! }));

          const { insights: generatedInsights, serviceDescriptions } = await generateInsights({
            architecture: result.architecture,
            services: analysisServices,
            dependencies: analysisDeps,
            violations: violationDescriptions,
            databases: result.databaseResult?.databases.map((d) => ({
              id: dbIdMap.get(d.name)!,
              name: d.name,
              type: d.type,
              driver: d.driver,
              tableCount: d.tables.length,
              connectedServices: d.connectedServices,
              tables: d.tables.map((t) => ({
                name: t.name,
                columns: t.columns.map((c) => ({
                  name: c.name,
                  type: c.type,
                  isNullable: c.isNullable,
                  isPrimaryKey: c.isPrimaryKey,
                  isForeignKey: c.isForeignKey,
                  referencesTable: c.referencesTable,
                })),
              })),
              relations: d.relations.map((r) => ({
                sourceTable: r.sourceTable,
                targetTable: r.targetTable,
                foreignKeyColumn: r.foreignKeyColumn,
              })),
            })),
            llmRules: enabledLlmRules,
          });

          for (const insight of generatedInsights) {
            await db.insert(insights).values({
              id: uuidv4(),
              repoId: id,
              analysisId: analysis.id,
              type: insight.type,
              title: insight.title,
              content: insight.content,
              severity: insight.severity,
              targetServiceId: insight.targetServiceId || null,
              targetDatabaseId: insight.targetDatabaseId || null,
              targetTable: insight.targetTable || null,
              fixPrompt: insight.fixPrompt || null,
            });
          }

          // Save service descriptions
          for (const desc of serviceDescriptions) {
            if (desc.id) {
              await db
                .update(services)
                .set({ description: desc.description })
                .where(eq(services.id, desc.id));
            }
          }

          emitInsightsReady(id, analysis.id);
        } catch (insightError) {
          console.error(
            `[Insights] Failed for repo ${id}:`,
            insightError instanceof Error ? insightError.message : String(insightError)
          );
        }

        emitAnalysisComplete(id, analysis.id);
      } catch (error) {
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

      // Find the latest analysis for the branch
      const conditions = [eq(analyses.repoId, id)];
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

      const analysis = latestAnalysis[0];

      const level = (req.query.level as string) || 'services';

      const analysisServices = await db
        .select()
        .from(services)
        .where(eq(services.analysisId, analysis.id));

      const analysisDeps = await db
        .select()
        .from(serviceDependencies)
        .where(eq(serviceDependencies.analysisId, analysis.id));

      // Fetch databases for this analysis
      const analysisDatabases = await db
        .select()
        .from(databases)
        .where(eq(databases.analysisId, analysis.id));

      const analysisDbConnections = await db
        .select()
        .from(databaseConnections)
        .where(eq(databaseConnections.analysisId, analysis.id));

      let graphData;

      if (level === 'layers') {
        const analysisLayers = await db
          .select()
          .from(layers)
          .where(eq(layers.analysisId, analysis.id));

        const analysisLayerDeps = await db
          .select()
          .from(layerDependencies)
          .where(eq(layerDependencies.analysisId, analysis.id));

        graphData = buildLayerGraphData(
          analysisServices,
          analysisDeps,
          analysisLayers.map((l) => ({
            id: l.id,
            serviceName: l.serviceName,
            serviceId: l.serviceId,
            layer: l.layer,
            fileCount: l.fileCount,
            filePaths: l.filePaths as string[],
            confidence: l.confidence,
            evidence: l.evidence as string[],
          })),
          analysisLayerDeps,
          analysisDatabases,
          analysisDbConnections,
        );
      } else {
        graphData = buildGraphData(analysisServices, analysisDeps, analysisDatabases, analysisDbConnections);
      }

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

      res.json(graphData);
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

      const conditions = [eq(analyses.repoId, id)];
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

      const conditions = [eq(analyses.repoId, id)];
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

      // Find latest analysis and its services to match affected services
      const latestAnalysis = await db
        .select()
        .from(analyses)
        .where(eq(analyses.repoId, id))
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

export default router;
