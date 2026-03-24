import dagre from 'dagre';

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface GraphNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: {
    label: string;
    description?: string;
    serviceType: string;
    framework?: string;
    fileCount: number;
    layers: string[];
    rootPath: string;
  };
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  data: {
    dependencyCount: number;
    dependencyType?: string;
  };
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// ---------------------------------------------------------------------------
// Row types (match DB query result shapes)
// ---------------------------------------------------------------------------

export type GraphLevel = 'service' | 'module' | 'method';

export interface ServiceRow {
  id: string;
  name: string;
  type: string;
  framework: string | null;
  fileCount: number | null;
  description: string | null;
  layerSummary: unknown;
  rootPath: string;
}

export interface DepRow {
  id: string;
  sourceServiceId: string;
  targetServiceId: string;
  dependencyCount: number | null;
  dependencyType: string | null;
}

export interface LayerRow {
  id: string;
  serviceName: string;
  serviceId: string;
  layer: string;
  fileCount: number;
  filePaths: string[];
  confidence: number;
  evidence: string[];
}

export interface ModuleRow {
  id: string;
  layerId: string;
  serviceId: string;
  name: string;
  kind: string;
  filePath: string;
  methodCount: number;
  propertyCount: number;
  importCount: number;
  exportCount: number;
  superClass: string | null;
  lineCount: number | null;
}

export interface MethodRow {
  id: string;
  moduleId: string;
  name: string;
  signature: string;
  paramCount: number;
  returnType: string | null;
  isAsync: boolean;
  isExported: boolean;
  lineCount: number | null;
  statementCount: number | null;
  maxNestingDepth: number | null;
}

export interface ModuleDepRow {
  id: string;
  sourceModuleId: string;
  targetModuleId: string;
  importedNames: unknown;
  dependencyCount: number;
}

export interface MethodDepRow {
  id: string;
  sourceMethodId: string;
  targetMethodId: string;
  callCount: number;
}

export interface DbRow {
  id: string;
  name: string;
  type: string;
  driver: string;
  tables: unknown;
  connectedServices: unknown;
}

export interface DbConnRow {
  id: string;
  serviceId: string;
  databaseId: string;
  driver: string;
}

export interface DetViolationRow {
  id: string;
  ruleKey: string;
  category: string;
  title: string;
  severity: string;
  serviceName: string;
  moduleName: string | null;
  relatedModuleName: string | null;
  relatedServiceName: string | null;
  isDependencyViolation: boolean;
}

