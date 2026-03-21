import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { generateText, Output, streamText, type LanguageModel } from 'ai';
import { observe } from '@langfuse/tracing';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import type { Violation } from '@truecourse/shared';
import { config } from '../../config/index.js';
import {
  getPrompt,
  buildServiceTemplateVars,
  buildDatabaseTemplateVars,
  buildModuleTemplateVars,
  buildCodeTemplateVars,
  buildFlowTemplateVars,
  type FlowEnrichmentContext,
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
  llmRules: { name: string; severity: string; prompt: string }[];
  /** Service deterministic violations (e.g. circular dependency, god service) */
  violations?: {
    ruleKey: string;
    title: string;
    description: string;
    severity: string;
    serviceName: string;
    deterministicViolationId?: string;
  }[];
  /** When provided, switches to diff prompt/schema to produce lifecycle results */
  existingViolations?: ExistingViolation[];
  /** Previous deterministic service violations for lifecycle comparison */
  baselineViolations?: string[];
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
  llmRules: { name: string; severity: string; prompt: string }[];
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
  llmRules: { name: string; severity: string; prompt: string }[];
  violations?: {
    ruleKey: string;
    title: string;
    description: string;
    severity: string;
    serviceName: string;
    serviceId?: string;
    moduleName?: string;
    moduleId?: string;
    methodName?: string;
    methodId?: string;
    deterministicViolationId?: string;
  }[];
  /** When provided, switches to diff prompt/schema to produce lifecycle results */
  existingViolations?: ExistingViolation[];
  /** Previous deterministic module violations for lifecycle comparison */
  baselineViolations?: string[];
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
  llmRules: { name: string; severity: string; prompt: string }[];
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
  ruleName: string;
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
  deterministicViolationId: string | null;
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
  generateAllViolationsWithLifecycle(contexts: AllViolationsInput): Promise<AllViolationsLifecycleResult>;
  generateCodeViolations(context: CodeViolationContext): Promise<CodeViolationsResult>;
  generateAllCodeViolations(batches: CodeViolationContext[]): Promise<CodeViolationsResult>;
  enrichFlow(context: FlowEnrichmentContext): Promise<FlowEnrichmentResult>;
  chat(messages: ChatMessage[], systemPrompt: string): AsyncGenerator<string>;
}

// ---------------------------------------------------------------------------
// Zod schemas — scoped per call to prevent ID mixing
// ---------------------------------------------------------------------------

const ServiceViolationOutputSchema = z.object({
  violations: z.array(
    z.object({
      type: z.literal('service'),
      title: z.string(),
      content: z.string(),
      severity: z.enum(['low', 'medium', 'high', 'critical']),
      targetServiceId: z.string().nullable().describe('The id of the service this violation applies to, must be an exact id from the Services list'),
      fixPrompt: z.string().nullable(),
    })
  ),
  serviceDescriptions: z.array(
    z.object({
      id: z.string().describe('The service id, must be an exact id from the Services list'),
      description: z.string().describe('A concise 1-2 sentence description of what this service does'),
    })
  ),
});

const DatabaseViolationOutputSchema = z.object({
  violations: z.array(
    z.object({
      type: z.literal('database'),
      title: z.string(),
      content: z.string(),
      severity: z.enum(['low', 'medium', 'high', 'critical']),
      targetDatabaseId: z.string().nullable().describe('The id of the database this violation applies to, must be an exact id from the Databases list'),
      targetTable: z.string().nullable().describe('The exact table name this violation applies to'),
      fixPrompt: z.string().nullable(),
    })
  ),
});

const ModuleViolationOutputSchema = z.object({
  violations: z.array(
    z.object({
      type: z.enum(['module', 'function']).describe('Use "function" when the violation targets a specific function/method, use "module" when it targets the module/class itself'),
      title: z.string(),
      content: z.string(),
      severity: z.enum(['low', 'medium', 'high', 'critical']),
      targetModuleId: z.string().nullable().describe('The id of the module this violation applies to, must be an exact id from the Modules list'),
      targetMethodId: z.string().nullable().describe('The id of the method this violation applies to, must be an exact id from the Methods list'),
      fixPrompt: z.string().nullable(),
      deterministicViolationId: z.string().nullable().describe('If this violation was generated from a deterministic detection, the detId from that detection. Null for LLM-discovered violations.'),
    })
  ),
});

