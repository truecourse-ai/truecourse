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
  languageSupport?: Record<string, { status: string; reason?: string }>;
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
  ruleKey?: string;
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

export function getDiffCheck(repoId: string, prNumber?: number): Promise<DiffCheckResponse | null> {
  const path = prNumber != null
    ? `/api/repos/${repoId}/analyses/diff?pr=${prNumber}`
    : `/api/repos/${repoId}/analyses/diff`;
  return fetchApi<DiffCheckResponse | null>(path);
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

export type IlValidationIssue = {
  artifactKey: string;
  message: string;
  severity: 'hard' | 'soft';
  tcSource?: string;
  /** Repair tried and failed to fix this artifact's syntax. */
  repairAttempted?: boolean;
  /** The last parser error after repair gave up. */
  repairFailReason?: string;
};

/** An enumerated target that never got a contract written (a genuine miss after the gap judge). */
export type IlCoverageGap = {
  areaId: string;
  kind: string;
  identity: string;
  /** The enumerator's hint for this target. */
  hint?: string;
  /** The gap judge's reason for keeping it as a genuine miss. */
  reason?: string;
};

export type ContractsGenerateResponse = {
  il:
    | {
        written: number;
        gaps: IlCoverageGap[];
        validationIssues: IlValidationIssue[];
        mergeDiagnostics: unknown[];
        /** True when the corpus was unchanged and generation was a 0-LLM no-op. */
        noChanges?: boolean;
      }
    | { error: string }
    | { skipped: string };
};

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
      /** True when this authored contract was promoted from an inferred decision. */
      inferred?: boolean;
    }>;
  }>;
  /**
   * The last `contracts generate` run's outcome, persisted so it survives a
   * reload. Null when never generated (or EE, where generate runs server-side).
   */
  lastGenerate?: {
    generatedAt: string;
    written: number;
    gaps: IlCoverageGap[];
    validationIssues: IlValidationIssue[];
  } | null;
};

export type ContractsFile = {
  path: string;
  content: string;
};

export function getContractsTree(repoId: string, ref?: string): Promise<ContractsTree> {
  const q = ref ? `?ref=${encodeURIComponent(ref)}` : '';
  return fetchApi<ContractsTree>(`/api/repos/${repoId}/contracts/tree${q}`);
}

export type ContractsDiff = { added: string[]; removed: string[]; modified: string[] };

export function getContractsDiff(repoId: string, ref: string): Promise<ContractsDiff> {
  return fetchApi<ContractsDiff>(`/api/repos/${repoId}/contracts/diff?ref=${encodeURIComponent(ref)}`);
}

