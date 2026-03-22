import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { generateText, Output, streamText, type LanguageModel } from 'ai';
import { observe } from '@langfuse/tracing';
import { v4 as uuidv4 } from 'uuid';
import { ClaudeCodeProvider } from './cli-provider.js';
import {
  ServiceViolationOutputSchema,
  DatabaseViolationOutputSchema,
  ModuleViolationOutputSchema,
  DiffViolationOutputSchema,
  LifecycleServiceOutputSchema,
  EnrichmentOutputSchema,
  CodeViolationOutputSchema,
  CodeViolationLifecycleOutputSchema,
  FlowEnrichmentOutputSchema,
} from './schemas.js';
import type { Violation } from '@truecourse/shared';
import { config } from '../../config/index.js';
import {
  getPrompt,
  buildServiceTemplateVars,
  buildDatabaseTemplateVars,
  buildModuleTemplateVars,
  buildCodeTemplateVars,
  buildFlowTemplateVars,
  buildEnrichmentTemplateVars,
  resolveId,
  resolveIds,
  type FlowEnrichmentContext,
  type DeterministicDetectionForEnrichment,
  type PromptIdMap,
} from './prompts.js';

// ---------------------------------------------------------------------------
// Telemetry helper
// ---------------------------------------------------------------------------

const telemetry = (functionId: string, langfusePrompt?: string | null) => ({
  isEnabled: true,
  functionId,
  metadata: langfusePrompt ? { langfusePrompt } : undefined,
});

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

export interface EnrichedDeterministicViolation {
  id: string;
  title: string;
  content: string;
  fixPrompt: string;
}

export interface EnrichmentResult {
  enrichedViolations: EnrichedDeterministicViolation[];
}

export interface DiffViolationsResult {
  resolvedViolationIds: string[];
  newViolations: DiffViolationItem[];
}

// ---------------------------------------------------------------------------
// Common types
// ---------------------------------------------------------------------------

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

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

export interface LLMProvider {
  generateServiceViolations(context: ServiceViolationContext): Promise<ServiceViolationsResult>;
  generateDatabaseViolations(context: DatabaseViolationContext): Promise<DatabaseViolationsResult>;
  generateModuleViolations(context: ModuleViolationContext): Promise<ModuleViolationsResult>;
  generateAllViolations(contexts: AllViolationsInput): Promise<AllViolationsResult>;
  generateAllViolationsWithLifecycle(contexts: AllViolationsInput, onStepComplete?: (step: string) => void): Promise<AllViolationsLifecycleResult>;
  generateCodeViolations(context: CodeViolationContext): Promise<CodeViolationsResult>;
  generateAllCodeViolations(batches: CodeViolationContext[]): Promise<CodeViolationsResult>;
  enrichDeterministicViolations(detections: DeterministicDetectionForEnrichment[], architectureContext: string): Promise<EnrichmentResult>;
  enrichFlow(context: FlowEnrichmentContext): Promise<FlowEnrichmentResult>;
  chat(messages: ChatMessage[], systemPrompt: string): AsyncGenerator<string>;
}

// ---------------------------------------------------------------------------
// Model configuration
// ---------------------------------------------------------------------------

const DEFAULT_MODELS: Record<string, string> = {
  openai: 'gpt-5-mini',
  anthropic: 'claude-haiku-4-5-20251001',
};

const MODEL_CONFIG: Record<string, { provider: (model: string) => LanguageModel }> = {
  openai: {
    provider: (model) => {
      const openai = createOpenAI({ apiKey: config.openaiApiKey });
      return openai(model);
    },
  },
  anthropic: {
    provider: (model) => {
      const anthropic = createAnthropic({ apiKey: config.anthropicApiKey });
      return anthropic(model);
    },
  },
};

function getModel(): LanguageModel {
  const providerConfig = MODEL_CONFIG[config.llmProvider];
  if (!providerConfig) {
    throw new Error(`Unknown LLM provider: ${config.llmProvider}`);
  }
  const model = config.llmModel || DEFAULT_MODELS[config.llmProvider];
  return providerConfig.provider(model);
}

