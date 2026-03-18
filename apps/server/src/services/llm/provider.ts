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
  buildTemplateVars,
  buildServiceTemplateVars,
  buildDatabaseTemplateVars,
  buildModuleTemplateVars,
  buildDiffServiceTemplateVars,
  buildDiffDatabaseTemplateVars,
  buildDiffModuleTemplateVars,
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
// Types — kept for summarizeServices() and chat()
// ---------------------------------------------------------------------------

export interface ServiceSummaryContext {
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
  violations?: string[];
  databases?: {
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
  llmRules?: {
    name: string;
    severity: string;
    prompt: string;
  }[];
}

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
  violations?: string[];
  llmRules: { name: string; severity: string; prompt: string }[];
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
}

export interface ModuleViolationContext {
  modules: {
    id: string;
    name: string;
    kind: string;
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
  }[];
}

// ---------------------------------------------------------------------------
// Diff violation context types (extend normal contexts with existing violations)
// ---------------------------------------------------------------------------

interface ExistingViolation {
  id: string;
  type: string;
  title: string;
  content: string;
  severity: string;
}

export interface DiffServiceContext extends ServiceViolationContext {
  existingViolations: ExistingViolation[];
  changedFiles: string[];
  baselineViolations?: string[];
}

export interface DiffDatabaseContext extends DatabaseViolationContext {
  existingViolations: ExistingViolation[];
  changedFiles: string[];
}

export interface DiffModuleContext extends ModuleViolationContext {
  existingViolations: ExistingViolation[];
  changedFiles: string[];
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

export interface LLMProvider {
  generateServiceViolations(context: ServiceViolationContext): Promise<ServiceViolationsResult>;
  generateDatabaseViolations(context: DatabaseViolationContext): Promise<DatabaseViolationsResult>;
  generateModuleViolations(context: ModuleViolationContext): Promise<ModuleViolationsResult>;
  generateAllViolations(contexts: AllViolationsInput): Promise<AllViolationsResult>;
  generateDiffViolations(contexts: {
    service?: DiffServiceContext;
    database?: DiffDatabaseContext;
    module?: DiffModuleContext;
  }): Promise<DiffViolationsResult>;
  summarizeServices(context: ServiceSummaryContext): Promise<string>;
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
      targetServiceId: z.string().nullable().describe('The id of the service this violation applies to, must be an exact id from the Services list'),
      targetModuleId: z.string().nullable().describe('The id of the module this violation applies to, must be an exact id from the Modules list'),
      targetMethodId: z.string().nullable().describe('The id of the method this violation applies to, must be an exact id from the Methods list'),
      fixPrompt: z.string().nullable(),
    })
  ),
});

const DiffViolationOutputSchema = z.object({
  resolvedViolationIds: z.array(z.string()).describe('IDs of existing violations that are now resolved'),
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
    })
  ),
});

// ---------------------------------------------------------------------------
// Model configuration
// ---------------------------------------------------------------------------

const MODEL_CONFIG: Record<string, { provider: () => LanguageModel }> = {
  openai: {
    provider: () => {
      const openai = createOpenAI({ apiKey: config.openaiApiKey });
      return openai('gpt-5.3-codex');
    },
  },
  anthropic: {
    provider: () => {
      const anthropic = createAnthropic({ apiKey: config.anthropicApiKey });
      return anthropic('claude-sonnet-4-20250514');
    },
  },
};