export interface UnifiedInput {
  services: ServiceRow[];
  serviceDeps: DepRow[];
  layers: LayerRow[];
  modules: ModuleRow[];
  moduleDeps: ModuleDepRow[];
  methods: MethodRow[];
  methodDeps: MethodDepRow[];
  databases: DbRow[];
  dbConnections: DbConnRow[];
  deterministicViolations?: DetViolationRow[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LAYER_ORDER: Record<string, number> = { api: 0, service: 1, data: 2, external: 3 };
const LAYER_COLORS: Record<string, string> = {
  api: '#3b82f6',
  service: '#8b5cf6',
  data: '#10b981',
  external: '#f97316',
};

const SERVICE_RANK: Record<string, number> = {
  frontend: 0, 'api-server': 1, worker: 2, library: 3, unknown: 2,
};

// Layout constants
const MODULE_NODE_WIDTH = 264;
const MODULE_NODE_HEIGHT = 50;
const MODULE_GAP = 16;
const MAX_PER_COL = 5;
const MOD_COL_GAP = 16;

const METHOD_NODE_WIDTH = 204;
const METHOD_NODE_HEIGHT = 32;
const METHOD_GAP = 8;
const METHOD_COL_GAP = 8;
const MOD_PAD_X = 8;
const MIN_MODULE_WIDTH = 180;

const LAYER_PAD_TOP = 36;
const LAYER_PAD_BOTTOM = 16;
const LAYER_PAD_X = 16;
const LAYER_GAP = 24;

const SVC_PAD_TOP = 50;
const SVC_PAD_BOTTOM = 20;
const SVC_PAD_X = 20;

// ---------------------------------------------------------------------------
// The unified builder
// ---------------------------------------------------------------------------

export function buildUnifiedGraph(level: GraphLevel, input: UnifiedInput): GraphData {
  const {
    services, serviceDeps, layers, modules, moduleDeps,
    methods, methodDeps, databases, dbConnections,
  } = input;

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  // ── Lookups ──────────────────────────────────────────────────────────
  const layersByService = groupBy(layers, (l) => l.serviceId);
  const modulesByLayer = groupBy(modules, (m) => m.layerId);
  const methodsByModule = groupBy(methods, (m) => m.moduleId);
  const layerById = new Map(layers.map((l) => [l.id, l]));
  const moduleById = new Map(modules.map((m) => [m.id, m]));
  const serviceById = new Map(services.map((s) => [s.id, s]));

  // ── Compute hierarchy dimensions (bottom-up) ────────────────────────
  const serviceDimensions = new Map<string, { width: number; height: number }>();

  if (level === 'service') {
    // Flat service nodes
    for (const svc of services) {
      serviceDimensions.set(svc.id, { width: 280, height: 120 });
    }
  } else {
    // Services contain layers, layers contain modules, modules may contain methods
    for (const svc of services) {
      const svcLayers = (layersByService.get(svc.id) || [])
        .sort((a, b) => (LAYER_ORDER[a.layer] ?? 99) - (LAYER_ORDER[b.layer] ?? 99));

      let maxLayerWidth = 0;
      let totalLayerHeight = 0;

      for (const layer of svcLayers) {
        const layerModules = modulesByLayer.get(layer.id) || [];
        const { width: layerContentW, height: layerContentH } = computeLayerContentSize(
          level, layerModules, methodsByModule,
        );

        const layerWidth = LAYER_PAD_X * 2 + layerContentW;
        const layerHeight = LAYER_PAD_TOP + layerContentH + LAYER_PAD_BOTTOM;

        if (layerWidth > maxLayerWidth) maxLayerWidth = layerWidth;
        totalLayerHeight += layerHeight;
      }

      if (svcLayers.length > 1) totalLayerHeight += (svcLayers.length - 1) * LAYER_GAP;

      const svcWidth = SVC_PAD_X * 2 + Math.max(maxLayerWidth, 200);
      const svcHeight = SVC_PAD_TOP + totalLayerHeight + SVC_PAD_BOTTOM;
      serviceDimensions.set(svc.id, { width: svcWidth, height: svcHeight });
    }
  }

  // ── Dagre layout for service positions ───────────────────────────────
  const outerLayout = computeDagreLayout(services, serviceDeps, serviceDimensions, databases, dbConnections);

  // ── Build nodes ──────────────────────────────────────────────────────
  for (const svc of services) {
    const svcPos = outerLayout.servicePositions.get(svc.id)!;
    const svcDim = serviceDimensions.get(svc.id)!;
    const svcLayers = (layersByService.get(svc.id) || [])
      .sort((a, b) => (LAYER_ORDER[a.layer] ?? 99) - (LAYER_ORDER[b.layer] ?? 99));

    if (level === 'service') {
      // Flat service node
      nodes.push({
        id: svc.id,
        type: 'serviceNode',
        position: svcPos,
        data: {
          label: svc.name,
          description: svc.description || undefined,
          serviceType: svc.type,
          framework: svc.framework || undefined,
          fileCount: svc.fileCount || 0,
          layers: svcLayers.map((l) => l.layer),
          rootPath: svc.rootPath,
        },
      });
    } else {
      // Service group node (container)
      nodes.push({
        id: svc.id,
        type: 'serviceGroupNode',
        position: svcPos,
        data: {
          label: svc.name,
          serviceType: svc.type,
          framework: svc.framework || undefined,
          fileCount: svc.fileCount || 0,
          layers: svcLayers.map((l) => l.layer),
          rootPath: svc.rootPath,
        },
        style: { width: svcDim.width, height: svcDim.height },
      } as GraphNode);

      // Layer + module + method nodes
      let layerY = SVC_PAD_TOP;
      for (const layer of svcLayers) {
        const layerModules = (modulesByLayer.get(layer.id) || []);
        const { width: contentW, height: contentH } = computeLayerContentSize(
          level, layerModules, methodsByModule,
        );
        const layerWidth = svcDim.width - SVC_PAD_X * 2;
        const layerHeight = LAYER_PAD_TOP + contentH + LAYER_PAD_BOTTOM;

        // Layer container node (use composite ID for React Flow nesting)
        const layerNodeId = `${svc.id}__${layer.layer}`;
        nodes.push({
          id: layerNodeId,
          type: 'layerNode',
          position: { x: SVC_PAD_X, y: layerY },
          parentId: svc.id,
          extent: 'parent',
          data: {
            label: layer.layer,
            serviceType: svc.type,
            fileCount: layer.fileCount,
            layers: [layer.layer],
            rootPath: svc.rootPath,
            layerColor: LAYER_COLORS[layer.layer] || '#6b7280',
            isContainer: true,
          },
          style: { width: layerWidth, height: layerHeight },
        } as GraphNode);

        if (level === 'module' || level === 'method') {
          // Place modules in a grid within the layer
          placeModulesInGrid(
            nodes, level, layerModules, methodsByModule, layerNodeId, layer, svc, layerWidth,
          );
        }

        layerY += layerHeight + LAYER_GAP;
      }
    }
  }

  // ── Build edges ──────────────────────────────────────────────────────
  if (level === 'service') {
    for (const dep of serviceDeps) {
      edges.push({
        id: dep.id,
        source: dep.sourceServiceId,
        target: dep.targetServiceId,
        label: dep.dependencyCount ? `${dep.dependencyCount}` : undefined,
        data: {
          dependencyCount: dep.dependencyCount || 0,
          dependencyType: dep.dependencyType || undefined,
        },
        ...({ sourceHandle: 'bottom', targetHandle: 'top' } as Record<string, unknown>),
      });
    }
  } else if (level === 'module') {
    // Module dependency edges
    for (const dep of moduleDeps) {
      const srcMod = moduleById.get(dep.sourceModuleId);
      const tgtMod = moduleById.get(dep.targetModuleId);
      if (!srcMod || !tgtMod) continue;
      const isSameService = srcMod.serviceId === tgtMod.serviceId;
      edges.push({
        id: dep.id,
        source: dep.sourceModuleId,
        target: dep.targetModuleId,
        label: dep.dependencyCount > 1 ? String(dep.dependencyCount) : undefined,
        data: {
          dependencyCount: dep.dependencyCount,
          dependencyType: 'module-dep',
        },
        ...(isSameService
          ? { sourceHandle: 'right-src', targetHandle: 'right-tgt' }
          : { sourceHandle: 'bottom', targetHandle: 'top' }) as Record<string, unknown>,
      });
    }
    // HTTP service dep fallback edges
    addHttpFallbackEdges(edges, serviceDeps, modules, layers, moduleById);
  } else if (level === 'method') {
    // Method dependency edges
    const methodModuleMap = new Map<string, ModuleRow>();
    for (const m of methods) {
      const mod = moduleById.get(m.moduleId);
      if (mod) methodModuleMap.set(m.id, mod);
    }
    for (const dep of methodDeps) {
      const srcMod = methodModuleMap.get(dep.sourceMethodId);
      const tgtMod = methodModuleMap.get(dep.targetMethodId);
      if (!srcMod || !tgtMod) continue;
      const isSameService = srcMod.serviceId === tgtMod.serviceId;
      edges.push({
        id: dep.id,
        source: dep.sourceMethodId,
        target: dep.targetMethodId,
        label: dep.callCount > 1 ? String(dep.callCount) : undefined,
        data: {
          dependencyCount: dep.callCount,
          dependencyType: 'method-dep',
        },
        ...(isSameService
          ? { sourceHandle: 'right-src', targetHandle: 'right-tgt' }
          : { sourceHandle: 'bottom', targetHandle: 'top' }) as Record<string, unknown>,
      });
    }
    // Module-level fallback edges (where no method edges exist between modules)
    addModuleFallbackEdges(edges, moduleDeps, methods, methodDeps, moduleById);
    // HTTP service dep fallback edges
    addHttpFallbackEdges(edges, serviceDeps, modules, layers, moduleById);
  }

  // ── Database nodes ───────────────────────────────────────────────────
  addDatabaseNodes(
    nodes, edges, outerLayout.databasePositions, databases, dbConnections,
    level !== 'service' ? modules : undefined,
    level !== 'service' ? layers : undefined,
  );

  // ── Dead marking ─────────────────────────────────────────────────────
  if (level === 'module' || level === 'method') {
    markDeadModules(nodes, modules, moduleDeps, layers, databases, dbConnections);
  }
  if (level === 'method') {
    markDeadMethods(nodes, methodDeps);
  }

  // ── Violation marking on edges ───────────────────────────────────────
  if (input.deterministicViolations && input.deterministicViolations.length > 0) {
    markDependencyViolations(edges, modules, input.deterministicViolations);
  }

  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }
  return map;
}

function computeLayerContentSize(
  level: GraphLevel,
  layerModules: ModuleRow[],
  methodsByModule: Map<string, MethodRow[]>,
): { width: number; height: number } {
  if (layerModules.length === 0) return { width: 100, height: 0 };

  if (level === 'module') {
    // Modules in a grid (MAX_PER_COL per column)
    const cols = Math.max(Math.ceil(layerModules.length / MAX_PER_COL), 1);
    const rows = Math.min(layerModules.length, MAX_PER_COL);
    const width = cols * MODULE_NODE_WIDTH + (cols - 1) * MOD_COL_GAP;
    const height = rows * MODULE_NODE_HEIGHT + (rows - 1) * MODULE_GAP;
    return { width, height };
  }

  // Method level: modules sized by their method count
  let maxModWidth = 0;
  const moduleHeights: number[] = [];

  for (const mod of layerModules) {
    const mths = methodsByModule.get(mod.id) || [];
    const mthCount = mths.length || 1;
    const mthCols = Math.max(Math.ceil(mthCount / MAX_PER_COL), 1);
    const mthRows = Math.min(mthCount, MAX_PER_COL);
    const methodColWidth = METHOD_NODE_WIDTH;
    const modWidth = Math.max(
      MOD_PAD_X * 2 + mthCols * methodColWidth + (mthCols - 1) * METHOD_COL_GAP,
      MIN_MODULE_WIDTH,
    );
    const modHeight = MODULE_NODE_HEIGHT + mthRows * METHOD_NODE_HEIGHT + (mthRows - 1) * METHOD_GAP + 8;

    if (modWidth > maxModWidth) maxModWidth = modWidth;
    moduleHeights.push(modHeight);
  }

  const cols = Math.max(Math.ceil(layerModules.length / MAX_PER_COL), 1);
  const width = cols * maxModWidth + (cols - 1) * MOD_COL_GAP;

  // Height = max column height
  let maxColHeight = 0;
  for (let col = 0; col < cols; col++) {
    let colH = 0;
    for (let row = 0; row < MAX_PER_COL; row++) {
      const idx = col * MAX_PER_COL + row;
      if (idx >= moduleHeights.length) break;
      colH += moduleHeights[idx] + (row > 0 ? MODULE_GAP : 0);
    }
    if (colH > maxColHeight) maxColHeight = colH;
  }

  return { width, height: maxColHeight };
}

function placeModulesInGrid(
  nodes: GraphNode[],
  level: GraphLevel,
  layerModules: ModuleRow[],
  methodsByModule: Map<string, MethodRow[]>,
  layerNodeId: string,
  layer: LayerRow,
  svc: ServiceRow,
  layerWidth: number,
) {
  const cols = Math.max(Math.ceil(layerModules.length / MAX_PER_COL), 1);

  for (let i = 0; i < layerModules.length; i++) {
    const mod = layerModules[i];
    const col = Math.floor(i / MAX_PER_COL);
    const row = i % MAX_PER_COL;

    if (level === 'module') {
      const x = LAYER_PAD_X + col * (MODULE_NODE_WIDTH + MOD_COL_GAP);
      const y = LAYER_PAD_TOP + row * (MODULE_NODE_HEIGHT + MODULE_GAP);
      nodes.push({
        id: mod.id,
        type: 'moduleNode',
        position: { x, y },
        parentId: layerNodeId,
        extent: 'parent',
        data: {
          label: mod.name,
          serviceType: mod.kind,
          fileCount: mod.methodCount,
          layers: [layer.layer],
          rootPath: mod.filePath,
          moduleKind: mod.kind,
          methodCount: mod.methodCount,
          propertyCount: mod.propertyCount,
          importCount: mod.importCount,
          exportCount: mod.exportCount,
          superClass: mod.superClass,
          layerColor: LAYER_COLORS[layer.layer] || '#6b7280',
        },
        style: { width: MODULE_NODE_WIDTH },
      } as GraphNode);
    } else {
      // Method level: module is a container for methods
      const mths = methodsByModule.get(mod.id) || [];
      const mthCount = mths.length || 1;
      const mthCols = Math.max(Math.ceil(mthCount / MAX_PER_COL), 1);
      const mthRows = Math.min(mthCount, MAX_PER_COL);
      const methodColWidth = METHOD_NODE_WIDTH;
      const modWidth = Math.max(
        MOD_PAD_X * 2 + mthCols * methodColWidth + (mthCols - 1) * METHOD_COL_GAP,
        MIN_MODULE_WIDTH,
      );
      const modHeight = MODULE_NODE_HEIGHT + mthRows * METHOD_NODE_HEIGHT + (mthRows - 1) * METHOD_GAP + 8;

      // Calculate cumulative Y offset for this row
      let yOffset = LAYER_PAD_TOP;
      for (let r = 0; r < row; r++) {
        const prevMod = layerModules[col * MAX_PER_COL + r];
        if (!prevMod) break;
        const prevMths = methodsByModule.get(prevMod.id) || [];
        const prevCount = prevMths.length || 1;
        const prevRows = Math.min(prevCount, MAX_PER_COL);
        yOffset += MODULE_NODE_HEIGHT + prevRows * METHOD_NODE_HEIGHT + (prevRows - 1) * METHOD_GAP + 8 + MODULE_GAP;
      }

      const x = LAYER_PAD_X + col * (modWidth + MOD_COL_GAP);

      nodes.push({
        id: mod.id,
        type: 'moduleNode',
        position: { x, y: yOffset },
        parentId: layerNodeId,
        extent: 'parent',
        data: {
          label: mod.name,
          serviceType: mod.kind,
          fileCount: mod.methodCount,
          layers: [layer.layer],
          rootPath: mod.filePath,
          moduleKind: mod.kind,
          methodCount: mod.methodCount,
          layerColor: LAYER_COLORS[layer.layer] || '#6b7280',
          isContainer: true,
        },
        style: { width: modWidth, height: modHeight },
      } as GraphNode);

      // Place methods within module
      for (let mi = 0; mi < mths.length; mi++) {
        const mth = mths[mi];
        const mthCol = Math.floor(mi / MAX_PER_COL);
        const mthRow = mi % MAX_PER_COL;
        const mthX = MOD_PAD_X + mthCol * (methodColWidth + METHOD_COL_GAP);
        const mthY = MODULE_NODE_HEIGHT + mthRow * (METHOD_NODE_HEIGHT + METHOD_GAP);

        nodes.push({
          id: mth.id,
          type: 'methodNode',
          position: { x: mthX, y: mthY },
          parentId: mod.id,
          extent: 'parent',
          data: {
            label: mth.name,
            serviceType: 'method',
            fileCount: 0,
            layers: [],
            rootPath: mod.filePath,
            description: mth.signature,
            signature: mth.signature,
            paramCount: mth.paramCount,
            returnType: mth.returnType,
            isAsync: mth.isAsync,
            isExported: mth.isExported,
            lineCount: mth.lineCount,
            statementCount: mth.statementCount,
            maxNestingDepth: mth.maxNestingDepth,
          },
          style: { width: methodColWidth },
        } as GraphNode);
      }
    }
  }
}

function computeDagreLayout(
  services: ServiceRow[],
  serviceDeps: DepRow[],
  dimensions: Map<string, { width: number; height: number }>,
  databases: DbRow[],
  dbConnections: DbConnRow[],
) {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'TB', nodesep: 150, ranksep: 200, marginx: 60, marginy: 60 });
  g.setDefaultEdgeLabel(() => ({}));

  const sorted = [...services].sort((a, b) => (SERVICE_RANK[a.type] || 2) - (SERVICE_RANK[b.type] || 2));
  for (const svc of sorted) {
    const dim = dimensions.get(svc.id) || { width: 280, height: 120 };
    g.setNode(svc.id, { width: dim.width, height: dim.height, rank: SERVICE_RANK[svc.type] || 2 });
  }
  for (const dep of serviceDeps) {
    g.setEdge(dep.sourceServiceId, dep.targetServiceId);
  }
  for (const db of databases) {
    g.setNode(db.id, { width: 200, height: 80, rank: 4 });
  }
  for (const conn of dbConnections) {
    g.setEdge(conn.serviceId, conn.databaseId);
  }
  dagre.layout(g);

  const servicePositions = new Map<string, { x: number; y: number }>();
  for (const svc of services) {
    const pos = g.node(svc.id);
    const dim = dimensions.get(svc.id)!;
    servicePositions.set(svc.id, { x: pos.x - dim.width / 2, y: pos.y - dim.height / 2 });
  }
  const databasePositions = new Map<string, { x: number; y: number }>();
  for (const db of databases) {
    const pos = g.node(db.id);
    databasePositions.set(db.id, { x: pos.x - 100, y: pos.y - 40 });
  }
  return { servicePositions, databasePositions };
}

