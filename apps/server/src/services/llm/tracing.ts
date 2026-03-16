import { Langfuse } from 'langfuse';
import { config } from '../../config/index.js';
import type {
  LLMProvider,
  ArchitectureContext,
  ArchitectureInsightContext,
  DatabaseInsightContext,
  ModuleInsightContext,
  DiffArchitectureContext,
  DiffDatabaseContext,
  DiffModuleContext,
  ChatMessage,
  ArchitectureInsightsResult,
  DatabaseInsightsResult,
  ModuleInsightsResult,
  DiffInsightsResult,
} from './provider.js';

function isLangfuseConfigured(): boolean {
  return !!(config.langfuse.publicKey && config.langfuse.secretKey);
}

let langfuseInstance: Langfuse | null = null;

function getLangfuse(): Langfuse | null {
  if (!isLangfuseConfigured()) {
    return null;
  }

  if (!langfuseInstance) {
    langfuseInstance = new Langfuse({
      publicKey: config.langfuse.publicKey,
      secretKey: config.langfuse.secretKey,
      baseUrl: config.langfuse.baseUrl,
    });
  }

  return langfuseInstance;
}

class TracedLLMProvider implements LLMProvider {
  constructor(private inner: LLMProvider) {}

  async generateArchitectureInsights(context: ArchitectureInsightContext): Promise<ArchitectureInsightsResult> {
    const langfuse = getLangfuse();
    if (!langfuse) {
      return this.inner.generateArchitectureInsights(context);
    }

    const trace = langfuse.trace({
      name: 'llm-violations-architecture',
      input: context,
    });

    try {
      const generation = trace.generation({
        name: 'llm-violations-architecture',
        input: context,
      });

      const result = await this.inner.generateArchitectureInsights(context);

      generation.end({ output: result });
      await langfuse.flushAsync();

      return result;
    } catch (error) {
      trace.update({
        output: { error: error instanceof Error ? error.message : String(error) },
      });
      await langfuse.flushAsync();
      throw error;
    }
  }

  async generateDatabaseInsights(context: DatabaseInsightContext): Promise<DatabaseInsightsResult> {
    const langfuse = getLangfuse();
    if (!langfuse) {
      return this.inner.generateDatabaseInsights(context);
    }

    const trace = langfuse.trace({
      name: 'llm-violations-database',
      input: context,
    });

    try {
      const generation = trace.generation({
        name: 'llm-violations-database',
        input: context,
      });

      const result = await this.inner.generateDatabaseInsights(context);

      generation.end({ output: result });
      await langfuse.flushAsync();

      return result;
    } catch (error) {
      trace.update({
        output: { error: error instanceof Error ? error.message : String(error) },
      });
      await langfuse.flushAsync();
      throw error;
    }
  }

  async generateModuleInsights(context: ModuleInsightContext): Promise<ModuleInsightsResult> {
    const langfuse = getLangfuse();
    if (!langfuse) {
      return this.inner.generateModuleInsights(context);
    }

    const trace = langfuse.trace({
      name: 'llm-violations-module',
      input: context,
    });

    try {
      const generation = trace.generation({
        name: 'llm-violations-module',
        input: context,
      });

      const result = await this.inner.generateModuleInsights(context);

      generation.end({ output: result });
      await langfuse.flushAsync();

      return result;
    } catch (error) {
      trace.update({
        output: { error: error instanceof Error ? error.message : String(error) },
      });
      await langfuse.flushAsync();
      throw error;
    }
  }

  async generateDiffInsights(contexts: {
    architecture?: DiffArchitectureContext;
    database?: DiffDatabaseContext;
    module?: DiffModuleContext;
  }): Promise<DiffInsightsResult> {
    const langfuse = getLangfuse();
    if (!langfuse) {
      return this.inner.generateDiffInsights(contexts);
    }

    const trace = langfuse.trace({
      name: 'llm-diff-violations',
      input: contexts,
    });

    try {
      const generation = trace.generation({
        name: 'llm-diff-violations',
        input: contexts,
      });

      const result = await this.inner.generateDiffInsights(contexts);

      generation.end({ output: result });
      await langfuse.flushAsync();

      return result;
    } catch (error) {
      trace.update({
        output: { error: error instanceof Error ? error.message : String(error) },
      });
      await langfuse.flushAsync();
      throw error;
    }
  }

  async summarizeArchitecture(context: ArchitectureContext): Promise<string> {
    const langfuse = getLangfuse();
    if (!langfuse) {
      return this.inner.summarizeArchitecture(context);
    }

    const trace = langfuse.trace({
      name: 'summarizeArchitecture',
      input: context,
    });

    try {
      const generation = trace.generation({
        name: 'llm-summarize-architecture',
        input: context,
      });

      const result = await this.inner.summarizeArchitecture(context);

      generation.end({ output: result });
      await langfuse.flushAsync();

      return result;
    } catch (error) {
      trace.update({
        output: { error: error instanceof Error ? error.message : String(error) },
      });
      await langfuse.flushAsync();
      throw error;
    }
  }

  async *chat(
    messages: ChatMessage[],
    systemPrompt: string
  ): AsyncGenerator<string> {
    const langfuse = getLangfuse();
    if (!langfuse) {
      yield* this.inner.chat(messages, systemPrompt);
      return;
    }

    const trace = langfuse.trace({
      name: 'chat',
      input: { messages, systemPrompt },
    });

    const generation = trace.generation({
      name: 'llm-chat',
      input: { messages, systemPrompt },
    });

    let fullResponse = '';

    try {
      for await (const chunk of this.inner.chat(messages, systemPrompt)) {
        fullResponse += chunk;
        yield chunk;
      }

      generation.end({ output: fullResponse });
      await langfuse.flushAsync();
    } catch (error) {
      trace.update({
        output: { error: error instanceof Error ? error.message : String(error) },
      });
      await langfuse.flushAsync();
      throw error;
    }
  }
}

export function wrapWithTracing(provider: LLMProvider): LLMProvider {
  return new TracedLLMProvider(provider);
}