const DiffViolationOutputSchema = z.object({
  resolvedViolationIds: z.array(z.string()).describe('IDs of previous violations that are now resolved — the issue no longer exists'),
  unchangedViolationIds: z.array(z.string()).describe('IDs of previous violations that still exist unchanged — every previous violation ID must appear in either resolvedViolationIds or unchangedViolationIds'),
  newViolations: z.array(
    z.object({
      type: z.enum(['service', 'database', 'module', 'function']),
      title: z.string(),
      content: z.string(),
      severity: z.enum(['low', 'medium', 'high', 'critical']),
      targetServiceId: z.string().nullable().describe('The id of the service this violation applies to, must be an exact id from the Services list'),
      targetModuleId: z.string().nullable().describe('The id of the module this violation applies to, must be an exact id from the Modules list'),
      targetMethodId: z.string().nullable().describe('The id of the method this violation applies to, must be an exact id from the Methods list'),
      targetServiceName: z.string().nullable(),
      targetModuleName: z.string().nullable(),
      targetMethodName: z.string().nullable(),
      fixPrompt: z.string().nullable(),
      deterministicViolationId: z.string().nullable().describe('If this violation was generated from a deterministic detection, the detId from that detection. Null for LLM-discovered violations.'),
    })
  ),
});

const LifecycleServiceOutputSchema = z.object({
  resolvedViolationIds: z.array(z.string()).describe('IDs of previous violations that are now resolved — the issue no longer exists'),
  unchangedViolationIds: z.array(z.string()).describe('IDs of previous violations that still exist unchanged — every previous violation ID must appear in either resolvedViolationIds or unchangedViolationIds'),
  newViolations: z.array(
    z.object({
      type: z.enum(['service', 'database', 'module', 'function']),
      title: z.string(),
      content: z.string(),
      severity: z.enum(['low', 'medium', 'high', 'critical']),
      targetServiceId: z.string().nullable().describe('The id of the service this violation applies to, must be an exact id from the Services list'),
      targetModuleId: z.string().nullable().describe('The id of the module this violation applies to, must be an exact id from the Modules list'),
      targetMethodId: z.string().nullable().describe('The id of the method this violation applies to, must be an exact id from the Methods list'),
      targetServiceName: z.string().nullable(),
      targetModuleName: z.string().nullable(),
      targetMethodName: z.string().nullable(),
      fixPrompt: z.string().nullable(),
      deterministicViolationId: z.string().nullable().describe('If this violation was generated from a deterministic detection, the detId from that detection. Null for LLM-discovered violations.'),
    })
  ),
  serviceDescriptions: z.array(
    z.object({
      id: z.string().describe('The service id, must be an exact id from the Services list'),
      description: z.string().describe('A concise 1-2 sentence description of what this service does'),
    })
  ),
});

const CodeViolationOutputSchema = z.object({
  violations: z.array(
    z.object({
      ruleName: z.string().describe('The exact rule name from the rules list'),
      filePath: z.string().describe('The exact file path from the files list'),
      lineStart: z.number().describe('The starting line number of the violation'),
      lineEnd: z.number().describe('The ending line number of the violation'),
      severity: z.enum(['low', 'medium', 'high', 'critical']),
      title: z.string().describe('A concise title for the violation'),
      content: z.string().describe('A detailed description of the issue and why it matters'),
      fixPrompt: z.string().nullable().describe('A prompt an AI coding assistant could use to fix this issue'),
    })
  ),
});