function addDatabaseNodes(
  nodes: GraphNode[],
  edges: GraphEdge[],
  positions: Map<string, { x: number; y: number }>,
  databases: DbRow[],
  connections: DbConnRow[],
  modules?: ModuleRow[],
  layers?: LayerRow[],
) {
  for (const db of databases) {
    const pos = positions.get(db.id);
    if (!pos) continue;
    nodes.push({
      id: db.id,
      type: 'databaseNode',
      position: pos,
      data: {
        label: db.name,
        serviceType: db.type,
        fileCount: 0,
        tableCount: Array.isArray(db.tables) ? db.tables.length : 0,
        layers: [],
        rootPath: '',
        dbType: db.type,
        driver: db.driver,
      },
    } as GraphNode);
  }
  for (const conn of connections) {
    let targetId = conn.serviceId; // default: connect to service
    if (modules && layers) {
      // Find data-layer module to connect to
      const dataLayer = layers.find((l) => l.serviceId === conn.serviceId && l.layer === 'data');
      if (dataLayer) {
        const dataModules = modules.filter((m) => m.layerId === dataLayer.id);
        if (dataModules.length > 0) {
          // Match by driver/db name similarity
          const driverLower = conn.driver.toLowerCase();
          const db = databases.find((d) => d.id === conn.databaseId);
          const dbName = db?.name.toLowerCase() || '';
          const matched = dataModules.find((m) => {
            const name = m.name.toLowerCase();
            return name.includes(driverLower) || name.includes(dbName) ||
              driverLower.includes(name) || dbName.includes(name);
          });
          targetId = matched?.id || dataModules[0].id;
        }
      }
    }
    edges.push({
      id: `db-conn-${conn.id}`,
      source: targetId,
      target: conn.databaseId,
      data: { dependencyCount: 1, dependencyType: 'database' },
      ...({ sourceHandle: 'bottom', targetHandle: 'top' } as Record<string, unknown>),
    });
  }
}

