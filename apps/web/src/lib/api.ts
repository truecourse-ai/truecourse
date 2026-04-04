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

export type ChatMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
};

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

export function analyzeRepo(id: string, options?: { branch?: string }): Promise<{ jobId: string }> {
  return fetchApi<{ jobId: string }>(`/api/repos/${id}/analyze`, {
    method: 'POST',
    body: JSON.stringify({ branch: options?.branch }),
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
  return fetchApi(`/api/repos/${repoId}/analyze/cancel`, { method: 'POST' });
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
export type AllLevelGraphResponse = {
  services: Array<{
    id: string;
    name: string;
    type: string;
    framework: string | null;
    fileCount: number;
    description: string | null;
    rootPath: string;
    layers: string[];
  }>;
  layers: Array<{
    id: string;
    serviceId: string;
    layer: string;
    fileCount: number;
    filePaths: string[];
    layerColor: string;
  }>;
  directories: Array<{
    id: string;
    serviceId: string;
    layerId: string;
    dirPath: string;
    moduleCount: number;
    violationCount: number;
  }>;
  modules: Array<{
    id: string;
    serviceId: string;
    layerId: string;
    directoryId: string;
    name: string;
    kind: string;
    filePath: string;
    methodCount: number;
    layerColor: string;
  }>;
  methods: Array<{
    id: string;
    moduleId: string;
    name: string;
    signature: string;
    isAsync: boolean;
    isExported: boolean;
    lineCount: number | null;
  }>;
  edges: {
    service: Array<{ id: string; source: string; target: string; count: number; type: string | null }>;
    module: Array<{ id: string; source: string; target: string; count: number }>;
    method: Array<{ id: string; source: string; target: string; count: number }>;
  };
  databases: Array<{
    id: string;
    name: string;
    type: string;
    driver: string;
    tableCount: number;
  }>;
  dbConnections: Array<{
    serviceId: string;
    databaseId: string;
    driver: string;
  }>;
  violations: Array<{
    id: string;
    ruleKey: string;
    category: string;
    title: string;
    severity: string;
    serviceName: string;
    moduleName: string | null;
  }>;
};

export function getGraphAll(
  repoId: string,
  options?: { branch?: string; analysisId?: string },
): Promise<AllLevelGraphResponse> {
  const params = new URLSearchParams();
  params.set('level', 'all');
  if (options?.branch) params.set('branch', options.branch);
  if (options?.analysisId) params.set('analysisId', options.analysisId);
  return fetchApi<AllLevelGraphResponse>(`/api/repos/${repoId}/graph?${params.toString()}`);
}

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

export function getDatabases(repoId: string, branch?: string): Promise<DatabaseResponse[]> {
  const params = branch ? `?branch=${encodeURIComponent(branch)}` : '';
  return fetchApi<DatabaseResponse[]>(`/api/repos/${repoId}/databases${params}`);
}

export function getDatabaseSchema(repoId: string, dbId: string): Promise<DatabaseSchemaResponse> {
  return fetchApi<DatabaseSchemaResponse>(`/api/repos/${repoId}/databases/${dbId}/schema`);
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

export function getRules(): Promise<RuleResponse[]> {
  return fetchApi<RuleResponse[]>('/api/rules');
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

export function runDiffCheck(repoId: string): Promise<DiffCheckResponse> {
  return fetchApi<DiffCheckResponse>(`/api/repos/${repoId}/diff-check`, {
    method: 'POST',
  });
}

export function getDiffCheck(repoId: string): Promise<DiffCheckResponse | null> {
  return fetchApi<DiffCheckResponse | null>(`/api/repos/${repoId}/diff-check`);
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
    `/api/repos/${repoId}/code-violations${qs ? `?${qs}` : ''}`,
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
    `/api/repos/${repoId}/code-violations/summary${qs ? `?${qs}` : ''}`,
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

export function getFlows(repoId: string): Promise<FlowListResponse> {
  return fetchApi<FlowListResponse>(`/api/repos/${repoId}/flows`);
}

export function getFlow(repoId: string, flowId: string): Promise<FlowDetailResponse> {
  return fetchApi<FlowDetailResponse>(`/api/repos/${repoId}/flows/${flowId}`);
}

export function enrichFlow(repoId: string, flowId: string): Promise<FlowDetailResponse> {
  return fetchApi<FlowDetailResponse>(`/api/repos/${repoId}/flows/${flowId}/enrich`, {
    method: 'POST',
  });
}

// Conversations
export type ConversationSummary = {
  id: string;
  createdAt: string;
  updatedAt: string;
  preview: string;
};

export type ConversationHistory = {
  conversation: { id: string; repoId: string; createdAt: string; updatedAt: string };
  messages: Array<{
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    createdAt: string;
  }>;
};

export function getConversations(repoId: string): Promise<ConversationSummary[]> {
  return fetchApi<ConversationSummary[]>(`/api/repos/${repoId}/conversations`);
}

export function getConversationHistory(repoId: string, conversationId: string): Promise<ConversationHistory> {
  return fetchApi<ConversationHistory>(`/api/repos/${repoId}/chat/${conversationId}`);
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
  byType: Record<string, number>;
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

export function getAnalyticsTrend(repoId: string, branch?: string, limit?: number): Promise<TrendResponse> {
  const params = new URLSearchParams();
  if (branch) params.set('branch', branch);
  if (limit) params.set('limit', String(limit));
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

export function getAnalyticsResolution(repoId: string, branch?: string): Promise<ResolutionResponse> {
  const params = branch ? `?branch=${encodeURIComponent(branch)}` : '';
  return fetchApi<ResolutionResponse>(`/api/repos/${repoId}/analytics/resolution${params}`);
}

// Chat (SSE streaming)
export function streamChat(
  repoId: string,
  message: string,
  onChunk: (text: string) => void,
  onDone: (conversationId?: string) => void,
  onError: (error: Error) => void,
  options?: { nodeContext?: unknown; conversationId?: string },
): AbortController {
  const controller = new AbortController();
  const url = `${BASE_URL}/api/repos/${repoId}/chat`;

  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      nodeContext: options?.nodeContext,
      conversationId: options?.conversationId,
    }),
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok) {
        throw new ApiError(res.status, await res.text());
      }
      const convId = res.headers.get('X-Conversation-Id') || undefined;
      const reader = res.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              onDone(convId);
              return;
            }
            try {
              const parsed = JSON.parse(data);
              if (parsed.content) {
                onChunk(parsed.content);
              }
            } catch {
              onChunk(data);
            }
          }
        }
      }
      onDone(convId);
    })
    .catch((err) => {
      if (err.name !== 'AbortError') {
        onError(err);
      }
    });

  return controller;
}
