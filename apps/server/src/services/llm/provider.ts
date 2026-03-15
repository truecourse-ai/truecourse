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
  buildArchitectureTemplateVars,
  buildDatabaseTemplateVars,
  buildModuleTemplateVars,
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

export interface ArchitectureInsightContext {
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
  insights: Insight[];
  serviceDescriptions: ServiceDescription[];
}

export interface ArchitectureInsightsResult {
  insights: Insight[];
  serviceDescriptions: ServiceDescription[];
}

export interface DatabaseInsightsResult {
  insights: Insight[];
}

export interface ModuleInsightsResult {
  insights: Insight[];
}

export interface LLMProvider {
  generateArchitectureInsights(context: ArchitectureInsightContext): Promise<ArchitectureInsightsResult>;
  generateDatabaseInsights(context: DatabaseInsightContext): Promise<DatabaseInsightsResult>;
  generateModuleInsights(context: ModuleInsightContext): Promise<ModuleInsightsResult>;
  summarizeArchitecture(context: ArchitectureContext): Promise<string>;
  chat(messages: ChatMessage[], systemPrompt: string): AsyncGenerator<string>;
}

// ---------------------------------------------------------------------------
// Zod schemas — scoped per call to prevent ID mixing
// ---------------------------------------------------------------------------

const ArchitectureInsightOutputSchema = z.object({
  insights: z.array(
    z.object({
      type: z.literal('service'),
      title: z.string(),
      content: z.string(),
      severity: z.enum(['low', 'medium', 'high', 'critical']),
      targetServiceId: z.string().nullable().describe('The id of the service this insight applies to, must be an exact id from the Services list'),
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
  insights: z.array(
    z.object({
      type: z.literal('database'),
      title: z.string(),
      content: z.string(),
      severity: z.enum(['low', 'medium', 'high', 'critical']),
      targetDatabaseId: z.string().nullable().describe('The id of the database this insight applies to, must be an exact id from the Databases list'),
      targetTable: z.string().nullable().describe('The exact table name this insight applies to'),
      fixPrompt: z.string().nullable(),
    })
  ),
});

const ModuleInsightOutputSchema = z.object({
  insights: z.array(
    z.object({
      type: z.enum(['module', 'function']).describe('Use "function" when the issue targets a specific function/method, use "module" when it targets the module/class itself'),
      title: z.string(),
      content: z.string(),
      severity: z.enum(['low', 'medium', 'high', 'critical']),
      targetServiceId: z.string().nullable().describe('The id of the service this insight applies to, must be an exact id from the Services list'),
      targetModuleId: z.string().nullable().describe('The id of the module this insight applies to, must be an exact id from the Modules list'),
      targetMethodId: z.string().nullable().describe('The id of the method this insight applies to, must be an exact id from the Methods list'),
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
      return openai('gpt-5.2');
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
  async generateArchitectureInsights(context: ArchitectureInsightContext): Promise<ArchitectureInsightsResult> {
    const prompt = await getPrompt('insights-architecture', buildArchitectureTemplateVars(context));
    const model = getModel();

    const { object } = await generateObject({
      model,
      schema: ArchitectureInsightOutputSchema,
      prompt,
    });

    return {
      insights: object.insights.map((insight) => ({
        id: uuidv4(),
        type: insight.type,
        title: insight.title,
        content: insight.content,
        severity: insight.severity,
        targetServiceId: insight.targetServiceId ?? undefined,
        fixPrompt: insight.fixPrompt ?? undefined,
        createdAt: new Date().toISOString(),
      })),
      serviceDescriptions: object.serviceDescriptions,
    };
  }

  async generateDatabaseInsights(context: DatabaseInsightContext): Promise<DatabaseInsightsResult> {
    const prompt = await getPrompt('insights-database', buildDatabaseTemplateVars(context));
    const model = getModel();

    const { object } = await generateObject({
      model,
      schema: DatabaseInsightOutputSchema,
      prompt,
    });

    return {
      insights: object.insights.map((insight) => ({
        id: uuidv4(),
        type: insight.type,
        title: insight.title,
        content: insight.content,
        severity: insight.severity,
        targetDatabaseId: insight.targetDatabaseId ?? undefined,
        targetTable: insight.targetTable ?? undefined,
        fixPrompt: insight.fixPrompt ?? undefined,
        createdAt: new Date().toISOString(),
      })),
    };
  }

  async generateModuleInsights(context: ModuleInsightContext): Promise<ModuleInsightsResult> {
    const prompt = await getPrompt('insights-module', buildModuleTemplateVars(context));
    const model = getModel();

    const { object } = await generateObject({
      model,
      schema: ModuleInsightOutputSchema,
      prompt,
    });

    return {
      insights: object.insights.map((insight) => ({
        id: uuidv4(),
        type: insight.type,
        title: insight.title,
        content: insight.content,
        severity: insight.severity,
        targetServiceId: insight.targetServiceId ?? undefined,
        targetModuleId: insight.targetModuleId ?? undefined,
        targetMethodId: insight.targetMethodId ?? undefined,
        fixPrompt: insight.fixPrompt ?? undefined,
        createdAt: new Date().toISOString(),
      })),
    };
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
