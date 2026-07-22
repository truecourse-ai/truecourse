import type {
  BrowseDirResponse,
  CapabilitiesResponse,
  GuardClaimIdentity,
  GuardDecisions,
  GuardFamilyMember,
  GuardDocCoverage,
  GuardGenerateReport,
  GuardHistory,
  GuardLatest,
  GuardLatestResponse,
  GuardScenarioInventory,
  GuardScenarioSource,
  GuardStaleness,
} from '@truecourse/shared';
import type { LlmEstimateData } from '@/hooks/useSocket';
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

/** Verbs a repo card shows for its most-recent lifecycle event. */
export type LatestEventKind = 'analyzed' | 'scanned' | 'generated' | 'guarded';

export type RepoResponse = {
  id: string;
  name: string;
  path: string;
  lastAnalyzed?: string;
  /** Most recent lifecycle event across features (home-page card), or null. */
  latestEvent?: { kind: LatestEventKind; at: string } | null;
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

/**
 * List subdirectories of `path` (defaults to the server user's home dir) for the
 * directory picker. Local-only — the server 404s this when the local-filesystem
 * capability is off, so callers must gate the UI on `useCapability('local-filesystem')`.
 */
export function browseDir(path?: string): Promise<BrowseDirResponse> {
  const qs = path ? `?path=${encodeURIComponent(path)}` : '';
  return fetchApi<BrowseDirResponse>(`/api/repos/browse${qs}`);
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

export type SpecStalenessResponse = {
  /** Recorded include/exclude/conflict decisions are newer than the corpus — a Scan applies them. */
  decisionsPending: boolean;
  /** A kept doc changed on disk since the last scan (edited in the dashboard or outside it). */
  docsChanged: boolean;
  hasCorpus: boolean;
  hasGenerated: boolean;
};

export function getSpecStaleness(repoId: string): Promise<SpecStalenessResponse> {
  return fetchApi<SpecStalenessResponse>(`/api/repos/${repoId}/spec/staleness`);
}

// ---------------------------------------------------------------------------
// Corpus path (spec-scan redesign) — the curated doc corpus. Areas group docs;
// an overlap is two same-area docs that may disagree, resolved by a
// section-scoped verdict (pick-a-side / dismissal) or a force-exclude.
// ---------------------------------------------------------------------------

export interface SpecOverlapSection {
  doc: string;
  /** Heading of the conflicting section, or null when it lives in the doc's preamble. */
  heading: string | null;
  /** The verbatim disputed sentence, when the detector captured one — carried into a
   *  pick-a-side verdict so the loser's claim is suppressed at guard generate. */
  quote?: string;
}

/** A section-scoped conflict verdict (item 31) — pick-a-side ('a'/'b') or dismissal.
 *  Identity is the unordered doc pair + each side's section anchor (+ optional quote). */
export interface SpecConflictResolution {
  docA: string;
  anchorA: string | null;
  quoteA?: string;
  docB: string;
  anchorB: string | null;
  quoteB?: string;
  verdict: 'a' | 'b' | 'dismissed';
  resolvedAt?: string;
  note?: string;
}

/**
 * The verify judge's resolution brief for a confirmed conflict — advisory only.
 * `explanation` is a human-readable account of the disagreement; `recommendation`
 * is a suggested action the user may apply. Absent on unverified/legacy flags.
 */
export interface SpecOverlapReview {
  explanation: string;
  recommendation: {
    /** 'pick-a' backs the overlap's first doc, 'pick-b' the second. */
    action: 'pick-a' | 'pick-b' | 'fix-doc' | 'dismiss';
    rationale: string;
    /** For `fix-doc`: the suggested doc edit the user applies themselves. */
    fix?: string;
  };
}

export interface SpecOverlap {
  docs: [string, string];
  note: string;
  /** The verify judge's resolution brief, when this flag was reviewed. */
  review?: SpecOverlapReview;
  /** Conflicting sections per doc (markdown headings), when known. */
  sections?: SpecOverlapSection[];
  /**
   * Every area this (possibly cross-area-merged) dispute spans. Detection runs
   * per area, so one disagreement on a pair sharing several areas is flagged in
   * each and merged to one record; a resolution scoped to any spanned area (or an
   * unscoped one) clears it everywhere. Empty on older corpora.
   */
  areas?: string[];
}

export interface SpecCorpusDoc {
  ref: string;
  kind: string;
  status?: string;
  lastTouched: string;
  areaTags: string[];
  /** Hosted only: `'workspace'` when this doc is inherited from the workspace
   *  Knowledge corpus (folded into the repo scan before curate). Absent on
   *  repo-local docs and in OSS — the UI shows no workspace badge then. */
  layer?: 'workspace';
  /** Workspace only: the ledger's human title for this ref (synthetic docPath).
   *  Absent on repo corpora — the UI falls back to the ref. */
  title?: string;
  /** Workspace only: deep link to the source doc, when the ledger has one. */
  url?: string | null;
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
  /** Workspace only: the ledger's human title for this ref. Absent on repo corpora. */
  title?: string;
  /** Workspace only: deep link to the source doc, when the ledger has one. */
  url?: string | null;
}

/**
 * A skipped-docs SUMMARY (counts only), returned by the workspace corpus GET in
 * place of the full `skippedDocs` array — a source with thousands of dropped docs
 * must not ship every row into the corpus payload (the individual rows load lazily
 * via the paged skipped listing). Absent on the repo corpus, which carries the
 * full array inline.
 */
export interface SpecSkippedSummary {
  total: number;
  byReason: { reason: string; count: number }[];
}

export interface SpecCorpus {
  version: number;
  generatedAt: string;
  docs: SpecCorpusDoc[];
  areas: SpecCorpusArea[];
  /** Docs the relevance filter dropped (path + reason). */
  skippedDocs?: SpecSkippedDoc[];
}

export interface SpecCorpusResponse {
  corpus: SpecCorpus;
  /** Doc refs the user force-included (bypass the relevance filter). */
  manualIncludes?: string[];
  /** Doc refs the user force-excluded (dropped from the corpus). */
  manualExcludes?: string[];
  /** Section-scoped conflict verdicts — the client derives resolved/dismissed/orphaned state from these. */
  conflictResolutions?: SpecConflictResolution[];
  /**
   * Workspace corpus only: a skipped-docs summary in place of `corpus.skippedDocs`
   * (which the workspace payload omits for scale). The individual rows load lazily
   * via the paged skipped listing (the data-source seam's `listSkipped`).
   */
  skipped?: SpecSkippedSummary;
  /** Set by the scan endpoint: true when the rescan found no doc changes (0 LLM calls). */
  noChanges?: boolean;
  /**
   * EE PR view: the commit whose corpus was actually returned. When it differs
   * from the requested `ref`, the server fell back to the baseline corpus (e.g.
   * a code-only PR whose head was never spec-scanned).
   */
  corpusCommit?: string;
}

/** A scan that the user dismissed at the cost-estimate confirm — a no-op. */
export interface SpecScanCancelled {
  cancelled: true;
}

/**
 * OSS include/exclude ack: the persisted decision lists only. The corpus is
 * unchanged by an OSS decision (no re-curate), so no corpus is returned — the
 * client keeps its optimistic row move until the next Scan. PR scope (EE) returns
 * the full re-curated `SpecCorpusResponse` instead.
 */
export interface SpecDecisionAck {
  manualIncludes: string[];
  manualExcludes: string[];
}

/**
 * OSS conflict-verdict ack: the persisted verdicts only (no corpus — a verdict
 * doesn't re-curate). The client re-derives resolved/dismissed state from these.
 * PR scope (EE) returns the full re-curated `SpecCorpusResponse` instead.
 */
export interface SpecConflictAck {
  conflictResolutions: SpecConflictResolution[];
}

/**
 * EE PR scope for the spec decision routes: `?pr=<n>&ref=<headSha>` (both
 * required together). Empty outside a PR view, so OSS URLs are unchanged.
 */
function prScopeQuery(opts?: { pr?: number; ref?: string }): string {
  return opts?.pr != null && opts.ref ? `?pr=${opts.pr}&ref=${encodeURIComponent(opts.ref)}` : '';
}

/** Read the persisted corpus, or null on 404 (no scan yet). */
export async function getSpecCorpus(
  repoId: string,
  ref?: string,
  pr?: number,
): Promise<SpecCorpusResponse | null> {
  const params = new URLSearchParams();
  if (ref) params.set('ref', ref);
  if (pr != null) params.set('pr', String(pr));
  const q = params.size > 0 ? `?${params.toString()}` : '';
  try {
    return await fetchApi<SpecCorpusResponse>(`/api/repos/${repoId}/spec/corpus${q}`);
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

/** A source doc's markdown (for the prose Spec tab). `commit` reads it at a PR head (EE). */
export function getSpecDoc(repoId: string, ref: string, commit?: string): Promise<{ ref: string; content: string }> {
  const c = commit ? `&commit=${encodeURIComponent(commit)}` : '';
  return fetchApi<{ ref: string; content: string }>(
    `/api/repos/${repoId}/spec/doc?ref=${encodeURIComponent(ref)}${c}`,
  );
}

// ---------------------------------------------------------------------------
// Guard — spec-section scenario coverage (read-only, diff-free).
// ---------------------------------------------------------------------------

/** Append `?ref=`/`&ref=` when a PR head is being viewed (EE); a no-op otherwise. */
function withRef(base: string, ref?: string): string {
  if (!ref) return base;
  return `${base}${base.includes('?') ? '&' : '?'}ref=${encodeURIComponent(ref)}`;
}

/** The two amber-dot signals for the Guard tab (generate / run staleness). `ref`
 *  scopes to a PR head (EE). */
export function getGuardStaleness(repoId: string, ref?: string): Promise<GuardStaleness> {
  return fetchApi<GuardStaleness>(withRef(`/api/repos/${repoId}/guard/staleness`, ref));
}

/**
 * The guard run for the view. No `ref` → the repo baseline (or null when never
 * run). With `ref` (a PR head, EE) → the run stored at that commit, else an
 * explicit pending/empty envelope — never the baseline under a PR header. Always
 * resolves to a `{ latest, pending }` envelope so callers handle both uniformly.
 */
export async function getGuardLatest(repoId: string, ref?: string): Promise<GuardLatestResponse> {
  try {
    const body = await fetchApi<GuardLatest | GuardLatestResponse>(
      withRef(`/api/repos/${repoId}/guard/latest`, ref),
    );
    // With a ref the server returns the envelope; without one, a raw run.
    return ref ? (body as GuardLatestResponse) : { latest: body as GuardLatest, pending: null };
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return { latest: null, pending: null };
    throw e;
  }
}

/** The append-only run-summary history (empty `{ runs: [] }` until a run exists).
 *  With `pr` (EE), the PR's own run timeline — one run per pushed head. */
export function getGuardHistory(repoId: string, pr?: number): Promise<GuardHistory> {
  const qs = pr !== undefined ? `?pr=${pr}` : '';
  return fetchApi<GuardHistory>(`/api/repos/${repoId}/guard/history${qs}`);
}

/** One past run's materialized state by id; null on 404 (unknown run). */
export async function getGuardRun(repoId: string, runId: string): Promise<GuardLatest | null> {
  try {
    return await fetchApi<GuardLatest>(`/api/repos/${repoId}/guard/runs/${encodeURIComponent(runId)}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

/** The last `guard generate` report; null on 404 (never generated). `ref` scopes to a PR head (EE). */
export async function getGuardReport(repoId: string, ref?: string): Promise<GuardGenerateReport | null> {
  try {
    return await fetchApi<GuardGenerateReport>(withRef(`/api/repos/${repoId}/guard/report`, ref));
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

/** Per-section coverage over a live spec doc; null on 404 (doc gone / no store). `ref` scopes to a PR head (EE). */
export async function getGuardCoverage(repoId: string, doc: string, ref?: string): Promise<GuardDocCoverage | null> {
  try {
    return await fetchApi<GuardDocCoverage>(
      withRef(`/api/repos/${repoId}/guard/coverage?doc=${encodeURIComponent(doc)}`, ref),
    );
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

/** The committed-scenario inventory + recipe card for the Scenarios tab. `ref` scopes to a PR head (EE). */
export function getGuardScenarios(repoId: string, ref?: string): Promise<GuardScenarioInventory> {
  return fetchApi<GuardScenarioInventory>(withRef(`/api/repos/${repoId}/guard/scenarios`, ref));
}

/** A scenario's raw YAML source; null on 404 (unknown id). `ref` scopes to a PR head (EE). */
export async function getGuardScenarioSource(repoId: string, id: string, ref?: string): Promise<GuardScenarioSource | null> {
  try {
    return await fetchApi<GuardScenarioSource>(
      withRef(`/api/repos/${repoId}/guard/scenario?id=${encodeURIComponent(id)}`, ref),
    );
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

/**
 * A failed scenario's evidence transcript (text/plain). `fetchApi` is JSON-only,
 * so this reads the raw body itself. Throws `ApiError` on a non-OK response
 * (e.g. 404 when no transcript was captured).
 */
export async function getGuardEvidence(
  repoId: string,
  runId: string,
  scenarioId: string,
  file?: string,
): Promise<string> {
  const params = new URLSearchParams({ runId, scenarioId });
  if (file) params.set('file', file);
  const res = await fetch(`${BASE_URL}/api/repos/${repoId}/guard/evidence?${params.toString()}`, {
    credentials: 'include',
  });
  if (!res.ok) throw new ApiError(res.status, await res.text().catch(() => 'Evidence not found.'));
  return res.text();
}

/**
 * A birth finding's evidence transcript, addressed by its stored `evidencePath`
 * (the finding carries the whole pointer, not a run id + scenario id). text/plain;
 * throws `ApiError` on a non-OK response (404 when no transcript was written).
 */
export async function getGuardFindingEvidence(
  repoId: string,
  evidencePath: string,
  file?: string,
): Promise<string> {
  const params = new URLSearchParams({ path: evidencePath });
  if (file) params.set('file', file);
  const res = await fetch(`${BASE_URL}/api/repos/${repoId}/guard/finding-evidence?${params.toString()}`, {
    credentials: 'include',
  });
  if (!res.ok) throw new ApiError(res.status, await res.text().catch(() => 'Evidence not found.'));
  return res.text();
}

/** EE PR scope for the guard decisions routes: `?pr=<n>` (no ref — decisions are
 *  keyed by PR alone). Empty outside a PR view, so OSS URLs are unchanged. */
function guardPrQuery(pr?: number): string {
  return pr !== undefined ? `?pr=${pr}` : '';
}

/** The committable guard decisions (dismissed claims) — always 200 (empty until
 *  the user dismisses anything). */
export function getGuardDecisions(repoId: string, pr?: number): Promise<GuardDecisions> {
  return fetchApi<GuardDecisions>(`/api/repos/${repoId}/guard/decisions${guardPrQuery(pr)}`);
}

/** The identity a dismissal keys on: doc + section anchor + the extracted claim's
 *  stable text (a finding's `claim`). Re-exported for the guard components. */
export type { GuardClaimIdentity };

/** Dismiss a finding's claim — writes `scenarios/decisions.json`; returns the
 *  updated decisions so the caller re-derives dismissed state without a GET. With
 *  `pr` the write targets that PR's overlay and the response is the merged effective
 *  view (EE) — mirrors {@link getGuardDecisions}. */
export function dismissGuardClaim(
  repoId: string,
  claim: GuardClaimIdentity & { note?: string },
  pr?: number,
): Promise<GuardDecisions> {
  return fetchApi<GuardDecisions>(`/api/repos/${repoId}/guard/dismiss${guardPrQuery(pr)}`, {
    method: 'POST',
    body: JSON.stringify(claim),
  });
}

/** Dismiss a whole family escalation (item 4) — writes every member's claim dismissal
 *  in one request so the next generate skips them all; returns the updated decisions.
 *  With `pr` the write targets that PR's overlay and returns the merged effective view. */
export function dismissGuardFamily(
  repoId: string,
  members: GuardFamilyMember[],
  pr?: number,
): Promise<GuardDecisions> {
  return fetchApi<GuardDecisions>(`/api/repos/${repoId}/guard/dismiss-family${guardPrQuery(pr)}`, {
    method: 'POST',
    body: JSON.stringify({ members }),
  });
}

/** Reverse a dismissal by its identity; returns the updated decisions. With `pr`
 *  the write targets that PR's overlay and the response is the merged effective view. */
export function undismissGuardClaim(
  repoId: string,
  claim: GuardClaimIdentity,
  pr?: number,
): Promise<GuardDecisions> {
  return fetchApi<GuardDecisions>(`/api/repos/${repoId}/guard/undismiss${guardPrQuery(pr)}`, {
    method: 'POST',
    body: JSON.stringify(claim),
  });
}

// Guard actions — trigger `guard generate` / `guard run` from the dashboard. The
// estimate is the SAME estimateGuardTokens the CLI prompt renders (no re-derive);
// progress streams over `spec:progress` and completes with `spec:complete`
// (`kind: guard-generate | guard-run`).

/** The fast-vs-economical authoring dial (item 5): `economical` batches claims
 *  (cheapest), `fast` authors one claim per call (fastest, ~1.4× cost). */
export type GuardGenerateMode = 'fast' | 'economical';

export interface GuardEstimateResult {
  estimate: LlmEstimateData;
  /** The effective mode this estimate is for — the modal pre-selects it. */
  mode: GuardGenerateMode;
  /** False when `TRUECOURSE_GENERATE_BATCH` forces a fixed batch — hide the choice. */
  canChooseMode: boolean;
}

/** The pre-flight guard-generate estimate. `stages: []` ⇒ nothing changed ⇒ the
 *  client skips the modal and triggers directly. `mode` scopes the authoring
 *  estimate; omitted ⇒ the remembered per-repo choice (economical default). */
export function getGuardEstimate(repoId: string, mode?: GuardGenerateMode): Promise<GuardEstimateResult> {
  const q = mode ? `?mode=${mode}` : '';
  return fetchApi<GuardEstimateResult>(`/api/repos/${repoId}/guard/estimate${q}`);
}

export interface GuardGenerateTriggerResult {
  status?: string;
  noChanges?: boolean;
  written?: number;
  birthFindings?: number;
  /** True when the user declined the estimate — a clean no-op, not an error. */
  cancelled?: boolean;
}

/** Trigger `guard generate`. `confirmed` is the user's answer to the estimate modal
 *  (always true once the modal is confirmed, or when there were no stages); `mode`
 *  is the chosen authoring dial (item 5), remembered per repo. */
export function triggerGuardGenerate(
  repoId: string,
  confirmed: boolean,
  mode?: GuardGenerateMode,
): Promise<GuardGenerateTriggerResult> {
  return fetchApi<GuardGenerateTriggerResult>(`/api/repos/${repoId}/guard/generate`, {
    method: 'POST',
    body: JSON.stringify({ confirmed, ...(mode ? { mode } : {}) }),
  });
}

export interface GuardRunTriggerResult {
  status: string;
  summary?: { total: number; pass: number; fail: number; stale: number; orphaned: number; error: number };
  /** Present on a non-ok status (no recipe / no scenarios / build failure). */
  message?: string;
}

/** Trigger `guard run` — deterministic, LLM-free, no estimate. */
export function triggerGuardRun(repoId: string): Promise<GuardRunTriggerResult> {
  return fetchApi<GuardRunTriggerResult>(`/api/repos/${repoId}/guard/run`, { method: 'POST' });
}

// The optional `scope` on every spec decision mutation is the EE PR view
// (`?pr=&ref=`); in PR scope the server re-curates the PR head and returns the
// fresh corpus. Repo scope is unchanged — no query.
type SpecMutationScope = { pr?: number; ref?: string };

// OSS records the decision and returns a `SpecDecisionAck` (no re-curate); PR scope
// (EE) re-curates and returns the full `SpecCorpusResponse`.

/** Force-include a relevance-dropped doc. */
export function addSpecInclude(repoId: string, ref: string, scope?: SpecMutationScope): Promise<SpecCorpusResponse | SpecDecisionAck> {
  return fetchApi<SpecCorpusResponse | SpecDecisionAck>(`/api/repos/${repoId}/spec/includes${prScopeQuery(scope)}`, {
    method: 'POST',
    body: JSON.stringify({ ref }),
  });
}

/** Remove a force-include override. */
export function removeSpecInclude(repoId: string, ref: string, scope?: SpecMutationScope): Promise<SpecCorpusResponse | SpecDecisionAck> {
  return fetchApi<SpecCorpusResponse | SpecDecisionAck>(`/api/repos/${repoId}/spec/includes${prScopeQuery(scope)}`, {
    method: 'DELETE',
    body: JSON.stringify({ ref }),
  });
}

/** Force-exclude an otherwise-kept doc (drops it + its conflicts on the next Scan). */
export function addSpecExclude(repoId: string, ref: string, scope?: SpecMutationScope): Promise<SpecCorpusResponse | SpecDecisionAck> {
  return fetchApi<SpecCorpusResponse | SpecDecisionAck>(`/api/repos/${repoId}/spec/excludes${prScopeQuery(scope)}`, {
    method: 'POST',
    body: JSON.stringify({ ref }),
  });
}

/** Remove a force-exclude override (restore the doc). */
export function removeSpecExclude(repoId: string, ref: string, scope?: SpecMutationScope): Promise<SpecCorpusResponse | SpecDecisionAck> {
  return fetchApi<SpecCorpusResponse | SpecDecisionAck>(`/api/repos/${repoId}/spec/excludes${prScopeQuery(scope)}`, {
    method: 'DELETE',
    body: JSON.stringify({ ref }),
  });
}

/**
 * Record a section-scoped conflict verdict (pick-a-side / dismissal). OSS returns
 * a `SpecConflictAck` (no re-curate); PR scope (EE) returns the full re-curated corpus.
 */
export function postSpecConflictResolution(
  repoId: string,
  payload: {
    docA: string;
    anchorA: string | null;
    quoteA?: string;
    docB: string;
    anchorB: string | null;
    quoteB?: string;
    verdict: 'a' | 'b' | 'dismissed';
    note?: string;
  },
  scope?: SpecMutationScope,
): Promise<SpecConflictAck | SpecCorpusResponse> {
  return fetchApi<SpecConflictAck | SpecCorpusResponse>(
    `/api/repos/${repoId}/spec/conflict-resolution${prScopeQuery(scope)}`,
    { method: 'POST', body: JSON.stringify(payload) },
  );
}

/** Remove a conflict verdict by dispute identity. Repo scope returns the ack; PR the corpus. */
export function deleteSpecConflictResolution(
  repoId: string,
  payload: { docA: string; anchorA: string | null; docB: string; anchorB: string | null },
  scope?: SpecMutationScope,
): Promise<SpecConflictAck | SpecCorpusResponse> {
  return fetchApi<SpecConflictAck | SpecCorpusResponse>(
    `/api/repos/${repoId}/spec/conflict-resolution${prScopeQuery(scope)}`,
    { method: 'DELETE', body: JSON.stringify(payload) },
  );
}

