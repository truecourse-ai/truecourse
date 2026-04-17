/**
 * TypeScript shapes for the file-based analysis store.
 *
 *   analyses/<iso>_<short-uuid>.json  → AnalysisSnapshot  (per-analysis file)
 *   LATEST.json                        → LatestSnapshot    (materialized current state)
 *   history.json                       → History           (summaries for cross-analysis queries)
 *   diff.json                          → DiffSnapshot      (active diff against LATEST)
 *
 * Fields mirror the legacy DB rows (`apps/server/src/db/schema.ts`) verbatim so
 * the migration is a straight projection — no renaming, no shape surprises.
 * UUIDs stay strings, timestamps are ISO-8601 strings.
 */

// ---------------------------------------------------------------------------
// Graph records (regenerated every analyze)
// ---------------------------------------------------------------------------

export interface ServiceRecord {
  id: string;
  name: string;
  rootPath: string;
  type: string;                         // ServiceType enum in packages/shared
  framework: string | null;
  fileCount: number | null;
  description: string | null;
  layerSummary: unknown | null;         // jsonb blob
}

export interface ServiceDependencyRecord {
  id: string;
  sourceServiceId: string;
  targetServiceId: string;
  dependencyCount: number | null;
  dependencyType: string | null;
}

export interface LayerRecord {
  id: string;
  serviceId: string;
  serviceName: string;
  layer: 'data' | 'api' | 'service' | 'external';
  fileCount: number;
  filePaths: string[];
  confidence: number;                   // 0-100
  evidence: string[];
}

export interface ModuleRecord {
  id: string;
  layerId: string;
  serviceId: string;
  name: string;
  kind: 'class' | 'interface' | 'standalone';
  filePath: string;
  methodCount: number;
  propertyCount: number;
  importCount: number;
  exportCount: number;
  superClass: string | null;
  lineCount: number | null;
}

export interface MethodRecord {
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

export interface ModuleDepRecord {
  id: string;
  sourceModuleId: string;
  targetModuleId: string;
  importedNames: string[];
  dependencyCount: number;
}

export interface MethodDepRecord {
  id: string;
  sourceMethodId: string;
  targetMethodId: string;
  callCount: number;
}

export interface DatabaseRecord {
  id: string;
  name: string;
  type: 'postgres' | 'redis' | 'mongodb' | 'mysql' | 'sqlite';
  driver: string;
  connectionConfig: unknown | null;     // jsonb blob
  tables: unknown | null;               // TableInfo[] jsonb blob
  dbRelations: unknown | null;          // RelationInfo[] jsonb blob
  connectedServices: string[] | null;
}

export interface DatabaseConnectionRecord {
  id: string;
  serviceId: string;
  databaseId: string;
  driver: string;
}

export interface FlowStepRecord {
  stepOrder: number;
  sourceService: string;
  sourceModule: string;
  sourceMethod: string;
  targetService: string;
  targetModule: string;
  targetMethod: string;
  stepType: 'call' | 'http' | 'db-read' | 'db-write' | 'event';
  dataDescription: string | null;
  isAsync: boolean;
  isConditional: boolean;
}

export interface FlowRecord {
  id: string;
  name: string;
  description: string | null;
  entryService: string;
  entryMethod: string;
  category: string;
  trigger: 'http' | 'event' | 'cron' | 'startup';
  stepCount: number;
  steps: FlowStepRecord[];              // nested — no separate flow_steps table
}

export interface Graph {
  services: ServiceRecord[];
  serviceDependencies: ServiceDependencyRecord[];
  layers: LayerRecord[];
  modules: ModuleRecord[];
  methods: MethodRecord[];
  moduleDeps: ModuleDepRecord[];
  methodDeps: MethodDepRecord[];
  databases: DatabaseRecord[];
  databaseConnections: DatabaseConnectionRecord[];
  flows: FlowRecord[];
}

// ---------------------------------------------------------------------------
// Violations
// ---------------------------------------------------------------------------

export type ViolationSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';
export type ViolationStatus = 'new' | 'unchanged' | 'resolved';

/**
 * One stored violation. Matches the `violations` pgTable fields; nullable
 * columns become `| null` here. Target IDs reference records in the same
 * snapshot's graph. Code-violation fields (filePath, lineStart, …) are
 * only set when `type === 'code'` or architecture-from-file.
 */
export interface ViolationRecord {
  id: string;
  type: string;                         // ViolationType enum
  title: string;
  content: string;
  severity: ViolationSeverity;
  status: ViolationStatus;
  targetServiceId: string | null;
  targetDatabaseId: string | null;
  targetModuleId: string | null;
  targetMethodId: string | null;
  targetTable: string | null;
  relatedServiceId: string | null;
  relatedModuleId: string | null;
  fixPrompt: string | null;
  ruleKey: string;
  firstSeenAnalysisId: string | null;
  firstSeenAt: string | null;           // ISO-8601
  previousViolationId: string | null;
  resolvedAt: string | null;            // ISO-8601
  filePath: string | null;
  lineStart: number | null;
  lineEnd: number | null;
  columnStart: number | null;
  columnEnd: number | null;
  snippet: string | null;
  createdAt: string;                    // ISO-8601
}

/**
 * Violation entry as it appears in `LATEST.violations[]` and `diff.json.newViolations[]`.
 * Same as `ViolationRecord` plus the denormalized target names so read endpoints
 * don't have to resolve IDs against the graph.
 */
export interface ViolationWithNames extends ViolationRecord {
  targetServiceName: string | null;
  targetModuleName: string | null;
  targetMethodName: string | null;
  targetDatabaseName: string | null;
}

export interface ResolvedViolationRef {
  id: string;
  resolvedAt: string;                   // ISO-8601
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

export interface UsageRecord {
  provider: string;
  callType: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  costUsd: string | null;               // string for precision, like the DB
  durationMs: number;
  createdAt: string;                    // ISO-8601
}

// ---------------------------------------------------------------------------
// Top-level file shapes
// ---------------------------------------------------------------------------

/**
 * Per-analysis snapshot file. One written per normal analyze run.
 * Violations are stored as a delta (`added` + `resolved` refs) to keep
 * file size down when unchanged across runs; `LATEST.json` has the
 * materialized active set.
 */
export interface AnalysisSnapshot {
  id: string;
  createdAt: string;                    // ISO-8601
  branch: string | null;
  commitHash: string | null;
  architecture: 'monolith' | 'microservices';
  status: 'completed';                  // snapshots only exist for completed runs
  metadata: Record<string, unknown> | null;