// ---------------------------------------------------------------------------
// Unified provider using Vercel AI SDK
// ---------------------------------------------------------------------------

class AISDKProvider implements LLMProvider {
  async generateServiceViolations(context: ServiceViolationContext): Promise<ServiceViolationsResult> {
    const { vars, idMap } = buildServiceTemplateVars(context);
    const { text: prompt, langfusePrompt } = await getPrompt('violations-service', vars);
    const model = getModel();

    console.log('[LLM] Service violations call starting...');
    const t0 = Date.now();
    const { output: object } = await generateText({
      model,
      output: Output.object({ schema: ServiceViolationOutputSchema }),
      prompt,
      experimental_telemetry: telemetry('violations-service', langfusePrompt),
    });
    console.log(`[LLM] Service violations call done in ${Date.now() - t0}ms — ${object.violations.length} violations`);

    return {
      violations: object.violations.map((v) => ({
        id: uuidv4(),
        type: v.type,
        title: v.title,
        content: v.content,
        severity: v.severity,
        targetServiceId: resolveId(v.targetServiceId, idMap) ?? undefined,
        fixPrompt: v.fixPrompt ?? undefined,
        ruleKey: v.ruleKey ?? undefined,
        createdAt: new Date().toISOString(),
      })),
      serviceDescriptions: object.serviceDescriptions.map((d) => ({
        id: resolveId(d.id, idMap) || d.id,
        description: d.description,
      })),
    };
  }

  async generateDatabaseViolations(context: DatabaseViolationContext): Promise<DatabaseViolationsResult> {
    const { vars, idMap } = buildDatabaseTemplateVars(context);
    const { text: prompt, langfusePrompt } = await getPrompt('violations-database', vars);
    const model = getModel();

    console.log('[LLM] Database violations call starting...');
    const t0 = Date.now();
    const { output: object } = await generateText({
      model,
      output: Output.object({ schema: DatabaseViolationOutputSchema }),
      prompt,
      experimental_telemetry: telemetry('violations-database', langfusePrompt),
    });
    console.log(`[LLM] Database violations call done in ${Date.now() - t0}ms — ${object.violations.length} violations`);

    return {
      violations: object.violations.map((v) => ({
        id: uuidv4(),
        type: v.type,
        title: v.title,
        content: v.content,
        severity: v.severity,
        targetDatabaseId: resolveId(v.targetDatabaseId, idMap) ?? undefined,
        targetTable: v.targetTable ?? undefined,
        fixPrompt: v.fixPrompt ?? undefined,
        ruleKey: v.ruleKey ?? undefined,
        createdAt: new Date().toISOString(),
      })),
    };
  }

  async generateModuleViolations(context: ModuleViolationContext): Promise<ModuleViolationsResult> {
    const { vars, idMap } = buildModuleTemplateVars(context);
    const { text: prompt, langfusePrompt } = await getPrompt('violations-module', vars);
    const model = getModel();

    // Build moduleId → serviceId lookup from context
    const moduleIdToServiceId = new Map(
      context.modules.filter((m) => m.serviceId).map((m) => [m.id, m.serviceId!]),
    );

    console.log('[LLM] Module violations call starting...');
    const t0 = Date.now();
    const { output: object } = await generateText({
      model,
      output: Output.object({ schema: ModuleViolationOutputSchema }),
      prompt,
      experimental_telemetry: telemetry('violations-module', langfusePrompt),
    });
    console.log(`[LLM] Module violations call done in ${Date.now() - t0}ms — ${object.violations.length} violations`);

    return {
      violations: object.violations.map((v) => {
        const targetModuleId = resolveId(v.targetModuleId, idMap) ?? undefined;
        const targetServiceId = targetModuleId ? moduleIdToServiceId.get(targetModuleId) : undefined;
        return {
          id: uuidv4(),
          type: v.type,
          title: v.title,
          content: v.content,
          severity: v.severity,
          targetServiceId,
          targetModuleId,
          targetMethodId: resolveId(v.targetMethodId, idMap) ?? undefined,
          fixPrompt: v.fixPrompt ?? undefined,
          ruleKey: v.ruleKey ?? undefined,
          createdAt: new Date().toISOString(),
        };
      }),
    };
  }