const CodeViolationLifecycleOutputSchema = z.object({
  resolvedViolationIds: z.array(z.string()).describe('IDs of previous code violations that are now resolved — the issue no longer exists in the current code'),
  unchangedViolationIds: z.array(z.string()).describe('IDs of previous code violations that still exist unchanged — every previous violation ID must appear in either resolvedViolationIds or unchangedViolationIds'),
  newViolations: z.array(
    z.object({
      ruleName: z.string().describe('The exact rule name from the rules list'),
      filePath: z.string().describe('The exact file path from the files list'),
      lineStart: z.number().describe('The starting line number of the violation'),
      lineEnd: z.number().describe('The ending line number of the violation'),
      severity: z.enum(['low', 'medium', 'high', 'critical']),
      title: z.string().describe('A concise title for the violation'),
      content: z.string().describe('A detailed description of the issue and why it matters'),
      fixPrompt: z.string().nullable().describe('A prompt an AI coding assistant could use to fix this issue'),
    })
  ),
});

const FlowEnrichmentOutputSchema = z.object({
  name: z.string().describe('A human-readable name for this flow (e.g. "User Registration")'),
  description: z.string().describe('A concise description of what this flow does'),
  stepDescriptions: z.array(
    z.object({
      stepOrder: z.number().describe('The step number'),
      dataDescription: z.string().describe('What data flows in this step'),
    })
  ),
});

// ---------------------------------------------------------------------------
// Model configuration
// ---------------------------------------------------------------------------