/** OSS Git-Diff: run the working-tree-vs-committed contracts diff. */
export function postContractsDiff(repoId: string): Promise<ContractsDiff> {
  return fetchApi<ContractsDiff>(`/api/repos/${repoId}/contracts/diff`, { method: 'POST' });
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
  /** Spec-side origin of the requirement this drift came from (source doc +
   *  section + line range). Absent on old snapshots predating the field.
   *  `sourceUrl`/`sourceLabel` are attached by the server when the source is a
   *  synced workspace-KB doc (external link + title), e.g. a Confluence page. */
  specOrigin?: {
    source: string;
    section: string;
    lines: [number, number];
    sourceUrl?: string | null;
    sourceLabel?: string | null;
  } | null;
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
  /**
   * Commit the drifts were observed at (baseline commit for the latest state,
   * the snapshot's commit for a past run / PR head). Lets EE deep-link drift
   * sites to the GitHub blob at the right sha even in the non-PR base view.
   */
  commitHash?: string | null;
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

/**
 * Read the verify diff. Null on 404 (none computed yet).
 * `ref` (EE) → that commit's snapshot diffed against the repo's baseline (derived
 * server-side); omitted → the OSS working-tree diff.
 */
export async function getVerifyDiff(
  repoId: string,
  opts?: { ref?: string },
): Promise<VerifyDiff | null> {
  try {
    const q = opts?.ref ? `?ref=${encodeURIComponent(opts.ref)}` : '';
    return await fetchApi<VerifyDiff>(`/api/repos/${repoId}/verify/diff${q}`);
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

/** Human-readable prose for one drift — never replaces the structured original. */
export type EnrichedDrift = {
  /** One plain sentence: what the spec REQUIRES. */
  specReadable: string;
  /** One plain sentence: what the code ACTUALLY DOES. */
  codeReadable: string;
  /** One sentence combining both ("Spec requires X, but the code does Y."). */
  summary: string;
};

/**
 * On-demand, cached LLM enrichment of one drift into readable prose. Returns
 * `null` when no LLM transport is configured (204) or the call failed — the
 * caller then keeps the structured rendering. Repo-agnostic + content-addressed
 * server-side, so a drift the gate already enriched is a cache hit.
 *
 * Send the drift's content fields verbatim (the same string `specSide`/`codeSide`
 * the snapshot stored) so the server derives the same content key as the gate.
 */
export async function postDriftEnrich(
  repoId: string,
  drift: Pick<
    ContractDrift,
    'artifactRef' | 'obligationKey' | 'message' | 'severity' | 'specSide' | 'codeSide' | 'specOrigin'
  >,
): Promise<EnrichedDrift | null> {
  // 204 → fetchApi returns undefined; normalize to null for "no enrichment".
  return (
    (await fetchApi<EnrichedDrift | undefined>(
      `/api/repos/${repoId}/verify/drift/enrich`,
      { method: 'POST', body: JSON.stringify(drift) },
    )) ?? null
  );
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
  hasCorpus: boolean;
  hasGenerated: boolean;
  hasVerified: boolean;
};

export function getSpecStaleness(repoId: string): Promise<SpecStalenessResponse> {
  return fetchApi<SpecStalenessResponse>(`/api/repos/${repoId}/spec/staleness`);
}

// ---------------------------------------------------------------------------
// Corpus path (spec-scan redesign) — the curated doc corpus + doc→doc relations
// that replace claims/conflicts. Areas group docs; an overlap is two same-area
// docs that may disagree, resolved by recording a relation.
// ---------------------------------------------------------------------------

export type SpecRelationType = 'replace' | 'precedence' | 'keep-both';

export interface SpecRelation {
  type: SpecRelationType;
  older: string;
  newer: string;
  scope?: string;
  detectedFrom?: 'filename' | 'llm' | 'manual';
  note?: string;
}

export interface SpecOverlapSection {
  doc: string;
  heading: string;
}

export interface SpecOverlap {
  docs: [string, string];
  note: string;
  /** Conflicting sections per doc (markdown headings), when known. */
  sections?: SpecOverlapSection[];
}

export interface SpecCorpusDoc {
  ref: string;
  kind: string;
  status?: string;
  lastTouched: string;
  areaTags: string[];
}

export interface SpecCorpusArea {
  id: string;
  product: string;
  concern: string;
  docRefs: string[];
  overlaps: SpecOverlap[];
}

export interface SpecSkippedDoc {
  ref: string;
  reason: string;
}

export interface SpecCorpus {
  version: number;
  generatedAt: string;
  docs: SpecCorpusDoc[];
  areas: SpecCorpusArea[];
  /** Auto-detected relations (corpus-side). User relations come separately. */
  relations: SpecRelation[];
  /** Docs the relevance filter dropped (path + reason). */
  skippedDocs?: SpecSkippedDoc[];
}

export interface SpecCorpusResponse {
  corpus: SpecCorpus;
  userRelations: SpecRelation[];
  /** Doc refs the user force-included (bypass the relevance filter). */
  manualIncludes?: string[];
  /** Set by the scan endpoint: true when the rescan found no doc changes (0 LLM calls). */
  noChanges?: boolean;
}

/** A scan that the user dismissed at the cost-estimate confirm — a no-op. */
export interface SpecScanCancelled {
  cancelled: true;
}

/** Read the persisted corpus + user relations, or null on 404 (no scan yet). */
export async function getSpecCorpus(repoId: string): Promise<SpecCorpusResponse | null> {
  try {
    return await fetchApi<SpecCorpusResponse>(`/api/repos/${repoId}/spec/corpus`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

/**
 * Run a fresh corpus scan (curate), persist corpus.json, return it — or
 * `{ cancelled: true }` when the user dismisses the cost-estimate confirm.
 */
export function getSpecCorpusScan(
  repoId: string,
): Promise<SpecCorpusResponse | SpecScanCancelled> {
  return fetchApi<SpecCorpusResponse | SpecScanCancelled>(`/api/repos/${repoId}/spec/corpus/scan`);
}

/** A source doc's markdown (for the prose Spec tab). */
export function getSpecDoc(repoId: string, ref: string): Promise<{ ref: string; content: string }> {
  return fetchApi<{ ref: string; content: string }>(
    `/api/repos/${repoId}/spec/doc?ref=${encodeURIComponent(ref)}`,
  );
}

/** Run inference — reverse-engineer undocumented decisions from code into `_inferred/`. */
export function runInferContracts(repoId: string): Promise<{ decisions: number; written: number }> {
  return fetchApi<{ decisions: number; written: number }>(`/api/repos/${repoId}/inferred/run`, {
    method: 'POST',
  });
}

/** Force-include a relevance-dropped doc (caller re-scans afterward to apply it). */
export function addSpecInclude(repoId: string, ref: string): Promise<{ manualIncludes: string[] }> {
  return fetchApi<{ manualIncludes: string[] }>(`/api/repos/${repoId}/spec/includes`, {
    method: 'POST',
    body: JSON.stringify({ ref }),
  });
}

/** Remove a force-include override (caller re-scans afterward). */
export function removeSpecInclude(repoId: string, ref: string): Promise<{ manualIncludes: string[] }> {
  return fetchApi<{ manualIncludes: string[] }>(`/api/repos/${repoId}/spec/includes`, {
    method: 'DELETE',
    body: JSON.stringify({ ref }),
  });
}

/** Record a user doc→doc relation (resolves an overlap). */
export function postSpecRelation(repoId: string, payload: SpecRelation): Promise<{ relations: SpecRelation[] }> {
  return fetchApi<{ relations: SpecRelation[] }>(`/api/repos/${repoId}/spec/relations`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/** Remove a user relation. */
export function deleteSpecRelation(
  repoId: string,
  payload: { older: string; newer: string; scope?: string },
): Promise<{ relations: SpecRelation[] }> {
  return fetchApi<{ relations: SpecRelation[] }>(`/api/repos/${repoId}/spec/relations`, {
    method: 'DELETE',
    body: JSON.stringify(payload),
  });
}