  generateAllViolations = observe(
    async (contexts: AllViolationsInput): Promise<AllViolationsResult> => {
      const onStepComplete = contexts.onStepComplete;
      const promises: [string, Promise<unknown>][] = [];

      if (contexts.service) {
        promises.push(['service', this.generateServiceViolations(contexts.service)]);
      }
      if (contexts.database) {
        promises.push(['database', this.generateDatabaseViolations(contexts.database)]);
      }
      if (contexts.module) {
        promises.push(['module', this.generateModuleViolations(contexts.module)]);
      }

      const stepLabels: Record<string, string> = {
        service: 'Service architecture checks done',
        database: 'Database schema checks done',
        module: 'Module & function checks done',
      };

      const settled = await Promise.allSettled(promises.map(([key, p]) =>
        p.then((v) => { onStepComplete?.(stepLabels[key] || `${key} done`); return v; })
      ));

      const result: AllViolationsResult = {};
      for (let i = 0; i < promises.length; i++) {
        const [key] = promises[i];
        const outcome = settled[i];
        if (outcome.status === 'fulfilled') {
          (result as Record<string, unknown>)[key] = outcome.value;
        } else {
          console.error(`[Violations] ${key} call failed:`, outcome.reason);
        }
      }

      return result;
    },
    { name: 'generate-all-violations' },
  );

