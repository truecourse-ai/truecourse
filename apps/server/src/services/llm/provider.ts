import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { generateObject, streamText, type LanguageModel } from 'ai';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import type { Insight } from '@truecourse/shared';
import { config } from '../../config/index.js';
import { getPrompt, buildTemplateVars } from './prompts.js';
import { wrapWithTracing } from './tracing.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ArchitectureContext {
  architecture: string;
  services: {
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
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ServiceDescription {
  name: string;
  description: string;
}

export interface InsightsResult {
  insights: Insight[];
  serviceDescriptions: ServiceDescription[];
}

export interface LLMProvider {
  generateInsights(context: ArchitectureContext): Promise<InsightsResult>;
  summarizeArchitecture(context: ArchitectureContext): Promise<string>;
  chat(messages: ChatMessage[], systemPrompt: string): AsyncGenerator<string>;
}

// ---------------------------------------------------------------------------
// Zod schema for structured insight output
// ---------------------------------------------------------------------------

const InsightOutputSchema = z.object({
  insights: z.array(
    z.object({
      type: z.enum(['architecture', 'dependency', 'violation', 'suggestion', 'warning']),
      title: z.string(),
      content: z.string(),
      severity: z.enum(['info', 'low', 'medium', 'high', 'critical']),
      targetService: z.string().nullable(),
      fixPrompt: z.string().nullable(),
    })
  ),
  serviceDescriptions: z.array(
    z.object({
      name: z.string().describe('The service name, must match one of the provided service names'),
      description: z.string().describe('A concise 1-2 sentence description of what this service does'),
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
  async generateInsights(context: ArchitectureContext): Promise<InsightsResult> {
    const prompt = await getPrompt('insights-generation', buildTemplateVars(context));
    const model = getModel();

    const { object } = await generateObject({
      model,
      schema: InsightOutputSchema,
      prompt,
    });

    return {
      insights: object.insights.map((insight) => ({
        id: uuidv4(),
        type: insight.type,
        title: insight.title,
        content: insight.content,
        severity: insight.severity,
        targetService: insight.targetService ?? undefined,
        fixPrompt: insight.fixPrompt ?? undefined,
        createdAt: new Date().toISOString(),
      })),
      serviceDescriptions: object.serviceDescriptions,
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
