import type { Violation } from '@truecourse/shared';
import { ClaudeCodeProvider } from './cli-provider.js';
import type { FlowEnrichmentContext } from './prompts.js';

// ---------------------------------------------------------------------------
// Focused violation context types (one per LLM call)
// ---------------------------------------------------------------------------

export interface ServiceViolationContext {
  architecture: string;
  services: {
    id: string;
    name: string;
    type: string;
    framework?: string;
    fileCount: number;
    layers: string[];
  }[];
  dependencies: {
    source: string;
    target: string;
    count: number;
    type?: string;
  }[];
  llmRules: { key: string; name: string; severity: string; prompt: string }[];
  /** When provided, switches to diff prompt/schema to produce lifecycle results */
  existingViolations?: ExistingViolation[];
}

export interface DatabaseViolationContext {
  databases: {
    id: string;
    name: string;
    type: string;
    driver: string;
    tableCount: number;
    connectedServices: string[];
    tables?: {
      name: string;
      columns: { name: string; type: string; isNullable?: boolean; isPrimaryKey?: boolean; isForeignKey?: boolean; referencesTable?: string }[];
    }[];
    relations?: { sourceTable: string; targetTable: string; foreignKeyColumn: string }[];
  }[];
  llmRules: { key: string; name: string; severity: string; prompt: string }[];
  /** When provided, switches to diff prompt/schema to produce lifecycle results */
  existingViolations?: ExistingViolation[];
}

export interface ModuleViolationContext {
  modules: {
    id: string;
    name: string;
    kind: string;
    serviceId?: string;
    serviceName: string;
    layerName: string;
    methodCount: number;
    propertyCount: number;
    importCount: number;
    exportCount: number;
    superClass?: string;
    lineCount?: number;
  }[];
  methods: {
    id?: string;
    moduleName: string;
    name: string;
    signature: string;
    paramCount: number;
    returnType?: string;
    isAsync: boolean;
    lineCount?: number;
    statementCount?: number;
    maxNestingDepth?: number;
  }[];
  moduleDependencies: {
    sourceModule: string;
    targetModule: string;
    importedNames: string[];
  }[];
  methodDependencies: {
    callerMethod: string;
    callerModule: string;
    calleeMethod: string;
    calleeModule: string;
    callCount: number;
  }[];
  llmRules: { key: string; name: string; severity: string; prompt: string }[];
  /** When provided, switches to diff prompt/schema to produce lifecycle results */
  existingViolations?: ExistingViolation[];
}

// ---------------------------------------------------------------------------
// Diff violation context types (extend normal contexts with existing violations)
// ---------------------------------------------------------------------------

export interface ExistingViolation {
  id: string;
  type: string;
  title: string;
  content: string;
  severity: string;
}

export interface CodeViolationContext {
  files: { path: string; content: string }[];
  llmRules: { key: string; name: string; severity: string; prompt: string }[];
  /** Context tier — determines which prompt template to use */
  tier?: 'metadata' | 'targeted' | 'full-file';
  /** Previous code violations for lifecycle comparison */
  existingViolations?: {
    id: string;
    filePath: string;
    lineStart: number;
    lineEnd: number;
    ruleKey: string;
    severity: string;
    title: string;
    content: string;
  }[];
}

export interface CodeViolationRaw {
  ruleKey: string;
  filePath: string;
  lineStart: number;
  lineEnd: number;
  severity: string;
  title: string;
  content: string;
  fixPrompt: string | null;
}

export interface CodeViolationsResult {
  violations: CodeViolationRaw[];
  resolvedViolationIds?: string[];
  unchangedViolationIds?: string[];
}

export interface DiffViolationItem {
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
  ruleKey: string;
}

export interface DiffViolationsResult {
  resolvedViolationIds: string[];
  newViolations: DiffViolationItem[];
}

// ---------------------------------------------------------------------------
// Common types
// ---------------------------------------------------------------------------

export interface ServiceDescription {
  id: string;
  description: string;
}

export interface ViolationsResult {
  violations: Violation[];
  serviceDescriptions: ServiceDescription[];
}

export interface ServiceViolationsResult {
  violations: Violation[];
  serviceDescriptions: ServiceDescription[];
}

export interface DatabaseViolationsResult {
  violations: Violation[];
}

export interface ModuleViolationsResult {
  violations: Violation[];
}

export interface AllViolationsInput {
  service?: ServiceViolationContext;
  database?: DatabaseViolationContext;
  module?: ModuleViolationContext;
  onStepComplete?: (step: string) => void;
}

export interface AllViolationsResult {
  service?: ServiceViolationsResult;
  database?: DatabaseViolationsResult;
  module?: ModuleViolationsResult;
}

/** Result when existing violations are provided — lifecycle mode */
export interface AllViolationsLifecycleResult {
  resolvedViolationIds: string[];
  newViolations: DiffViolationItem[];
  serviceDescriptions: ServiceDescription[];
}

export interface FlowEnrichmentResult {
  name: string;
  description: string;
  stepDescriptions: { stepOrder: number; dataDescription: string }[];
}

export interface UsageRecord {
  provider: string;
  callType: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens: number;
  costUsd?: string;
  durationMs: number;
}

export interface LLMProvider {
  generateServiceViolations(context: ServiceViolationContext): Promise<ServiceViolationsResult>;
  generateDatabaseViolations(context: DatabaseViolationContext): Promise<DatabaseViolationsResult>;
  generateModuleViolations(context: ModuleViolationContext): Promise<ModuleViolationsResult>;
  generateAllViolations(contexts: AllViolationsInput): Promise<AllViolationsResult>;
  generateAllViolationsWithLifecycle(contexts: AllViolationsInput, onStepComplete?: (step: string) => void): Promise<AllViolationsLifecycleResult>;
  generateCodeViolations(context: CodeViolationContext): Promise<CodeViolationsResult>;
  generateAllCodeViolations(batches: CodeViolationContext[]): Promise<CodeViolationsResult>;
  enrichFlow(context: FlowEnrichmentContext): Promise<FlowEnrichmentResult>;
  setAnalysisId(id: string): void;
  setRepoId(repoId: string): void;
  setRepoPath(path: string): void;
  setAbortSignal(signal: AbortSignal): void;
  flushUsage(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Factory — Claude Code CLI is the only supported provider.
// ---------------------------------------------------------------------------

export function createLLMProvider(): LLMProvider {
  return new ClaudeCodeProvider();
}
