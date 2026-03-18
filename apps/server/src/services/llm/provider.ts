import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { generateObject, streamText, type LanguageModel } from 'ai';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import type { Insight } from '@truecourse/shared';
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
import { wrapWithTracing } from './tracing.js';

// ---------------------------------------------------------------------------
// Types — kept for summarizeArchitecture() and chat()
// ---------------------------------------------------------------------------

export interface ArchitectureContext {
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
// Focused insight context types (one per LLM call)
// ---------------------------------------------------------------------------

export interface ServiceInsightContext {
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

export interface DatabaseInsightContext {
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

export interface ModuleInsightContext {
  services: { id: string; name: string }[];
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
// Diff insight context types (extend normal contexts with existing insights)
// ---------------------------------------------------------------------------

interface ExistingViolation {
  id: string;
  type: string;
  title: string;
  content: string;
  severity: string;
}

export interface DiffServiceContext extends ServiceInsightContext {
  existingViolations: ExistingViolation[];
  changedFiles: string[];
  baselineViolations?: string[];
}

export interface DiffDatabaseContext extends DatabaseInsightContext {
  existingViolations: ExistingViolation[];
  changedFiles: string[];
}

export interface DiffModuleContext extends ModuleInsightContext {
  existingViolations: ExistingViolation[];
  changedFiles: string[];
}

export interface DiffInsightItem {
  type: string;
  title: string;
  content: string;
  severity: string;
  targetServiceName: string | null;
  targetModuleName: string | null;
  targetMethodName: string | null;
  fixPrompt: string | null;
}

export interface DiffInsightsResult {
  resolvedInsightIds: string[];
  newInsights: DiffInsightItem[];
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

export interface InsightsResult {
  violations: Insight[];
  serviceDescriptions: ServiceDescription[];
}

export interface ServiceInsightsResult {
  violations: Insight[];
  serviceDescriptions: ServiceDescription[];
}

export interface DatabaseInsightsResult {
  violations: Insight[];
}

export interface ModuleInsightsResult {
  violations: Insight[];
}

export interface LLMProvider {
  generateServiceInsights(context: ServiceInsightContext): Promise<ServiceInsightsResult>;
  generateDatabaseInsights(context: DatabaseInsightContext): Promise<DatabaseInsightsResult>;
  generateModuleInsights(context: ModuleInsightContext): Promise<ModuleInsightsResult>;
  generateDiffInsights(contexts: {
    service?: DiffServiceContext;
    database?: DiffDatabaseContext;
    module?: DiffModuleContext;
  }): Promise<DiffInsightsResult>;
  summarizeArchitecture(context: ArchitectureContext): Promise<string>;
  chat(messages: ChatMessage[], systemPrompt: string): AsyncGenerator<string>;
}

// ---------------------------------------------------------------------------
// Zod schemas — scoped per call to prevent ID mixing
// ---------------------------------------------------------------------------

const ArchitectureInsightOutputSchema = z.object({
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

const DatabaseInsightOutputSchema = z.object({
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

const ModuleInsightOutputSchema = z.object({
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

const DiffInsightOutputSchema = z.object({
  resolvedInsightIds: z.array(z.string()).describe('IDs of existing insights that are now resolved'),
  newInsights: z.array(
    z.object({
      type: z.enum(['service', 'database', 'module', 'function']),
      title: z.string(),
      content: z.string(),
      severity: z.enum(['low', 'medium', 'high', 'critical']),
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
  async generateServiceInsights(context: ServiceInsightContext): Promise<ServiceInsightsResult> {
    const prompt = await getPrompt('violations-service', buildServiceTemplateVars(context));
    const model = getModel();

    console.log('[LLM] Service insights call starting...');
    const t0 = Date.now();
    const { object } = await generateObject({
      model,
      schema: ArchitectureInsightOutputSchema,
      prompt,
    });
    console.log(`[LLM] Service insights call done in ${Date.now() - t0}ms — ${object.violations.length} violations`);

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

  async generateDatabaseInsights(context: DatabaseInsightContext): Promise<DatabaseInsightsResult> {
    const prompt = await getPrompt('violations-database', buildDatabaseTemplateVars(context));
    const model = getModel();

    console.log('[LLM] Database insights call starting...');
    const t0 = Date.now();
    const { object } = await generateObject({
      model,
      schema: DatabaseInsightOutputSchema,
      prompt,
    });
    console.log(`[LLM] Database insights call done in ${Date.now() - t0}ms — ${object.violations.length} violations`);

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

  async generateModuleInsights(context: ModuleInsightContext): Promise<ModuleInsightsResult> {
    const prompt = await getPrompt('violations-module', buildModuleTemplateVars(context));
    const model = getModel();

    console.log('[LLM] Module insights call starting...');
    const t0 = Date.now();
    const { object } = await generateObject({
      model,
      schema: ModuleInsightOutputSchema,
      prompt,
    });
    console.log(`[LLM] Module insights call done in ${Date.now() - t0}ms — ${object.violations.length} violations`);

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

  async generateDiffInsights(contexts: {
    service?: DiffServiceContext;
    database?: DiffDatabaseContext;
    module?: DiffModuleContext;
  }): Promise<DiffInsightsResult> {
    const model = getModel();
    const promises: Promise<{ resolvedInsightIds: string[]; newInsights: DiffInsightItem[] }>[] = [];

    const diffT0 = Date.now();
    console.log('[LLM] Diff insights starting...');

    if (contexts.service) {
      const ctx = contexts.service;
      promises.push(
        getPrompt('violations-diff-service', buildDiffServiceTemplateVars(ctx)).then(async (prompt) => {
          console.log('[LLM] Diff service call starting...');
          const t0 = Date.now();
          const { object } = await generateObject({
            model,
            schema: DiffInsightOutputSchema,
            prompt,
          });
          console.log(`[LLM] Diff service call done in ${Date.now() - t0}ms — resolved: ${object.resolvedInsightIds.length}, new: ${object.newInsights.length}`);
          return {
            resolvedInsightIds: object.resolvedInsightIds,
            newInsights: object.newInsights.map((i) => ({
              ...i,
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
        getPrompt('violations-diff-database', buildDiffDatabaseTemplateVars(ctx)).then(async (prompt) => {
          console.log('[LLM] Diff database call starting...');
          const t0 = Date.now();
          const { object } = await generateObject({
            model,
            schema: DiffInsightOutputSchema,
            prompt,
          });
          console.log(`[LLM] Diff database call done in ${Date.now() - t0}ms — resolved: ${object.resolvedInsightIds.length}, new: ${object.newInsights.length}`);
          return {
            resolvedInsightIds: object.resolvedInsightIds,
            newInsights: object.newInsights.map((i) => ({
              ...i,
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
        getPrompt('violations-diff-module', buildDiffModuleTemplateVars(ctx)).then(async (prompt) => {
          console.log('[LLM] Diff module call starting...');
          const t0 = Date.now();
          const { object } = await generateObject({
            model,
            schema: DiffInsightOutputSchema,
            prompt,
          });
          console.log(`[LLM] Diff module call done in ${Date.now() - t0}ms — resolved: ${object.resolvedInsightIds.length}, new: ${object.newInsights.length}`);
          return {
            resolvedInsightIds: object.resolvedInsightIds,
            newInsights: object.newInsights.map((i) => ({
              ...i,
              targetModuleName: i.targetModuleName ?? null,
              targetMethodName: i.targetMethodName ?? null,
            })),
          };
        })
      );
    }

    const results = await Promise.allSettled(promises);

    const allResolved: string[] = [];
    const allNew: DiffInsightItem[] = [];

    for (const result of results) {
      if (result.status === 'fulfilled') {
        allResolved.push(...result.value.resolvedInsightIds);
        allNew.push(...result.value.newInsights);
      } else {
        console.error('[DiffInsights] LLM call failed:', result.reason);
      }
    }

    console.log(`[LLM] Diff insights total: ${Date.now() - diffT0}ms — resolved: ${allResolved.length}, new: ${allNew.length}`);
    return { resolvedInsightIds: allResolved, newInsights: allNew };
  }

  async summarizeArchitecture(context: ArchitectureContext): Promise<string> {
    const prompt = await getPrompt('architecture-summary', buildTemplateVars(context));
    const model = getModel();

    const { text } = await streamText({
      model,
      prompt,
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
  return wrapWithTracing(new AISDKProvider());
}