function addHttpFallbackEdges(
  edges: GraphEdge[],
  serviceDeps: DepRow[],
  modules: ModuleRow[],
  layers: LayerRow[],
  moduleById: Map<string, ModuleRow>,
) {
  const existingPairs = new Set(edges.map((e) => `${e.source}::${e.target}`));
  const layerById = new Map(layers.map((l) => [l.id, l]));

  for (const dep of serviceDeps) {
    if (dep.dependencyType !== 'http') continue;
    // Find source module (prefer external/service layer)
    const srcModules = modules.filter((m) => m.serviceId === dep.sourceServiceId);
    const srcMod = srcModules.find((m) => {
      const l = layerById.get(m.layerId);
      return l && (l.layer === 'external' || l.layer === 'service');
    }) || srcModules[0];
    // Find target module (prefer api layer)
    const tgtModules = modules.filter((m) => m.serviceId === dep.targetServiceId);
    const tgtMod = tgtModules.find((m) => {
      const l = layerById.get(m.layerId);
      return l && l.layer === 'api';
    }) || tgtModules[0];
    if (!srcMod || !tgtMod) continue;
    const pair = `${srcMod.id}::${tgtMod.id}`;
    if (existingPairs.has(pair)) continue;
    existingPairs.add(pair);
    edges.push({
      id: `http-${dep.id}`,
      source: srcMod.id,
      target: tgtMod.id,
      data: { dependencyCount: dep.dependencyCount || 0, dependencyType: 'http' },
      ...({ sourceHandle: 'bottom', targetHandle: 'top' } as Record<string, unknown>),
    });
  }
}

