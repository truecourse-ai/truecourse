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
  modules,
  methods,
  moduleDeps,
  methodDeps,
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
import { buildGraphData, buildLayerGraphData, buildModuleGraphData, buildMethodGraphData } from '../services/graph.service.js';
import { generateInsights } from '../services/insight.service.js';
import { getAllDefaultRules, checkModuleRules, type ModuleViolation } from '@truecourse/analyzer';
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

        // Save modules
        const moduleIdMap = new Map<string, string>(); // "serviceName::moduleName" → dbId
        if (result.modules && result.modules.length > 0) {
          // Build layer lookup: "serviceName::layerName" → layerId
          const layerIdLookup = new Map<string, string>();
          const savedLayers = await db
            .select()
            .from(layers)
            .where(eq(layers.analysisId, analysis.id));
          for (const l of savedLayers) {
            layerIdLookup.set(`${l.serviceName}::${l.layer}`, l.id);
          }

          for (const mod of result.modules) {
            const serviceId = serviceIdMap.get(mod.serviceName);
            const layerId = layerIdLookup.get(`${mod.serviceName}::${mod.layerName}`);
            if (!serviceId || !layerId) continue;

            const [saved] = await db.insert(modules).values({
              analysisId: analysis.id,
              layerId,
              serviceId,
              name: mod.name,
              kind: mod.kind,
              filePath: mod.filePath,
              methodCount: mod.methodCount,
              propertyCount: mod.propertyCount,
              importCount: mod.importCount,
              exportCount: mod.exportCount,
              superClass: mod.superClass || null,
              lineCount: mod.lineCount || null,
            }).returning();

            moduleIdMap.set(`${mod.serviceName}::${mod.name}`, saved.id);
          }
        }

        // Save methods (and build methodIdMap for method deps)
        const methodIdMap = new Map<string, string>();
        if (result.methods && result.methods.length > 0) {
          for (const method of result.methods) {
            const moduleKey = `${method.serviceName}::${method.moduleName}`;
            const moduleId = moduleIdMap.get(moduleKey);
            if (!moduleId) continue;

            const [saved] = await db.insert(methods).values({
              analysisId: analysis.id,
              moduleId,
              name: method.name,
              signature: method.signature,
              paramCount: method.paramCount,
              returnType: method.returnType || null,
              isAsync: method.isAsync,
              isExported: method.isExported,
              lineCount: method.lineCount || null,
              statementCount: method.statementCount || null,
              maxNestingDepth: method.maxNestingDepth || null,
            }).returning();

            methodIdMap.set(`${method.serviceName}::${method.moduleName}::${method.name}`, saved.id);
          }
        }

        // Save module dependencies
        console.log(`[Analysis] File dependencies: ${result.dependencies.length}, Module-level deps: ${result.moduleLevelDependencies?.length ?? 0}, Modules: ${result.modules?.length ?? 0}`);
        if (result.moduleLevelDependencies && result.moduleLevelDependencies.length > 0) {
          for (const dep of result.moduleLevelDependencies) {
            const srcId = moduleIdMap.get(`${dep.sourceService}::${dep.sourceModule}`);
            const tgtId = moduleIdMap.get(`${dep.targetService}::${dep.targetModule}`);
            if (!srcId || !tgtId) {
              console.log(`[Analysis] Skipped module dep: ${dep.sourceService}::${dep.sourceModule} → ${dep.targetService}::${dep.targetModule} (srcId=${!!srcId}, tgtId=${!!tgtId})`);
              continue;
            }

            await db.insert(moduleDeps).values({
              analysisId: analysis.id,
              sourceModuleId: srcId,
              targetModuleId: tgtId,
              importedNames: dep.importedNames,
              dependencyCount: dep.importedNames.length || 1,
            });
          }
        }

        // Save method dependencies
        if (result.methodLevelDependencies && result.methodLevelDependencies.length > 0) {
          for (const dep of result.methodLevelDependencies) {
            const srcId = methodIdMap.get(`${dep.callerService}::${dep.callerModule}::${dep.callerMethod}`);
            const tgtId = methodIdMap.get(`${dep.calleeService}::${dep.calleeModule}::${dep.calleeMethod}`);
            if (!srcId || !tgtId) continue;

            await db.insert(methodDeps).values({
              analysisId: analysis.id,
              sourceMethodId: srcId,
              targetMethodId: tgtId,
              callCount: dep.callCount,
            });
          }
        }

        // Check deterministic module rules
        let moduleViolations: ModuleViolation[] = [];
        if (result.modules && result.methods) {
          const allRules = getAllDefaultRules();
          const enabledDeterministic = allRules.filter((r) => r.type === 'deterministic' && r.enabled);

          // Build set of module keys connected to databases so they aren't flagged as dead
          const dbConnectedModuleKeys = new Set<string>();
          if (result.databaseResult) {
            for (const conn of result.databaseResult.connections) {
              const driverLower = conn.driver.toLowerCase();
              const dbNameLower = conn.databaseName.toLowerCase();
              const dataModules = result.modules.filter(
                (m) => m.serviceName === conn.serviceName && m.layerName === 'data',
              );
              if (dataModules.length > 0) {
                const matched = dataModules.find((m) => {
                  const nameLower = m.name.toLowerCase();
                  return nameLower.includes(driverLower) || driverLower.includes(nameLower)
                    || nameLower.includes(dbNameLower) || dbNameLower.includes(nameLower);
                });
                const mod = matched || dataModules[0];
                dbConnectedModuleKeys.add(`${mod.serviceName}::${mod.name}`);
              }
            }
          }

          moduleViolations = checkModuleRules(
            result.modules,
            result.methods,
            result.moduleDependencies || [],
            enabledDeterministic,
            result.moduleLevelDependencies || [],
            dbConnectedModuleKeys,
            result.methodLevelDependencies || [],
          );

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
          const callParts: string[] = ['architecture'];
          if (result.databaseResult && result.databaseResult.databases.length > 0) callParts.push('database');
          if (result.modules && result.modules.length > 0) callParts.push('module');

          let currentPercent = 85;
          emitAnalysisProgress(id, {
            step: 'insights',
            percent: currentPercent,
            detail: `Generating insights (${callParts.join(', ')})...`,
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

          // Gather enabled LLM rules with category for insight generation
          const allRules = getAllDefaultRules();
          const enabledLlmRules = allRules
            .filter((r) => r.type === 'llm' && r.enabled && r.prompt)
            .map((r) => ({ name: r.name, severity: r.severity, prompt: r.prompt!, category: r.category }));

          // Build module data for insight generation
          const insightModules = result.modules?.map((m) => ({
            id: moduleIdMap.get(`${m.serviceName}::${m.name}`) || '',
            name: m.name,
            kind: m.kind,
            serviceName: m.serviceName,
            layerName: m.layerName,
            methodCount: m.methodCount,
            propertyCount: m.propertyCount,
            importCount: m.importCount,
            exportCount: m.exportCount,
            superClass: m.superClass || undefined,
            lineCount: m.lineCount || undefined,
          })).filter((m) => m.id); // exclude modules that weren't saved

          const insightMethods = result.methods?.map((m) => ({
            id: methodIdMap.get(`${m.serviceName}::${m.moduleName}::${m.name}`) || undefined,
            moduleName: m.moduleName,
            name: m.name,
            signature: m.signature,
            paramCount: m.paramCount,
            returnType: m.returnType || undefined,
            isAsync: m.isAsync,
            lineCount: m.lineCount || undefined,
            statementCount: m.statementCount || undefined,
            maxNestingDepth: m.maxNestingDepth || undefined,
          }));

          const insightModuleDeps = result.moduleLevelDependencies?.map((d) => {
            const srcName = result.modules?.find((m) => m.serviceName === d.sourceService && m.name === d.sourceModule)?.name;
            const tgtName = result.modules?.find((m) => m.serviceName === d.targetService && m.name === d.targetModule)?.name;
            return {
              sourceModule: srcName || d.sourceModule,
              targetModule: tgtName || d.targetModule,
              importedNames: d.importedNames,
            };
          });

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
            modules: insightModules,
            methods: insightMethods,
            moduleDependencies: insightModuleDeps,
            moduleViolations: moduleViolations.map((v) => {
              const moduleKey = v.moduleName ? `${v.serviceName}::${v.moduleName}` : undefined;
              const methodKey = v.methodName && v.moduleName
                ? `${v.serviceName}::${v.moduleName}::${v.methodName}` : undefined;
              return {
                ...v,
                serviceId: serviceIdMap.get(v.serviceName),
                moduleId: moduleKey ? moduleIdMap.get(moduleKey) : undefined,
                methodId: methodKey ? methodIdMap.get(methodKey) : undefined,
              };
            }),
          }, (step) => {
            currentPercent += 3;
            emitAnalysisProgress(id, {
              step: 'insights',
              percent: currentPercent,
              detail: step,
            });
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
              targetModuleId: insight.targetModuleId || null,
              targetMethodId: insight.targetMethodId || null,
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

      if (level === 'modules' || level === 'methods') {
        const analysisLayers = await db
          .select()
          .from(layers)
          .where(eq(layers.analysisId, analysis.id));

        const analysisLayerDeps = await db
          .select()
          .from(layerDependencies)
          .where(eq(layerDependencies.analysisId, analysis.id));

        const analysisModules = await db
          .select()
          .from(modules)
          .where(eq(modules.analysisId, analysis.id));

        const analysisModuleDeps = await db
          .select()
          .from(moduleDeps)
          .where(eq(moduleDeps.analysisId, analysis.id));

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

        if (level === 'methods') {
          const analysisMethods = await db
            .select()
            .from(methods)
            .where(eq(methods.analysisId, analysis.id));

          const analysisMethodDeps = await db
            .select()
            .from(methodDeps)
            .where(eq(methodDeps.analysisId, analysis.id));

          graphData = buildMethodGraphData(
            analysisServices,
            layerData,
            analysisModules,
            analysisMethods,
            analysisModuleDeps,
            analysisDatabases,
            analysisDbConnections,
            analysisLayerDeps,
            analysisMethodDeps,
            analysisDeps,
          );
        } else {
          graphData = buildModuleGraphData(
            analysisServices,
            layerData,
            analysisModules,
            analysisModuleDeps,
            analysisDatabases,
            analysisDbConnections,
            analysisLayerDeps,
            analysisDeps,
          );
        }
      } else if (level === 'layers') {
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
