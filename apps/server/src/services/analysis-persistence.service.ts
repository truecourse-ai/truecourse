import { eq } from 'drizzle-orm';
import { db } from '../config/database.js';
import {
  analyses,
  services,
  serviceDependencies,
  layers,
  databases,
  databaseConnections,
  modules,
  methods,
  moduleDeps,
  methodDeps,
  codeViolations,
} from '../db/schema.js';
import type { AnalysisResult } from './analyzer.service.js';
import type { CodeViolation } from '@truecourse/shared';

export interface PersistAnalysisParams {
  repoId: string;
  branch: string | null;
  result: AnalysisResult;
  metadata?: Record<string, unknown>;
  commitHash?: string;
  /** If provided, update this existing analysis row instead of creating a new one */
  existingAnalysisId?: string;
}

export interface PersistAnalysisOutput {
  analysisId: string;
  serviceIdMap: Map<string, string>;
  moduleIdMap: Map<string, string>;
  methodIdMap: Map<string, string>;
  dbIdMap: Map<string, string>;
}

export async function persistAnalysisResult(params: PersistAnalysisParams): Promise<PersistAnalysisOutput> {
  const { repoId, branch, result, metadata, commitHash, existingAnalysisId } = params;

  let analysis: typeof analyses.$inferSelect;

  if (existingAnalysisId) {
    // Update existing 'running' analysis row to 'completed'
    const [updated] = await db
      .update(analyses)
      .set({
        status: 'completed',
        architecture: result.architecture,
        metadata: metadata ?? result.metadata,
      })
      .where(eq(analyses.id, existingAnalysisId))
      .returning();
    analysis = updated;
  } else {
    // Create new analysis row (for diff analysis and other flows)
    const [created] = await db
      .insert(analyses)
      .values({
        repoId,
        branch: branch || null,
        status: 'completed',
        architecture: result.architecture,
        metadata: metadata ?? result.metadata,
        commitHash: commitHash || null,
      })
      .returning();
    analysis = created;
  }

  // Save services
  const serviceIdMap = new Map<string, string>();
  for (const svc of result.services) {
    const [saved] = await db
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
    serviceIdMap.set(svc.name, saved.id);
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

  // Save databases
  const dbIdMap = new Map<string, string>();
  if (result.databaseResult && result.databaseResult.databases.length > 0) {
    for (const dbInfo of result.databaseResult.databases) {
      const [saved] = await db.insert(databases).values({
        analysisId: analysis.id,
        name: dbInfo.name,
        type: dbInfo.type,
        driver: dbInfo.driver,
        connectionConfig: dbInfo.connectionEnvVar ? { envVar: dbInfo.connectionEnvVar } : null,
        tables: dbInfo.tables,
        dbRelations: dbInfo.relations,
        connectedServices: dbInfo.connectedServices,
      }).returning();
      dbIdMap.set(dbInfo.name, saved.id);
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
  const moduleIdMap = new Map<string, string>();
  if (result.modules && result.modules.length > 0) {
    const savedLayers = await db
      .select()
      .from(layers)
      .where(eq(layers.analysisId, analysis.id));
    const layerIdLookup = new Map<string, string>();
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
      moduleIdMap.set(`${mod.serviceName}::${mod.name}::${mod.filePath}`, saved.id);
    }
  }

  // Save methods
  const methodIdMap = new Map<string, string>();
  if (result.methods && result.methods.length > 0) {
    for (const method of result.methods) {
      const moduleKey = `${method.serviceName}::${method.moduleName}::${method.filePath}`;
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
      methodIdMap.set(`${method.serviceName}::${method.moduleName}::${method.name}::${method.filePath}`, saved.id);
    }
  }

  // Save module dependencies
  if (result.moduleLevelDependencies && result.moduleLevelDependencies.length > 0) {
    for (const dep of result.moduleLevelDependencies) {
      const srcId = moduleIdMap.get(`${dep.sourceService}::${dep.sourceModule}::${dep.sourceFilePath || ''}`);
      const tgtId = moduleIdMap.get(`${dep.targetService}::${dep.targetModule}::${dep.targetFilePath || ''}`);
      if (!srcId || !tgtId) continue;

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
      const srcId = methodIdMap.get(`${dep.callerService}::${dep.callerModule}::${dep.callerMethod}::${dep.callerFilePath || ''}`);
      const tgtId = methodIdMap.get(`${dep.calleeService}::${dep.calleeModule}::${dep.calleeMethod}::${dep.calleeFilePath || ''}`);
      if (!srcId || !tgtId) continue;

      await db.insert(methodDeps).values({
        analysisId: analysis.id,
        sourceMethodId: srcId,
        targetMethodId: tgtId,
        callCount: dep.callCount,
      });
    }
  }

  return { analysisId: analysis.id, serviceIdMap, moduleIdMap, methodIdMap, dbIdMap };
}

/**
 * Persist code-level violations (file/line-level) into the code_violations table.
 */
export async function persistCodeViolations(
  analysisId: string,
  violations: CodeViolation[],
): Promise<void> {
  if (violations.length === 0) return;

  // Bulk insert in batches of 100
  const BATCH_SIZE = 100;
  for (let i = 0; i < violations.length; i += BATCH_SIZE) {
    const batch = violations.slice(i, i + BATCH_SIZE);
    await db.insert(codeViolations).values(
      batch.map((v) => ({
        analysisId,
        filePath: v.filePath,
        lineStart: v.lineStart,
        lineEnd: v.lineEnd,
        columnStart: v.columnStart,
        columnEnd: v.columnEnd,
        ruleKey: v.ruleKey,
        severity: v.severity,
        title: v.title,
        content: v.content,
        snippet: v.snippet,
        fixPrompt: v.fixPrompt || null,
      })),
    );
  }
}
