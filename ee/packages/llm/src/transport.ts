/**
 * The enterprise LLM transport: implements the OSS `LlmTransport` interface on
 * top of the Vercel AI SDK, so a hosted deploy talks to Anthropic / OpenAI /
 * Bedrock / Copilot over their APIs instead of spawning a `claude` binary.
 * `ee-server` builds one of these from the active provider config and installs
 * it via `setLlmTransport`.
 */

import { generateObject, generateText, type LanguageModel } from 'ai';
import type { ZodTypeAny } from 'zod';
import type {
  CompleteRequest,
  CompleteResult,
  CompleteTextRequest,
  CompleteTextResult,
  CompleteUsage,
  Inferred,
  LlmTransport,
} from '@truecourse/llm';
import { buildModel } from './model.js';
import type { ProviderConfig } from './types.js';

interface SdkUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
  // older AI SDK field names, mapped defensively
  promptTokens?: number;
  completionTokens?: number;
}

function mapUsage(usage: SdkUsage | undefined): CompleteUsage | undefined {
  if (!usage) return undefined;
  const input = usage.inputTokens ?? usage.promptTokens ?? 0;
  const output = usage.outputTokens ?? usage.completionTokens ?? 0;
  const cacheRead = usage.cachedInputTokens ?? 0;
  return {
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: cacheRead,
    // Billable total is input + output, matching the CLI transport's convention.
    totalTokens: input + output,
  };
}

/**
 * Turn a per-call timeout into an abort deadline, combined with the caller's
 * signal. The AI SDK has no first-class timeout, so we drive it via abortSignal.
 */
function deadline(
  timeoutMs: number | undefined,
  base: AbortSignal | undefined,
): { signal: AbortSignal | undefined; cleanup: () => void } {
  if (!timeoutMs) return { signal: base, cleanup: () => {} };
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`[ee-llm] timed out after ${timeoutMs}ms`)),
    timeoutMs,
  );
  const signal = base ? AbortSignal.any([base, controller.signal]) : controller.signal;
  return { signal, cleanup: () => clearTimeout(timer) };
}

export class AiSdkTransport implements LlmTransport {
  private readonly primary: LanguageModel;
  private readonly fallback?: LanguageModel;

  constructor(cfg: ProviderConfig) {
    this.primary = buildModel(cfg, cfg.model);
    this.fallback = cfg.fallbackModel
      ? buildModel(cfg, cfg.fallbackModel)
      : undefined;
  }

  async complete<S extends ZodTypeAny>(
    req: CompleteRequest<S>,
  ): Promise<CompleteResult<Inferred<S>>> {
    const { signal, cleanup } = deadline(req.timeoutMs, req.signal);
    try {
      const res = await this.withFallback(signal, (model) =>
        generateObject({
          model,
          schema: req.schema,
          system: req.system,
          prompt: req.prompt,
          abortSignal: signal,
        }),
      );
      return { object: res.object as Inferred<S>, usage: mapUsage(res.usage) };
    } finally {
      cleanup();
    }
  }

  async completeText(req: CompleteTextRequest): Promise<CompleteTextResult> {
    const { signal, cleanup } = deadline(req.timeoutMs, req.signal);
    try {
      const res = await this.withFallback(signal, (model) =>
        generateText({
          model,
          system: req.system,
          prompt: req.prompt,
          abortSignal: signal,
        }),
      );
      return { text: res.text, usage: mapUsage(res.usage) };
    } finally {
      cleanup();
    }
  }

  /**
   * Run on the primary model; on a non-abort error, retry once on the fallback.
   * Never retries once the signal is aborted (caller cancel or timeout).
   */
  private async withFallback<R>(
    signal: AbortSignal | undefined,
    run: (model: LanguageModel) => Promise<R>,
  ): Promise<R> {
    try {
      return await run(this.primary);
    } catch (err) {
      if (!this.fallback || signal?.aborted) throw err;
      return run(this.fallback);
    }
  }
}

/** Convenience factory mirroring the OSS transport's shape. */
export function createAiSdkTransport(cfg: ProviderConfig): AiSdkTransport {
  return new AiSdkTransport(cfg);
}