  /**
   * Full analysis with lifecycle tracking — uses dedicated lifecycle prompts
   * that compare against existing violations to produce new + resolved results.
   */
  generateAllViolationsWithLifecycle = observe(
    async (contexts: AllViolationsInput, onStepComplete?: (step: string) => void): Promise<AllViolationsLifecycleResult> => {
      const model = getModel();
      const allResolved: string[] = [];
      const allNew: DiffViolationItem[] = [];
      let serviceDescriptions: ServiceDescription[] = [];

      const promises: [string, Promise<unknown>][] = [];
      const idMaps: Record<string, PromptIdMap> = {};

      // Service call
      if (contexts.service) {
        const ctx = contexts.service;
        if (ctx.existingViolations && ctx.existingViolations.length > 0) {
          promises.push(['service', (async () => {
            const { vars, idMap } = buildServiceTemplateVars(ctx);
            idMaps.service = idMap;
            const { text: prompt, langfusePrompt } = await getPrompt('violations-service-lifecycle', vars);
            console.log('[LLM] Lifecycle service call starting...');
            const t0 = Date.now();
            const { output: object } = await generateText({
              model,
              output: Output.object({ schema: LifecycleServiceOutputSchema }),
              prompt,
              experimental_telemetry: telemetry('violations-service-lifecycle', langfusePrompt),
            });
            console.log(`[LLM] Lifecycle service call done in ${Date.now() - t0}ms — resolved: ${object.resolvedViolationIds.length}, new: ${object.newViolations.length}`);
            return object;
          })()]);
        } else {
          promises.push(['service-normal', this.generateServiceViolations(ctx)]);
        }
      }

      // Database call
      if (contexts.database) {
        const ctx = contexts.database;
        if (ctx.existingViolations && ctx.existingViolations.length > 0) {
          promises.push(['database', (async () => {
            const { vars, idMap } = buildDatabaseTemplateVars(ctx);
            idMaps.database = idMap;
            const { text: prompt, langfusePrompt } = await getPrompt('violations-database-lifecycle', vars);
            console.log('[LLM] Lifecycle database call starting...');
            const t0 = Date.now();
            const { output: object } = await generateText({
              model,
              output: Output.object({ schema: DiffViolationOutputSchema }),
              prompt,
              experimental_telemetry: telemetry('violations-database-lifecycle', langfusePrompt),
            });
            console.log(`[LLM] Lifecycle database call done in ${Date.now() - t0}ms — resolved: ${object.resolvedViolationIds.length}, new: ${object.newViolations.length}`);
            return object;
          })()]);
        } else {
          promises.push(['database-normal', this.generateDatabaseViolations(ctx)]);
        }
      }

      // Module call
      if (contexts.module) {
        const ctx = contexts.module;
        if (ctx.existingViolations && ctx.existingViolations.length > 0) {
          const modIdToSvcId = new Map(
            ctx.modules.filter((m) => m.serviceId).map((m) => [m.id, m.serviceId!]),
          );
          promises.push(['module', (async () => {
            const { vars, idMap } = buildModuleTemplateVars(ctx);
            idMaps.module = idMap;
            const { text: prompt, langfusePrompt } = await getPrompt('violations-module-lifecycle', vars);
            console.log('[LLM] Lifecycle module call starting...');
            const t0 = Date.now();
            const { output: object } = await generateText({
              model,
              output: Output.object({ schema: DiffViolationOutputSchema }),
              prompt,
              experimental_telemetry: telemetry('violations-module-lifecycle', langfusePrompt),
            });
            console.log(`[LLM] Lifecycle module call done in ${Date.now() - t0}ms — resolved: ${object.resolvedViolationIds.length}, new: ${object.newViolations.length}`);
            return {
              resolvedViolationIds: resolveIds(object.resolvedViolationIds, idMap),
              newViolations: object.newViolations.map((i) => {
                const realModuleId = resolveId(i.targetModuleId, idMap);
                return {
                  ...i,
                  targetServiceId: (realModuleId ? modIdToSvcId.get(realModuleId) : null) ?? null,
                  targetModuleId: realModuleId ?? null,
                  targetMethodId: resolveId(i.targetMethodId, idMap) ?? null,
                  targetModuleName: i.targetModuleName ?? null,
                  targetMethodName: i.targetMethodName ?? null,
                };
              }),
            };
          })()]);
        } else {
          promises.push(['module-normal', this.generateModuleViolations(ctx)]);
        }
      }

      const stepLabels: Record<string, string> = {
        service: 'Service checks done',
        'service-normal': 'Service checks done',
        database: 'Database checks done',
        'database-normal': 'Database checks done',
        module: 'Module checks done',
        'module-normal': 'Module checks done',
      };

      const settled = await Promise.allSettled(promises.map(([key, p]) =>
        p.then((v) => { onStepComplete?.(stepLabels[key] || `${key} done`); return v; })
      ));

      for (let i = 0; i < promises.length; i++) {
        const [key] = promises[i];
        const outcome = settled[i];
        if (outcome.status !== 'fulfilled') {
          console.error(`[ViolationsLifecycle] ${key} call failed:`, outcome.reason);
          continue;
        }

        if (key === 'service') {
          const idMap = idMaps.service;
          const result = outcome.value as { resolvedViolationIds: string[]; newViolations: DiffViolationItem[]; serviceDescriptions: ServiceDescription[] };
          allResolved.push(...resolveIds(result.resolvedViolationIds, idMap));
          allNew.push(...result.newViolations.map((v) => ({
            ...v,
            targetServiceId: resolveId(v.targetServiceId, idMap) ?? null,
            targetModuleId: v.targetModuleId ?? null,
            targetMethodId: v.targetMethodId ?? null,
            targetServiceName: v.targetServiceName ?? null,
            targetModuleName: v.targetModuleName ?? null,
            targetMethodName: v.targetMethodName ?? null,
          })));
          serviceDescriptions = result.serviceDescriptions.map((d) => ({
            id: resolveId(d.id, idMap) || d.id,
            description: d.description,
          }));
        } else if (key === 'service-normal') {
          const result = outcome.value as ServiceViolationsResult;
          serviceDescriptions = result.serviceDescriptions;
          for (const v of result.violations) {
            allNew.push({
              type: v.type, title: v.title, content: v.content, severity: v.severity,
              targetServiceId: v.targetServiceId ?? null, targetModuleId: v.targetModuleId ?? null,
              targetMethodId: v.targetMethodId ?? null, targetServiceName: null,
              targetModuleName: null, targetMethodName: null, fixPrompt: v.fixPrompt ?? null,
              ruleKey: (v as Violation).ruleKey || 'unknown',
            });
          }
        } else if (key === 'database') {
          const idMap = idMaps.database;
          const result = outcome.value as DiffViolationsResult;
          allResolved.push(...resolveIds(result.resolvedViolationIds, idMap));
          allNew.push(...result.newViolations.map((v) => ({
            ...v,
            targetServiceId: v.targetServiceId ?? null,
            targetModuleId: v.targetModuleId ?? null,
            targetMethodId: v.targetMethodId ?? null,
            targetServiceName: v.targetServiceName ?? null,
            targetModuleName: v.targetModuleName ?? null,
            targetMethodName: v.targetMethodName ?? null,
          })));
        } else if (key === 'module') {
          // Module lifecycle — IDs already resolved inside the promise
          const result = outcome.value as DiffViolationsResult;
          allResolved.push(...result.resolvedViolationIds);
          allNew.push(...result.newViolations.map((v) => ({
            ...v,
            targetServiceId: v.targetServiceId ?? null,
            targetModuleId: v.targetModuleId ?? null,
            targetMethodId: v.targetMethodId ?? null,
            targetServiceName: v.targetServiceName ?? null,
            targetModuleName: v.targetModuleName ?? null,
            targetMethodName: v.targetMethodName ?? null,
          })));
        } else {
          // Normal database/module result — IDs already resolved by generate methods
          const result = outcome.value as DatabaseViolationsResult | ModuleViolationsResult;
          for (const v of result.violations) {
            allNew.push({
              type: v.type, title: v.title, content: v.content, severity: v.severity,
              targetServiceId: (v as Violation).targetServiceId ?? null,
              targetModuleId: (v as Violation).targetModuleId ?? null,
              targetMethodId: (v as Violation).targetMethodId ?? null,
              targetServiceName: null, targetModuleName: null, targetMethodName: null,
              fixPrompt: (v as Violation).fixPrompt ?? null,
              ruleKey: (v as Violation).ruleKey || 'unknown',
            });
          }
        }
      }

      return { resolvedViolationIds: allResolved, newViolations: allNew, serviceDescriptions };
    },
    { name: 'generate-all-violations-lifecycle' },
  );