function addModuleFallbackEdges(
  edges: GraphEdge[],
  moduleDeps: ModuleDepRow[],
  methods: MethodRow[],
  methodDeps: MethodDepRow[],
  moduleById: Map<string, ModuleRow>,
) {
  // Find module pairs that already have method-level edges
  const methodToModule = new Map<string, string>();
  for (const m of methods) methodToModule.set(m.id, m.moduleId);

  const modulePairsWithMethodEdges = new Set<string>();
  for (const dep of methodDeps) {
    const srcMod = methodToModule.get(dep.sourceMethodId);
    const tgtMod = methodToModule.get(dep.targetMethodId);
    if (srcMod && tgtMod && srcMod !== tgtMod) {
      modulePairsWithMethodEdges.add(`${srcMod}::${tgtMod}`);
    }
  }

  for (const dep of moduleDeps) {
    const pair = `${dep.sourceModuleId}::${dep.targetModuleId}`;
    if (modulePairsWithMethodEdges.has(pair)) continue;
    const srcMod = moduleById.get(dep.sourceModuleId);
    const tgtMod = moduleById.get(dep.targetModuleId);
    if (!srcMod || !tgtMod) continue;
    const isSameService = srcMod.serviceId === tgtMod.serviceId;
    edges.push({
      id: `mod-${dep.id}`,
      source: dep.sourceModuleId,
      target: dep.targetModuleId,
      label: dep.dependencyCount > 1 ? String(dep.dependencyCount) : undefined,
      data: { dependencyCount: dep.dependencyCount, dependencyType: 'module-dep' },
      ...(isSameService
        ? { sourceHandle: 'right-src', targetHandle: 'right-tgt' }
        : { sourceHandle: 'bottom', targetHandle: 'top' }) as Record<string, unknown>,
    });
  }
}