function getModel(): LanguageModel {
  const providerConfig = MODEL_CONFIG[config.llmProvider];
  if (!providerConfig) {
    throw new Error(`Unknown LLM provider: ${config.llmProvider}`);
  }
  return providerConfig.provider();
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
      violations: object.violations.map((v) => ({
        id: uuidv4(),
        type: v.type,
        title: v.title,
        content: v.content,
        severity: v.severity,
        targetServiceId: v.targetServiceId ?? undefined,
        targetModuleId: v.targetModuleId ?? undefined,
        targetMethodId: v.targetMethodId ?? undefined,
        fixPrompt: v.fixPrompt ?? undefined,
        createdAt: new Date().toISOString(),
      })),
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

  generateDiffViolations = observe(
    async (contexts: {
      service?: DiffServiceContext;
      database?: DiffDatabaseContext;
      module?: DiffModuleContext;
    }): Promise<DiffViolationsResult> => {
      const model = getModel();
      const promises: Promise<{ resolvedViolationIds: string[]; newViolations: DiffViolationItem[] }>[] = [];

      const diffT0 = Date.now();
      console.log('[LLM] Diff violations starting...');

      if (contexts.service) {
        const ctx = contexts.service;
        promises.push(
          getPrompt('violations-diff-service', buildDiffServiceTemplateVars(ctx)).then(async ({ text: prompt, langfusePrompt }) => {
            console.log('[LLM] Diff service call starting...');
            const t0 = Date.now();
            const { output: object } = await generateText({
              model,
              output: Output.object({ schema: DiffViolationOutputSchema }),
              prompt,
              experimental_telemetry: telemetry('violations-diff-service', langfusePrompt),
            });
            console.log(`[LLM] Diff service call done in ${Date.now() - t0}ms — resolved: ${object.resolvedViolationIds.length}, new: ${object.newViolations.length}`);
            return {
              resolvedViolationIds: object.resolvedViolationIds,
              newViolations: object.newViolations.map((i) => ({
                ...i,
                targetServiceId: i.targetServiceId ?? null,
                targetModuleId: i.targetModuleId ?? null,
                targetMethodId: i.targetMethodId ?? null,
                targetModuleName: i.targetModuleName ?? null,
                targetMethodName: i.targetMethodName ?? null,
              })),
            };
          })
        );
      }

      if (contexts.database) {
        const ctx = contexts.database;
        promises.push(
          getPrompt('violations-diff-database', buildDiffDatabaseTemplateVars(ctx)).then(async ({ text: prompt, langfusePrompt }) => {
            console.log('[LLM] Diff database call starting...');
            const t0 = Date.now();
            const { output: object } = await generateText({
              model,
              output: Output.object({ schema: DiffViolationOutputSchema }),
              prompt,
              experimental_telemetry: telemetry('violations-diff-database', langfusePrompt),
            });
            console.log(`[LLM] Diff database call done in ${Date.now() - t0}ms — resolved: ${object.resolvedViolationIds.length}, new: ${object.newViolations.length}`);
            return {
              resolvedViolationIds: object.resolvedViolationIds,
              newViolations: object.newViolations.map((i) => ({
                ...i,
                targetServiceId: i.targetServiceId ?? null,
                targetModuleId: i.targetModuleId ?? null,
                targetMethodId: i.targetMethodId ?? null,
                targetModuleName: i.targetModuleName ?? null,
                targetMethodName: i.targetMethodName ?? null,
              })),
            };
          })
        );
      }

      if (contexts.module) {
        const ctx = contexts.module;
        promises.push(
          getPrompt('violations-diff-module', buildDiffModuleTemplateVars(ctx)).then(async ({ text: prompt, langfusePrompt }) => {
            console.log('[LLM] Diff module call starting...');
            const t0 = Date.now();
            const { output: object } = await generateText({
              model,
              output: Output.object({ schema: DiffViolationOutputSchema }),
              prompt,
              experimental_telemetry: telemetry('violations-diff-module', langfusePrompt),
            });
            console.log(`[LLM] Diff module call done in ${Date.now() - t0}ms — resolved: ${object.resolvedViolationIds.length}, new: ${object.newViolations.length}`);
            return {
              resolvedViolationIds: object.resolvedViolationIds,
              newViolations: object.newViolations.map((i) => ({
                ...i,
                targetServiceId: i.targetServiceId ?? null,
                targetModuleId: i.targetModuleId ?? null,
                targetMethodId: i.targetMethodId ?? null,
                targetModuleName: i.targetModuleName ?? null,
                targetMethodName: i.targetMethodName ?? null,
              })),
            };
          })
        );
      }

      const results = await Promise.allSettled(promises);

      const allResolved: string[] = [];
      const allNew: DiffViolationItem[] = [];

      for (const result of results) {
        if (result.status === 'fulfilled') {
          allResolved.push(...result.value.resolvedViolationIds);
          allNew.push(...result.value.newViolations);
        } else {
          console.error('[DiffViolations] LLM call failed:', result.reason);
        }
      }

      console.log(`[LLM] Diff violations total: ${Date.now() - diffT0}ms — resolved: ${allResolved.length}, new: ${allNew.length}`);
      return { resolvedViolationIds: allResolved, newViolations: allNew };
    },
    { name: 'generate-diff-violations' },
  );

  async summarizeServices(context: ServiceSummaryContext): Promise<string> {
    const { text: prompt, langfusePrompt } = await getPrompt('service-summary', buildTemplateVars(context));
    const model = getModel();

    const { text } = await streamText({
      model,
      prompt,
      experimental_telemetry: telemetry('summarize-services', langfusePrompt),
    });

    return text;
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