  async generateCodeViolations(context: CodeViolationContext): Promise<CodeViolationsResult> {
    const model = getModel();
    const hasExisting = context.existingViolations && context.existingViolations.length > 0;
    const promptName = hasExisting ? 'violations-code-lifecycle' : 'violations-code';
    const { vars, idMap } = buildCodeTemplateVars(context);
    const { text: prompt, langfusePrompt } = await getPrompt(promptName, vars);

    console.log(`[LLM] Code violations call starting (${context.files.length} files, ${hasExisting ? 'lifecycle' : 'first-run'})...`);
    const t0 = Date.now();

    if (hasExisting) {
      const { output: object } = await generateText({
        model,
        output: Output.object({ schema: CodeViolationLifecycleOutputSchema }),
        prompt,
        experimental_telemetry: telemetry('violations-code-lifecycle', langfusePrompt),
      });
      console.log(`[LLM] Code violations call done in ${Date.now() - t0}ms — new: ${object.newViolations.length}, resolved: ${object.resolvedViolationIds.length}, unchanged: ${object.unchangedViolationIds.length}`);

      return {
        violations: object.newViolations.map((v) => ({
          ruleKey: v.ruleKey,
          filePath: v.filePath,
          lineStart: v.lineStart,
          lineEnd: v.lineEnd,
          severity: v.severity,
          title: v.title,
          content: v.content,
          fixPrompt: v.fixPrompt ?? null,
        })),
        resolvedViolationIds: resolveIds(object.resolvedViolationIds, idMap),
        unchangedViolationIds: resolveIds(object.unchangedViolationIds, idMap),
      };
    }

    const { output: object } = await generateText({
      model,
      output: Output.object({ schema: CodeViolationOutputSchema }),
      prompt,
      experimental_telemetry: telemetry('violations-code', langfusePrompt),
    });
    console.log(`[LLM] Code violations call done in ${Date.now() - t0}ms — ${object.violations.length} violations`);

    return {
      violations: object.violations.map((v) => ({
        ruleKey: v.ruleKey,
        filePath: v.filePath,
        lineStart: v.lineStart,
        lineEnd: v.lineEnd,
        severity: v.severity,
        title: v.title,
        content: v.content,
        fixPrompt: v.fixPrompt ?? null,
      })),
    };
  }

