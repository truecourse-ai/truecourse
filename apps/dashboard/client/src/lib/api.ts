import type { CapabilitiesResponse } from '@truecourse/shared';
import { getServerUrl } from './server-url';

const BASE_URL = getServerUrl();

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function fetchApi<T>(
  endpoint: string,
  options?: RequestInit,
): Promise<T> {
  const url = `${BASE_URL}${endpoint}`;
  const res = await fetch(url, {
    ...options,
    // Send the enterprise session cookie (no-op in community). Required
    // because the dashboard API sits behind the auth gate in enterprise.
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!res.ok) {
    let message = 'Unknown error';
    try {
      const body = await res.json();
      message = body.error || JSON.stringify(body);
    } catch {
      message = await res.text().catch(() => 'Unknown error');
    }
    throw new ApiError(res.status, message);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

export type RepoResponse = {
  id: string;
  name: string;
  path: string;
  lastAnalyzed?: string;
  branches?: string[];
  defaultBranch?: string;
  isGitRepo?: boolean;
  latestAnalysis?: {
    id: string;
    status: string;
    [key: string]: unknown;
  };
};

export type GraphResponse = {
  nodes: Array<{
    id: string;
    type: string;
    position: { x: number; y: number };
    parentId?: string;
    extent?: string;
    style?: Record<string, unknown>;
    data: {
      label: string;
      description?: string;
      serviceType: string;
      framework?: string;
      fileCount: number;
      layers: string[];
      rootPath: string;
      layerColor?: string;
      fileNames?: string[];
      filePaths?: string[];
      layerDeps?: Array<{ targetLayer: string; count: number; isViolation: boolean }>;
      violations?: Array<{ edgeId?: string; edgeIds?: string[]; sourceLayer?: string; targetLayer: string; reason: string }>;
      databaseType?: string;
      tableCount?: number;
      connectedServices?: string[];
      isViolation?: boolean;
      violationReason?: string;
      // Module-level fields
      moduleKind?: string;
      methodCount?: number;
      propertyCount?: number;
      importCount?: number;
      exportCount?: number;
      superClass?: string;
      // Method-level fields
      signature?: string;
      paramCount?: number;
      returnType?: string;
      isAsync?: boolean;
      isExported?: boolean;
      lineCount?: number;
      statementCount?: number;
      maxNestingDepth?: number;
      isContainer?: boolean;
      isDead?: boolean;
    };
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    label?: string;
    sourceHandle?: string;
    targetHandle?: string;
    data: {
      dependencyCount: number;
      dependencyType?: string;
      isViolation?: boolean;
      violationReason?: string;
    };
  }>;
  collapsedIds?: string[];
};

export type ViolationResponse = {
  id: string;
  type: string;
  title: string;
  content: string;
  severity: string;
  status?: 'new' | 'unchanged' | 'resolved';
  targetServiceId?: string | null;
  targetServiceName?: string | null;
  targetDatabaseId?: string | null;
  targetDatabaseName?: string | null;
  targetModuleId?: string | null;
  targetModuleName?: string | null;
  targetMethodId?: string | null;
  targetMethodName?: string | null;
  targetTable?: string | null;
  fixPrompt?: string | null;
  firstSeenAt?: string | null;
  createdAt: string;
  // Code violation fields (type === 'code')
  filePath?: string;
  lineStart?: number;
  ruleKey?: string;
};

// Capabilities — fetched once at app boot by AppProvider so any
// component can ask `useCapability('sso')`. OSS always responds with
// `{ edition: 'community', capabilities: [] }`.
export function getCapabilities(): Promise<CapabilitiesResponse> {
  return fetchApi<CapabilitiesResponse>('/api/capabilities');
}

// Repos
export function getRepos(): Promise<RepoResponse[]> {
  return fetchApi<RepoResponse[]>('/api/repos');
}

export function getRepo(id: string): Promise<RepoResponse> {
  return fetchApi<RepoResponse>(`/api/repos/${id}`);
}

export function addRepo(path: string): Promise<RepoResponse> {
  return fetchApi<RepoResponse>('/api/repos', {
    method: 'POST',
    body: JSON.stringify({ path }),
  });
}

export function deleteRepo(id: string): Promise<void> {
  return fetchApi<void>(`/api/repos/${id}`, { method: 'DELETE' });
}

export function analyzeRepo(
  id: string,
  options?: { skipGit?: boolean },
): Promise<{ message: string; repoId: string; mode: 'full' }> {
  return fetchApi(`/api/repos/${id}/analyses`, {
    method: 'POST',
    body: JSON.stringify({ mode: 'full', ...(options?.skipGit != null ? { skipGit: options.skipGit } : {}) }),
  });
}

// Analyses
export type AnalysisSummary = {
  id: string;
  status: string;
  branch: string | null;
  commitHash: string | null;
  architecture: string;
  createdAt: string;
  serviceCount?: number;
  violationsBySeverity?: Record<string, number>;
  codeViolationsBySeverity?: Record<string, number>;
  durationMs?: number;
  totalTokens?: number;
  totalCost?: string | null;
  provider?: string | null;
};

export type AnalysisUsageRow = {
  id: string;
  analysisId: string;
  provider: string;
  callType: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  costUsd: string | null;
  durationMs: number;
  createdAt: string;
};

export function getAnalyses(repoId: string): Promise<AnalysisSummary[]> {
  return fetchApi<AnalysisSummary[]>(`/api/repos/${repoId}/analyses`);
}

export function getAnalysisUsage(repoId: string, analysisId: string): Promise<AnalysisUsageRow[]> {
  return fetchApi<AnalysisUsageRow[]>(`/api/repos/${repoId}/analyses/${analysisId}/usage`);
}

export function deleteAnalysis(repoId: string, analysisId: string): Promise<{ ok: boolean }> {
  return fetchApi(`/api/repos/${repoId}/analyses/${analysisId}`, { method: 'DELETE' });
}

export function cancelAnalysis(repoId: string): Promise<{ message: string }> {
  return fetchApi(`/api/repos/${repoId}/analyses/cancel`, { method: 'POST' });
}

// Graph
export function getGraph(
  repoId: string,
  options?: { branch?: string; level?: 'services' | 'modules' | 'methods'; analysisId?: string },
): Promise<GraphResponse> {
  const params = new URLSearchParams();
  if (options?.branch) params.set('branch', options.branch);
  if (options?.level) params.set('level', options.level);
  if (options?.analysisId) params.set('analysisId', options.analysisId);
  const qs = params.toString();
  return fetchApi<GraphResponse>(`/api/repos/${repoId}/graph${qs ? `?${qs}` : ''}`);
}

// All-level response for semantic zoom
export function saveGraphPositions(
  repoId: string,
  positions: Record<string, { x: number; y: number }>,
  branch?: string,
  level?: string,
): Promise<{ ok: boolean }> {
  const params = new URLSearchParams();
  if (branch) params.set('branch', branch);
  if (level) params.set('level', level);
  const qs = params.toString();
  return fetchApi<{ ok: boolean }>(`/api/repos/${repoId}/graph/positions${qs ? `?${qs}` : ''}`, {
    method: 'PUT',
    body: JSON.stringify({ positions }),
  });
}

export function resetGraphPositions(
  repoId: string,
  branch?: string,
  level?: string,
): Promise<{ ok: boolean }> {
  const params = new URLSearchParams();
  if (branch) params.set('branch', branch);
  if (level) params.set('level', level);
  const qs = params.toString();
  return fetchApi<{ ok: boolean }>(`/api/repos/${repoId}/graph/positions${qs ? `?${qs}` : ''}`, {
    method: 'DELETE',
  });
}

// Collapse state
export function saveCollapsedIds(
  repoId: string,
  collapsedIds: string[],
  branch?: string,
  level?: string,
): Promise<{ ok: boolean }> {
  const params = new URLSearchParams();
  if (branch) params.set('branch', branch);
  if (level) params.set('level', level);
  const qs = params.toString();
  return fetchApi<{ ok: boolean }>(`/api/repos/${repoId}/graph/collapsed${qs ? `?${qs}` : ''}`, {
    method: 'PUT',
    body: JSON.stringify({ collapsedIds }),
  });
}

// Files
export type FilesResponse = {
  root: string;
  files: string[];
};

export function getFiles(repoId: string, ref?: string): Promise<FilesResponse> {
  const params = ref ? `?ref=${encodeURIComponent(ref)}` : '';
  return fetchApi<FilesResponse>(`/api/repos/${repoId}/files${params}`);
}

// Violations
export function getViolations(repoId: string, analysisId?: string): Promise<ViolationResponse[]> {
  const params = new URLSearchParams();
  if (analysisId) params.set('analysisId', analysisId);
  const qs = params.toString();
  return fetchApi<ViolationResponse[]>(`/api/repos/${repoId}/violations${qs ? `?${qs}` : ''}`);
}

// Databases
export type DatabaseResponse = {
  id: string;
  name: string;
  type: string;
  driver: string;
  tableCount: number;
  connectedServices: string[];
  connections: Array<{ serviceId: string; driver: string }>;
};

export type DatabaseSchemaResponse = {
  id: string;
  name: string;
  type: string;
  driver: string;
  tables: Array<{
    name: string;
    columns: Array<{
      name: string;
      type: string;
      isNullable?: boolean;
      isPrimaryKey?: boolean;
      isForeignKey?: boolean;
      referencesTable?: string;
      referencesColumn?: string;
    }>;
    primaryKey?: string;
  }>;
  relations: Array<{
    sourceTable: string;
    targetTable: string;
    relationType: string;
    foreignKeyColumn: string;
  }>;
};

export function getDatabases(
  repoId: string,
  branch?: string,
  analysisId?: string,
): Promise<DatabaseResponse[]> {
  const params = new URLSearchParams();
  if (branch) params.set('branch', branch);
  if (analysisId) params.set('analysisId', analysisId);
  const qs = params.toString();
  return fetchApi<DatabaseResponse[]>(`/api/repos/${repoId}/databases${qs ? `?${qs}` : ''}`);
}

export function getDatabaseSchema(
  repoId: string,
  dbId: string,
  analysisId?: string,
): Promise<DatabaseSchemaResponse> {
  const qs = analysisId ? `?analysisId=${encodeURIComponent(analysisId)}` : '';
  return fetchApi<DatabaseSchemaResponse>(`/api/repos/${repoId}/databases/${dbId}/schema${qs}`);
}

// Rules
export type RuleResponse = {
  key: string;
  category: string;
  name: string;
  description: string;
  prompt?: string;
  enabled: boolean;
  severity: string;
  type: string;
};

export function getRules(repoId?: string): Promise<RuleResponse[]> {
  const path = repoId ? `/api/repos/${encodeURIComponent(repoId)}/rules` : '/api/rules';
  return fetchApi<RuleResponse[]>(path);
}

export function setRuleEnabled(
  repoId: string,
  ruleKey: string,
  enabled: boolean,
): Promise<{ key: string; enabled: boolean }> {
  return fetchApi(`/api/repos/${encodeURIComponent(repoId)}/rules/${encodeURIComponent(ruleKey)}`, {
    method: 'PATCH',
    body: JSON.stringify({ enabled }),
  });
}

// Diff Check
export type DiffViolationItem = {
  type: string;
  title: string;
  content: string;
  severity: string;
  targetServiceId: string | null;
  targetModuleId: string | null;
  targetMethodId: string | null;
  targetServiceName: string | null;
  targetModuleName: string | null;
  targetMethodName: string | null;
  fixPrompt: string | null;
  filePath?: string;
  lineStart?: number;
};

export type DiffCheckResponse = {
  changedFiles: Array<{ path: string; status: 'new' | 'modified' | 'deleted' }>;
  resolvedViolations: ViolationResponse[];
  newViolations: DiffViolationItem[];
  summary: {
    newCount: number;
    unchangedCount: number;
    resolvedCount: number;
  };
  affectedNodeIds: {
    services: string[];
    layers: string[];
    modules: string[];
    methods: string[];
  };
  isStale?: boolean;
  diffAnalysisId?: string;
};

export function runDiffCheck(repoId: string): Promise<{ message: string; repoId: string; mode: 'diff' }> {
  // POST returns 202 immediately; the actual diff result is streamed via
  // sockets (analysis:progress, analysis:llm-estimate, analysis:complete)
  // and then fetched via `getDiffCheck`.
  return fetchApi(`/api/repos/${repoId}/analyses`, {
    method: 'POST',
    body: JSON.stringify({ mode: 'diff' }),
  });
}

export function getDiffCheck(repoId: string): Promise<DiffCheckResponse | null> {
  return fetchApi<DiffCheckResponse | null>(`/api/repos/${repoId}/analyses/diff`);
}

// Code Violations
export type CodeViolationResponse = {
  id: string;
  filePath: string;
  lineStart: number;
  lineEnd: number;
  columnStart: number;
  columnEnd: number;
  ruleKey: string;
  severity: string;
  title: string;
  content: string;
  snippet: string;
  fixPrompt?: string;
};

export type CodeViolationSummary = {
  total: number;
  byFile: Record<string, number>;
  bySeverity: Record<string, number>;
  highestSeverityByFile: Record<string, string>;
};

export function getFileContent(
  repoId: string,
  filePath: string,
  ref?: string,
): Promise<{ content: string; language: string }> {
  const params = new URLSearchParams({ path: filePath });
  if (ref) params.set('ref', ref);
  return fetchApi<{ content: string; language: string }>(
    `/api/repos/${repoId}/file-content?${params.toString()}`,
  );
}

export function getCodeViolations(
  repoId: string,
  file?: string,
  analysisId?: string,
): Promise<CodeViolationResponse[]> {
  const params = new URLSearchParams();
  if (file) params.set('file', file);
  if (analysisId) params.set('analysisId', analysisId);
  const qs = params.toString();
  return fetchApi<CodeViolationResponse[]>(
    `/api/repos/${repoId}/violations${qs ? `?${qs}` : ''}`,
  );
}

export function getCodeViolationSummary(
  repoId: string,
  analysisId?: string,
): Promise<CodeViolationSummary> {
  const params = new URLSearchParams();
  if (analysisId) params.set('analysisId', analysisId);
  const qs = params.toString();
  return fetchApi<CodeViolationSummary>(
    `/api/repos/${repoId}/violations/summary${qs ? `?${qs}` : ''}`,
  );
}

// Flows
export type FlowResponse = {
  id: string;
  name: string;
  description: string | null;
  entryService: string;
  entryMethod: string;
  category: string;
  trigger: string;
  stepCount: number;
  createdAt: string;
};

export type FlowStepResponse = {
  id: string;
  flowId: string;
  stepOrder: number;
  sourceService: string;
  sourceModule: string;
  sourceMethod: string;
  targetService: string;
  targetModule: string;
  targetMethod: string;
  stepType: string;
  dataDescription: string | null;
  isAsync: boolean;
  isConditional: boolean;
};

export type FlowDetailResponse = FlowResponse & {
  steps: FlowStepResponse[];
};

export type FlowListResponse = {
  flows: FlowResponse[];
  severities: Record<string, string>;
};

export function getFlows(repoId: string, analysisId?: string): Promise<FlowListResponse> {
  const qs = analysisId ? `?analysisId=${encodeURIComponent(analysisId)}` : '';
  return fetchApi<FlowListResponse>(`/api/repos/${repoId}/flows${qs}`);
}

export function getFlow(
  repoId: string,
  flowId: string,
  analysisId?: string,
): Promise<FlowDetailResponse> {
  const qs = analysisId ? `?analysisId=${encodeURIComponent(analysisId)}` : '';
  return fetchApi<FlowDetailResponse>(`/api/repos/${repoId}/flows/${flowId}${qs}`);
}

export function enrichFlow(repoId: string, flowId: string): Promise<FlowDetailResponse> {
  return fetchApi<FlowDetailResponse>(`/api/repos/${repoId}/flows/${flowId}/enrich`, {
    method: 'POST',
  });
}

// Analytics
export type TrendDataPoint = {
  analysisId: string;
  date: string;
  branch: string | null;
  total: number;
  new: number;
  unchanged: number;
  resolved: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
};

export type TrendResponse = { points: TrendDataPoint[] };

export type BreakdownResponse = {
  byCategory: Record<string, number>;
  bySeverity: Record<string, number>;
  total: number;
};

export type TopOffender = {
  id: string;
  name: string;
  kind: 'service' | 'module';
  violationCount: number;
  criticalCount: number;
  highCount: number;
};

export type TopOffendersResponse = {
  offenders: TopOffender[];
  analysisId: string;
};

export type ResolutionResponse = {
  avgTimeToResolveMs: number | null;
  totalResolved: number;
  totalActive: number;
  resolutionRate: number;
  staleCount: number;
  staleDays: number;
};

export function getAnalyticsTrend(
  repoId: string,
  branch?: string,
  limit?: number,
  analysisId?: string,
): Promise<TrendResponse> {
  const params = new URLSearchParams();
  if (branch) params.set('branch', branch);
  if (limit) params.set('limit', String(limit));
  if (analysisId) params.set('analysisId', analysisId);
  const qs = params.toString();
  return fetchApi<TrendResponse>(`/api/repos/${repoId}/analytics/trend${qs ? `?${qs}` : ''}`);
}

export function getAnalyticsBreakdown(repoId: string, branch?: string, analysisId?: string): Promise<BreakdownResponse> {
  const params = new URLSearchParams();
  if (branch) params.set('branch', branch);
  if (analysisId) params.set('analysisId', analysisId);
  const qs = params.toString();
  return fetchApi<BreakdownResponse>(`/api/repos/${repoId}/analytics/breakdown${qs ? `?${qs}` : ''}`);
}

export function getAnalyticsTopOffenders(repoId: string, branch?: string, analysisId?: string): Promise<TopOffendersResponse> {
  const params = new URLSearchParams();
  if (branch) params.set('branch', branch);
  if (analysisId) params.set('analysisId', analysisId);
  const qs = params.toString();
  return fetchApi<TopOffendersResponse>(`/api/repos/${repoId}/analytics/top-offenders${qs ? `?${qs}` : ''}`);
}

export function getAnalyticsResolution(
  repoId: string,
  branch?: string,
  analysisId?: string,
): Promise<ResolutionResponse> {
  const params = new URLSearchParams();
  if (branch) params.set('branch', branch);
  if (analysisId) params.set('analysisId', analysisId);
  const qs = params.toString();
  return fetchApi<ResolutionResponse>(`/api/repos/${repoId}/analytics/resolution${qs ? `?${qs}` : ''}`);
}

// ---------------------------------------------------------------------------
// Spec Consolidation (Module 1)
// ---------------------------------------------------------------------------

export type SpecClaim = {
  id: string;
  topic: string;
  subject: string;
  content: unknown;
  /** 'definition' = the section's primary subject; 'constraint' = narrowing rule. */
  kind?: 'definition' | 'constraint';
  provenance: { file: string; line: number; quote: string };
  metadata: { docKind: string; status?: string; lastTouched: string };
  /** `workspace` = inherited from workspace Knowledge (enterprise); else the repo's own. */
  layer?: 'workspace' | 'repo';
};

export type SpecConflictCandidate = {
  index: number;
  weight: 'newest' | 'newer' | 'older' | 'oldest';
  claim: SpecClaim;
};

export type SpecConflict = {
  id: string;
  topic: string;
  subject: string;
  module?: string;
  candidates: SpecConflictCandidate[];
  defaultPick: number;
  /** Plain-English LLM-generated explanation of how candidates differ. */
  explanation?: string;
  /**
   * Opus (LLM resolver) verdict for this open conflict — present only
   * when the resolver returned medium/low confidence. High-confidence
   * verdicts auto-applied and the conflict is in decidedConflicts.
   */
  resolverVerdict?: {
    confidence: 'high' | 'medium' | 'low';
    reasoning: string;
    pick: number;
  };
  /** Server-computed sha256 fingerprint of the candidate set; echo on POST. */
  candidateFingerprint: string;
};

export type SpecResolution =
  | { kind: 'pick'; candidateIndex: number }
  | { kind: 'custom'; content: string };

export type SpecDecision = {
  conflictId: string;
  resolution: SpecResolution;
  resolvedAt: string;
  candidateFingerprint: string;
  note?: string;
};

export type SpecDecisionsFile = {
  version: 1;
  decisions: SpecDecision[];
};

export type SpecScanResponse = {
  /** Set on persisted state and on fresh scans. Absent on legacy responses. */
  scannedAt?: string;
  docsScanned: number;
  blocksAttempted: number;
  claimsExtracted: number;
  resolved: number;
  decided: number;
  openConflicts: SpecConflict[];
  decidedConflicts: Array<{ conflict: SpecConflict; decision: SpecDecision }>;
  /**
   * Docs the LLM relevance filter excluded from extraction. Each has a
   * short reason. User can force-include via the include endpoint.
   * Absent on older scan-state files; treat as [].
   */
  skippedDocs?: Array<{ path: string; reason: string }>;
};

export type IlValidationIssue = {
  artifactKey: string;
  message: string;
  severity: 'hard' | 'soft';
  tcSource?: string;
};

export type ContractsGenerateResponse = {
  il:
    | {
        written: number;
        validationIssues: IlValidationIssue[];
        mergeDiagnostics: unknown[];
      }
    | { error: string }
    | { skipped: string };
};

export function getSpecScan(repoId: string): Promise<SpecScanResponse> {
  return fetchApi<SpecScanResponse>(`/api/repos/${repoId}/spec/scan`);
}

export type CanonicalSpecTopic = {
  topic: string;
  claimCount: number;
  /** Every claim in this topic is inherited from workspace Knowledge (enterprise). */
  inherited?: boolean;
};

export type CanonicalSpecModule = {
  name: string;
  manifest: Record<string, unknown>;
  topics: CanonicalSpecTopic[];
  /** Every topic in this module is entirely workspace-inherited (enterprise). */
  inherited?: boolean;
};

export type CanonicalSpecTree = {
  hasCanonical: boolean;
  generatedAt?: string;
  modules: CanonicalSpecModule[];
};

export type CanonicalSpecSection = {
  module: string;
  topic: string;
  manifest: Record<string, unknown>;
  claims: SpecClaim[];
};

export function getSpecCanonicalTree(
  repoId: string,
  ref?: string,
): Promise<CanonicalSpecTree> {
  const q = ref ? `?ref=${encodeURIComponent(ref)}` : '';
  return fetchApi<CanonicalSpecTree>(`/api/repos/${repoId}/spec/canonical/tree${q}`);
}

export function getSpecCanonicalSection(
  repoId: string,
  moduleName: string,
  topic: string,
  ref?: string,
): Promise<CanonicalSpecSection> {
  const params = new URLSearchParams({ module: moduleName, topic });
  if (ref) params.set('ref', ref);
  return fetchApi<CanonicalSpecSection>(
    `/api/repos/${repoId}/spec/canonical/section?${params.toString()}`,
  );
}

// ---------------------------------------------------------------------------
// Contracts (Module 2)
// ---------------------------------------------------------------------------

export type ContractsTree = {
  hasContracts: boolean;
  modules: Array<{
    name: string;
    files: Array<{
      name: string;
      path: string;
      /** `workspace` = inherited from workspace Knowledge (enterprise); else the repo's own. */
      provenance?: 'workspace' | 'repo';
    }>;
  }>;
};

export type ContractsFile = {
  path: string;
  content: string;
};

export function getContractsTree(repoId: string, ref?: string): Promise<ContractsTree> {
  const q = ref ? `?ref=${encodeURIComponent(ref)}` : '';
  return fetchApi<ContractsTree>(`/api/repos/${repoId}/contracts/tree${q}`);
}

export function getContractsFile(
  repoId: string,
  filePath: string,
  ref?: string,
): Promise<ContractsFile> {
  const params = new URLSearchParams({ path: filePath });
  if (ref) params.set('ref', ref);
  return fetchApi<ContractsFile>(`/api/repos/${repoId}/contracts/file?${params.toString()}`);
}

// ---------------------------------------------------------------------------
// Verify (Module 3 — code vs contracts drift detection)
// ---------------------------------------------------------------------------

export type DriftSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export type ContractDrift = {
  id: string;
  artifactRef?: { type: string; identity: string } | null;
  obligationKey: string;
  severity: DriftSeverity;
  message: string;
  filePath?: string | null;
  lineStart?: number | null;
  lineEnd?: number | null;
  specSide?: unknown;
  codeSide?: unknown;
};

export type VerifyState = {
  verifiedAt: string;
  contractsDir: string;
  codeDir: string;
  artifactCount: number;
  extractedOperationCount: number;
  drifts: ContractDrift[];
  resolverErrors: string[];
  unresolvedRefs: string[];
};

/**
 * Persisted verify state. Returns null on 404 (no run yet); other
 * errors propagate.
 */
export async function getVerifyState(
  repoId: string,
  ref?: string,
): Promise<VerifyState | null> {
  try {
    const q = ref ? `?ref=${encodeURIComponent(ref)}` : '';
    return await fetchApi<VerifyState>(`/api/repos/${repoId}/verify/state${q}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

export function postVerifyRun(repoId: string): Promise<VerifyState> {
  return fetchApi<VerifyState>(`/api/repos/${repoId}/verify/run`, {
    method: 'POST',
  });
}

export type ChangedFile = { path: string; status: 'new' | 'modified' | 'deleted' };

export type VerifyDiff = {
  id: string;
  baseRunId: string;
  verifiedAt: string;
  branch: string | null;
  commitHash: string | null;
  added: ContractDrift[];
  resolved: ContractDrift[];
  unchangedCount: number;
  changedFiles: ChangedFile[];
  summary: { added: number; resolved: number; unchanged: number };
};

/** Read the last-computed verify diff. Null on 404 (none computed yet). */
export async function getVerifyDiff(repoId: string): Promise<VerifyDiff | null> {
  try {
    return await fetchApi<VerifyDiff>(`/api/repos/${repoId}/verify/diff`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

/** Compute + persist a fresh verify diff against the committed baseline. */
export function postVerifyDiff(repoId: string): Promise<VerifyDiff> {
  return fetchApi<VerifyDiff>(`/api/repos/${repoId}/verify/diff`, {
    method: 'POST',
  });
}

export type VerifyHistoryEntry = {
  id: string;
  filename: string;
  verifiedAt: string;
  branch: string | null;
  commitHash: string | null;
  artifactCount: number;
  driftCount: number;
  bySeverity: Record<DriftSeverity, number>;
};
export type VerifyHistory = { runs: VerifyHistoryEntry[] };

/** Per-run drift summaries for the trend chart. Empty when no runs yet. */
export async function getVerifyHistory(repoId: string): Promise<VerifyHistory> {
  try {
    return await fetchApi<VerifyHistory>(`/api/repos/${repoId}/verify/history`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return { runs: [] };
    throw e;
  }
}

/** State for a specific past verify run (for the runs dropdown). */
export function getVerifyRun(repoId: string, runId: string): Promise<VerifyState> {
  return fetchApi<VerifyState>(`/api/repos/${repoId}/verify/runs/${runId}`);
}

/** Delete a past verify run (snapshot + history entry). */
export function deleteVerifyRun(repoId: string, runId: string): Promise<{ deleted: boolean }> {
  return fetchApi<{ deleted: boolean }>(`/api/repos/${repoId}/verify/runs/${runId}`, {
    method: 'DELETE',
  });
}

/**
 * Read the persisted scan-state. Returns null when the server
 * responds 404 (no scan has been run yet) — any other error
 * propagates so the caller can show it.
 */
export async function getSpecScanState(repoId: string): Promise<SpecScanResponse | null> {
  try {
    return await fetchApi<SpecScanResponse>(`/api/repos/${repoId}/spec/scan-state`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

export function getSpecDecisions(repoId: string): Promise<SpecDecisionsFile> {
  return fetchApi<SpecDecisionsFile>(`/api/repos/${repoId}/spec/decisions`);
}

export function deleteSpecDecision(
  repoId: string,
  conflictId: string,
): Promise<SpecDecisionsFile> {
  return fetchApi<SpecDecisionsFile>(
    `/api/repos/${repoId}/spec/decisions/${encodeURIComponent(conflictId)}`,
    { method: 'DELETE' },
  );
}

export function postSpecDecision(
  repoId: string,
  payload: { conflictId: string; resolution: SpecResolution; candidateFingerprint: string; note?: string },
): Promise<SpecDecisionsFile> {
  return fetchApi<SpecDecisionsFile>(`/api/repos/${repoId}/spec/decisions`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function postSpecManualInclude(
  repoId: string,
  payload: { path: string },
): Promise<SpecDecisionsFile> {
  return fetchApi<SpecDecisionsFile>(`/api/repos/${repoId}/spec/docs/include`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function deleteSpecManualInclude(
  repoId: string,
  payload: { path: string },
): Promise<SpecDecisionsFile> {
  return fetchApi<SpecDecisionsFile>(`/api/repos/${repoId}/spec/docs/include`, {
    method: 'DELETE',
    body: JSON.stringify(payload),
  });
}

export function postSpecManualChain(
  repoId: string,
  payload: { older: string; newer: string; note?: string },
): Promise<SpecDecisionsFile> {
  return fetchApi<SpecDecisionsFile>(`/api/repos/${repoId}/spec/chains/manual`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function deleteSpecManualChain(
  repoId: string,
  payload: { older: string; newer: string },
): Promise<SpecDecisionsFile> {
  return fetchApi<SpecDecisionsFile>(`/api/repos/${repoId}/spec/chains/manual`, {
    method: 'DELETE',
    body: JSON.stringify(payload),
  });
}

export function postSpecDecisionsBatch(
  repoId: string,
  mode: 'all-defaults',
): Promise<{ added: number; decisions: SpecDecisionsFile }> {
  return fetchApi(`/api/repos/${repoId}/spec/decisions/batch`, {
    method: 'POST',
    body: JSON.stringify({ mode }),
  });
}

export function postContractsGenerate(
  repoId: string,
): Promise<ContractsGenerateResponse> {
  return fetchApi<ContractsGenerateResponse>(
    `/api/repos/${repoId}/contracts/generate`,
    { method: 'POST' },
  );
}

export type SpecStalenessResponse = {
  contractsStale: boolean;
  verifyStale: boolean;
  hasClaims: boolean;
  hasGenerated: boolean;
  hasVerified: boolean;
};

export function getSpecStaleness(repoId: string): Promise<SpecStalenessResponse> {
  return fetchApi<SpecStalenessResponse>(`/api/repos/${repoId}/spec/staleness`);
}