  graph: Graph;

  violations: {
    added: ViolationRecord[];           // full rows introduced this run
    resolved: ResolvedViolationRef[];   // refs to rows that went away this run
    previousAnalysisId: string | null;  // where to find the carried-forward set
  };

  usage: UsageRecord[];
}

/**
 * Materialized current-state view. Rewritten atomically after every normal
 * analyze. Dashboard reads this for 95 % of its endpoints — no JOINs,
 * no assembly needed.
 */
export interface LatestSnapshot {
  head: string;                         // filename of the analysis this was built from
  analysis: {
    id: string;
    createdAt: string;
    branch: string | null;
    commitHash: string | null;
    architecture: 'monolith' | 'microservices';
    metadata: Record<string, unknown> | null;
    status: 'completed';
  };
  graph: Graph;
  violations: ViolationWithNames[];     // full active set (added + carried unchanged)
}

/**
 * Summary-per-analysis index. Append-only. Powers `GET /analyses`,
 * `getTrend`, and `getResolution` without opening full snapshot files.
 */
export interface HistoryEntry {
  id: string;
  filename: string;                     // analyses/<filename>
  createdAt: string;
  branch: string | null;
  commitHash: string | null;
  metadata: Record<string, unknown> | null;
  counts: {
    services: number;
    modules: number;
    methods: number;
    violations: {
      new: number;
      unchanged: number;
      resolved: number;
      bySeverity: Record<ViolationSeverity, number>;
    };
  };
  usage: {
    totalTokens: number;
    totalCostUsd: string;               // string for precision
    durationMs: number;
    provider: string;
  };
}

export interface History {
  analyses: HistoryEntry[];
}

/**
 * Current diff analysis — compares working-tree changes to LATEST's baseline.
 * Overwritten each diff run; deleted on any normal analyze (baseline moved)
 * or when the baseline analysis is deleted.
 */
export interface DiffSnapshot {
  baseAnalysisId: string;               // must equal LATEST.analysis.id
  createdAt: string;
  branch: string | null;
  commitHash: string | null;
  /** Changed files with working-tree status, ready for UI rendering. */
  changedFiles: Array<{ path: string; status: 'new' | 'modified' | 'deleted' }>;
  /** Full violation rows (with denormalized names) introduced by the diff. */
  newViolations: ViolationWithNames[];
  /** Full rows of violations that were active in the baseline but gone now. */
  resolvedViolations: ViolationWithNames[];
  affectedNodeIds: {
    services: string[];
    layers: string[];
    modules: string[];
    methods: string[];
  };
  summary: {
    newCount: number;
    resolvedCount: number;
  };
}