const DEFAULT_MODELS: Record<string, string> = {
  openai: 'gpt-5.3-codex',
  anthropic: 'claude-sonnet-4-20250514',
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
    const { text: prompt, langfusePrompt } = await getPrompt('violations-service', buildServiceTemplateVars(context));
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
        targetServiceId: v.targetServiceId ?? undefined,
        fixPrompt: v.fixPrompt ?? undefined,
        createdAt: new Date().toISOString(),
      })),
      serviceDescriptions: object.serviceDescriptions,
    };
  }

  async generateDatabaseViolations(context: DatabaseViolationContext): Promise<DatabaseViolationsResult> {
    const { text: prompt, langfusePrompt } = await getPrompt('violations-database', buildDatabaseTemplateVars(context));
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
        targetDatabaseId: v.targetDatabaseId ?? undefined,
        targetTable: v.targetTable ?? undefined,
        fixPrompt: v.fixPrompt ?? undefined,
        createdAt: new Date().toISOString(),
      })),
    };
  }

  async generateModuleViolations(context: ModuleViolationContext): Promise<ModuleViolationsResult> {
    const { text: prompt, langfusePrompt } = await getPrompt('violations-module', buildModuleTemplateVars(context));
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
        const targetModuleId = v.targetModuleId ?? undefined;
        const targetServiceId = targetModuleId ? moduleIdToServiceId.get(targetModuleId) : undefined;
        return {
          id: uuidv4(),
          type: v.type,
          title: v.title,
          content: v.content,
          severity: v.severity,
          targetServiceId,
          targetModuleId,
          targetMethodId: v.targetMethodId ?? undefined,
          fixPrompt: v.fixPrompt ?? undefined,
          deterministicViolationId: v.deterministicViolationId ?? undefined,
          createdAt: new Date().toISOString(),
        };
      }),
    };
  }

  generateAllViolations = observe(
    async (contexts: AllViolationsInput): Promise<AllViolationsResult> => {
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

      const settled = await Promise.allSettled(promises.map(([, p]) => p));

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
    async (contexts: AllViolationsInput): Promise<AllViolationsLifecycleResult> => {
      const model = getModel();
      const allResolved: string[] = [];
      const allNew: DiffViolationItem[] = [];
      let serviceDescriptions: ServiceDescription[] = [];

      const promises: [string, Promise<unknown>][] = [];

      // Service call — uses LifecycleServiceOutputSchema when existing violations present,
      // normal ServiceViolationOutputSchema otherwise. Same prompt, different output schema.
      if (contexts.service) {
        const ctx = contexts.service;
        if (ctx.existingViolations && ctx.existingViolations.length > 0) {
          promises.push(['service', (async () => {
            const { text: prompt, langfusePrompt } = await getPrompt(
              'violations-service',
              buildServiceTemplateVars(ctx),
            );
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
            const { text: prompt, langfusePrompt } = await getPrompt(
              'violations-database',
              buildDatabaseTemplateVars(ctx),
            );
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
            const { text: prompt, langfusePrompt } = await getPrompt(
              'violations-module',
              buildModuleTemplateVars(ctx),
            );
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
              resolvedViolationIds: object.resolvedViolationIds,
              newViolations: object.newViolations.map((i) => ({
                ...i,
                targetServiceId: (i.targetModuleId ? modIdToSvcId.get(i.targetModuleId) : null) ?? null,
                targetModuleId: i.targetModuleId ?? null,
                targetMethodId: i.targetMethodId ?? null,
                targetModuleName: i.targetModuleName ?? null,
                targetMethodName: i.targetMethodName ?? null,
              })),
            };
          })()]);
        } else {
          promises.push(['module-normal', this.generateModuleViolations(ctx)]);
        }
      }

      const settled = await Promise.allSettled(promises.map(([, p]) => p));

      for (let i = 0; i < promises.length; i++) {
        const [key] = promises[i];
        const outcome = settled[i];
        if (outcome.status !== 'fulfilled') {
          console.error(`[ViolationsLifecycle] ${key} call failed:`, outcome.reason);
          continue;
        }

        if (key === 'service') {
          // Lifecycle service result — has resolvedViolationIds, newViolations, serviceDescriptions
          const result = outcome.value as { resolvedViolationIds: string[]; newViolations: DiffViolationItem[]; serviceDescriptions: ServiceDescription[] };
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
          serviceDescriptions = result.serviceDescriptions;
        } else if (key === 'service-normal') {
          // Normal service result — convert to lifecycle format
          const result = outcome.value as ServiceViolationsResult;
          serviceDescriptions = result.serviceDescriptions;
          for (const v of result.violations) {
            allNew.push({
              type: v.type, title: v.title, content: v.content, severity: v.severity,
              targetServiceId: v.targetServiceId ?? null, targetModuleId: v.targetModuleId ?? null,
              targetMethodId: v.targetMethodId ?? null, targetServiceName: null,
              targetModuleName: null, targetMethodName: null, fixPrompt: v.fixPrompt ?? null,
              deterministicViolationId: null,
            });
          }
        } else if (key === 'database' || key === 'module') {
          // Lifecycle diff result
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
          // Normal database/module result — convert to new violations
          const result = outcome.value as DatabaseViolationsResult | ModuleViolationsResult;
          for (const v of result.violations) {
            allNew.push({
              type: v.type, title: v.title, content: v.content, severity: v.severity,
              targetServiceId: (v as Violation).targetServiceId ?? null,
              targetModuleId: (v as Violation).targetModuleId ?? null,
              targetMethodId: (v as Violation).targetMethodId ?? null,
              targetServiceName: null, targetModuleName: null, targetMethodName: null,
              fixPrompt: (v as Violation).fixPrompt ?? null,
              deterministicViolationId: null,
            });
          }
        }
      }

      return { resolvedViolationIds: allResolved, newViolations: allNew, serviceDescriptions };
    },
    { name: 'generate-all-violations-lifecycle' },
  );

  async generateCodeViolations(context: CodeViolationContext): Promise<CodeViolationsResult> {
    const { text: prompt, langfusePrompt } = await getPrompt('violations-code', buildCodeTemplateVars(context));
    const model = getModel();
    const hasExisting = context.existingViolations && context.existingViolations.length > 0;

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
          ruleName: v.ruleName,
          filePath: v.filePath,
          lineStart: v.lineStart,
          lineEnd: v.lineEnd,
          severity: v.severity,
          title: v.title,
          content: v.content,
          fixPrompt: v.fixPrompt ?? null,
        })),
        resolvedViolationIds: object.resolvedViolationIds,
        unchangedViolationIds: object.unchangedViolationIds,
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
        ruleName: v.ruleName,
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
  return new AISDKProvider();
}