function markDeadModules(
  nodes: GraphNode[],
  modules: ModuleRow[],
  moduleDeps: ModuleDepRow[],
  layers: LayerRow[],
  databases: DbRow[],
  dbConnections: DbConnRow[],
) {
  const connectedIds = new Set<string>();
  for (const dep of moduleDeps) {
    connectedIds.add(dep.sourceModuleId);
    connectedIds.add(dep.targetModuleId);
  }
  // DB-connected data modules are alive
  const dbConnectedServices = new Set(dbConnections.map((c) => c.serviceId));
  const dataLayerIds = new Set(layers.filter((l) => l.layer === 'data').map((l) => l.id));
  for (const mod of modules) {
    if (dataLayerIds.has(mod.layerId) && dbConnectedServices.has(mod.serviceId)) {
      connectedIds.add(mod.id);
    }
  }
  // Entry point files are alive — files that import others but are never imported themselves
  // (framework entry files like page.tsx, layout.tsx, scripts, CLI entry points, etc.)
  const importedFiles = new Set<string>();
  for (const dep of moduleDeps) {
    const targetMod = modules.find((m) => m.id === dep.targetModuleId);
    if (targetMod) importedFiles.add(targetMod.filePath);
  }
  for (const mod of modules) {
    if (!importedFiles.has(mod.filePath)) connectedIds.add(mod.id);
  }

  for (const node of nodes) {
    if (node.type === 'moduleNode' && !connectedIds.has(node.id)) {
      (node.data as Record<string, unknown>).isDead = true;
    }
  }
}