  generateAllCodeViolations = observe(
    async (batches: CodeViolationContext[]): Promise<CodeViolationsResult> => {
      if (batches.length === 0) return { violations: [] };

      console.log(`[LLM] Code violations: ${batches.length} batch(es) starting...`);
      const t0 = Date.now();

      const results = await Promise.allSettled(
        batches.map((batch) => this.generateCodeViolations(batch))
      );

      const allViolations: CodeViolationRaw[] = [];
      const allResolved: string[] = [];
      const allUnchanged: string[] = [];
      for (const result of results) {
        if (result.status === 'fulfilled') {
          allViolations.push(...result.value.violations);
          if (result.value.resolvedViolationIds) allResolved.push(...result.value.resolvedViolationIds);
          if (result.value.unchangedViolationIds) allUnchanged.push(...result.value.unchangedViolationIds);
        } else {
          console.error('[CodeViolations] Batch call failed:', result.reason);
        }
      }

      console.log(`[LLM] Code violations total: ${Date.now() - t0}ms — new: ${allViolations.length}, resolved: ${allResolved.length}, unchanged: ${allUnchanged.length}`);
      return {
        violations: allViolations,
        resolvedViolationIds: allResolved.length > 0 ? allResolved : undefined,
        unchangedViolationIds: allUnchanged.length > 0 ? allUnchanged : undefined,
      };
    },
    { name: 'generate-all-code-violations' },
  );

  async enrichDeterministicViolations(
    detections: DeterministicDetectionForEnrichment[],
    architectureContext: string,
  ): Promise<EnrichmentResult> {
    if (detections.length === 0) return { enrichedViolations: [] };

    const { vars, idMap } = buildEnrichmentTemplateVars(detections, architectureContext);
    const { text: prompt, langfusePrompt } = await getPrompt('violations-enrich-deterministic', vars);
    const model = getModel();

    console.log(`[LLM] Enrichment call starting for ${detections.length} detections...`);
    const t0 = Date.now();
    const { output: object } = await generateText({
      model,
      output: Output.object({ schema: EnrichmentOutputSchema }),
      prompt,
      experimental_telemetry: telemetry('violations-enrich-deterministic', langfusePrompt),
    });
    console.log(`[LLM] Enrichment call done in ${Date.now() - t0}ms — ${object.enrichedViolations.length} enriched`);

    return {
      enrichedViolations: object.enrichedViolations.map((e) => ({
        ...e,
        id: resolveId(e.id, idMap) || e.id,
      })),
    };
  }

  async enrichFlow(context: FlowEnrichmentContext): Promise<FlowEnrichmentResult> {
    const { text: prompt, langfusePrompt } = await getPrompt('flow-enrichment', buildFlowTemplateVars(context));
    const model = getModel();

    console.log(`[LLM] Flow enrichment call starting for ${context.flowName}...`);
    const t0 = Date.now();
    const { output: object } = await generateText({
      model,
      output: Output.object({ schema: FlowEnrichmentOutputSchema }),
      prompt,
      experimental_telemetry: telemetry('flow-enrichment', langfusePrompt),
    });
    console.log(`[LLM] Flow enrichment done in ${Date.now() - t0}ms`);

    return {
      name: object.name,
      description: object.description,
      stepDescriptions: object.stepDescriptions,
    };
  }

  async *chat(
    messages: ChatMessage[],
    systemPrompt: string
  ): AsyncGenerator<string> {
    const model = getModel();

    const { textStream } = streamText({
      model,
      system: systemPrompt,
      messages: messages.map((m) => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
      })),
      experimental_telemetry: telemetry('chat'),
    });

    for await (const chunk of textStream) {
      yield chunk;
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createLLMProvider(): LLMProvider {
  if (config.llmProvider === 'claude-code') {
    return new ClaudeCodeProvider();
  }
  return new AISDKProvider();
}
