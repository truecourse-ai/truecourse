import { randomUUID } from 'node:crypto';
import type { AnalysisResult } from './analyzer.service.js';
import type {
  DatabaseConnectionRecord,
  DatabaseRecord,
  Graph,
  LayerRecord,
  MethodDepRecord,
  MethodRecord,
  ModuleDepRecord,
  ModuleRecord,
  ServiceDependencyRecord,
  ServiceRecord,
} from '../types/snapshot.js';

/**
 * Build an in-memory `Graph` from the analyzer's result. Returns the graph
 * plus a set of name-keyed ID maps so downstream stages (violations, flows)
 * can resolve names to IDs when stamping targets.
 *
 * Pure — no DB writes. The orchestrator attaches this graph to the
 * `AnalysisSnapshot` it serializes at the end of a run.
 */
export interface BuildGraphOutput {
  graph: Graph;
  serviceIdMap: Map<string, string>;                       // serviceName → serviceId
  moduleIdMap: Map<string, string>;                        // `${serviceName}::${moduleName}::${filePath}` → moduleId
  methodIdMap: Map<string, string>;                        // `${serviceName}::${moduleName}::${methodName}::${filePath}` → methodId
  dbIdMap: Map<string, string>;                            // databaseName → databaseId
}

export function buildGraph(result: AnalysisResult): BuildGraphOutput {
  const serviceIdMap = new Map<string, string>();
  const services: ServiceRecord[] = [];
  for (const svc of result.services) {
    const id = randomUUID();
    serviceIdMap.set(svc.name, id);
    services.push({
      id,
      name: svc.name,
      rootPath: svc.rootPath,
      type: svc.type,
      framework: svc.framework || null,
      fileCount: svc.fileCount,
      description: null,                   // filled in later by LLM service-description pass
      layerSummary: svc.layers,
    });
  }

  const serviceDependencies: ServiceDependencyRecord[] = [];
  for (const dep of result.dependencies) {
    const sourceId = serviceIdMap.get(dep.source);
    const targetId = serviceIdMap.get(dep.target);
    if (!sourceId || !targetId) continue;
    const depType = dep.httpCalls && dep.httpCalls.length > 0 ? 'http' : 'import';
    const depCount = dep.dependencies.length + (dep.httpCalls?.length || 0);
    serviceDependencies.push({
      id: randomUUID(),
      sourceServiceId: sourceId,
      targetServiceId: targetId,
      dependencyCount: depCount,
      dependencyType: depType,
    });
  }

  const layers: LayerRecord[] = [];
  const layerIdByServiceLayer = new Map<string, string>(); // `${serviceName}::${layer}` → layerId
  if (result.layerDetails) {
    for (const detail of result.layerDetails) {
      const serviceId = serviceIdMap.get(detail.serviceName);
      if (!serviceId) continue;
      const id = randomUUID();
      layerIdByServiceLayer.set(`${detail.serviceName}::${detail.layer}`, id);
      layers.push({
        id,
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

  const databases: DatabaseRecord[] = [];
  const dbIdMap = new Map<string, string>();
  const databaseConnections: DatabaseConnectionRecord[] = [];
  if (result.databaseResult && result.databaseResult.databases.length > 0) {
    for (const dbInfo of result.databaseResult.databases) {
      const id = randomUUID();
      dbIdMap.set(dbInfo.name, id);
      databases.push({
        id,
        name: dbInfo.name,
        type: dbInfo.type,
        driver: dbInfo.driver,
        connectionConfig: dbInfo.connectionEnvVar ? { envVar: dbInfo.connectionEnvVar } : null,
        tables: dbInfo.tables,
        dbRelations: dbInfo.relations,
        connectedServices: dbInfo.connectedServices,
      });
    }

    for (const conn of result.databaseResult.connections) {
      const serviceId = serviceIdMap.get(conn.serviceName);
      const databaseId = dbIdMap.get(conn.databaseName);
      if (!serviceId || !databaseId) continue;
      databaseConnections.push({
        id: randomUUID(),
        serviceId,
        databaseId,
        driver: conn.driver,
      });
    }
  }

  const modules: ModuleRecord[] = [];
  const moduleIdMap = new Map<string, string>();
  if (result.modules && result.modules.length > 0) {
    for (const mod of result.modules) {
      const serviceId = serviceIdMap.get(mod.serviceName);
      const layerId = layerIdByServiceLayer.get(`${mod.serviceName}::${mod.layerName}`);
      if (!serviceId || !layerId) continue;
      const id = randomUUID();
      moduleIdMap.set(`${mod.serviceName}::${mod.name}::${mod.filePath}`, id);
      modules.push({
        id,
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
      });
    }
  }

  const methods: MethodRecord[] = [];
  const methodIdMap = new Map<string, string>();
  if (result.methods && result.methods.length > 0) {
    for (const method of result.methods) {
      const moduleKey = `${method.serviceName}::${method.moduleName}::${method.filePath}`;
      const moduleId = moduleIdMap.get(moduleKey);
      if (!moduleId) continue;
      const id = randomUUID();
      methodIdMap.set(
        `${method.serviceName}::${method.moduleName}::${method.name}::${method.filePath}`,
        id,
      );
      methods.push({
        id,
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
      });
    }
  }

  const moduleDeps: ModuleDepRecord[] = [];
  if (result.moduleLevelDependencies && result.moduleLevelDependencies.length > 0) {
    for (const dep of result.moduleLevelDependencies) {
      const srcId = moduleIdMap.get(
        `${dep.sourceService}::${dep.sourceModule}::${dep.sourceFilePath || ''}`,
      );
      const tgtId = moduleIdMap.get(
        `${dep.targetService}::${dep.targetModule}::${dep.targetFilePath || ''}`,
      );
      if (!srcId || !tgtId) continue;
      moduleDeps.push({
        id: randomUUID(),
        sourceModuleId: srcId,
        targetModuleId: tgtId,
        importedNames: dep.importedNames,
        dependencyCount: dep.importedNames.length || 1,
      });
    }
  }

  const methodDeps: MethodDepRecord[] = [];
  if (result.methodLevelDependencies && result.methodLevelDependencies.length > 0) {
    for (const dep of result.methodLevelDependencies) {
      const srcId = methodIdMap.get(
        `${dep.callerService}::${dep.callerModule}::${dep.callerMethod}::${dep.callerFilePath || ''}`,
      );
      const tgtId = methodIdMap.get(
        `${dep.calleeService}::${dep.calleeModule}::${dep.calleeMethod}::${dep.calleeFilePath || ''}`,
      );
      if (!srcId || !tgtId) continue;
      methodDeps.push({
        id: randomUUID(),
        sourceMethodId: srcId,
        targetMethodId: tgtId,
        callCount: dep.callCount,
      });
    }
  }

  const graph: Graph = {
    services,
    serviceDependencies,
    layers,
    modules,
    methods,
    moduleDeps,
    methodDeps,
    databases,
    databaseConnections,
    flows: [], // filled in by detectFlows() in the orchestrator
  };

  return { graph, serviceIdMap, moduleIdMap, methodIdMap, dbIdMap };
}