function markDeadMethods(nodes: GraphNode[], methodDeps: MethodDepRow[]) {
  const connectedIds = new Set<string>();
  for (const dep of methodDeps) {
    connectedIds.add(dep.sourceMethodId);
    connectedIds.add(dep.targetMethodId);
  }
  for (const node of nodes) {
    if (node.type === 'methodNode' && !connectedIds.has(node.id)) {
      (node.data as Record<string, unknown>).isDead = true;
    }
  }
}

function markDependencyViolations(
  edges: GraphEdge[],
  modules: ModuleRow[],
  detViolations: DetViolationRow[],
) {
  const depViolations = detViolations.filter((v) => v.isDependencyViolation);
  if (depViolations.length === 0) return;

  // Build module name → id lookup
  const moduleNameToId = new Map<string, string>();
  for (const mod of modules) {
    moduleNameToId.set(mod.name, mod.id);
  }

  for (const v of depViolations) {
    const sourceId = v.moduleName ? moduleNameToId.get(v.moduleName) : null;
    const targetId = v.relatedModuleName ? moduleNameToId.get(v.relatedModuleName) : null;

    if (!sourceId || !targetId) continue;

    // Find edges between source and target module (in either direction)
    for (const edge of edges) {
      if ((edge.source === sourceId && edge.target === targetId) ||
          (edge.source === targetId && edge.target === sourceId)) {
        const data = edge.data as Record<string, unknown>;
        data.isViolation = true;
        data.violationReason = v.title;
      }
    }
  }
}

