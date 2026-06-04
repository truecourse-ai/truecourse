/**
 * The enterprise LLM transport: implements `@truecourse/shared/llm`'s
 * `LlmTransport` on top of the Vercel AI SDK, so a hosted deploy talks to
 * Anthropic / OpenAI / Bedrock / Copilot over their APIs instead of spawning a
 * `claude` binary. `ee-server` builds one from the active provider config and
 * installs it process-wide via `setDefaultTransport`.
 *
 * Like the cli backend, it is content-agnostic: it returns the model's RAW
 * assistant text and the caller (each runner) strips fences + parses + Zod-
 * validates. The provider config fixes the model(s); the request's cli-oriented
 * `model`/`fallbackModel` hints are ignored.
 */

import { generateText, type LanguageModel } from 'ai';
import type { LlmTransport } from '@truecourse/shared/llm';
import { buildModel } from './model.js';
import type { ProviderConfig } from './types.js';

/**
 * Turn a per-call timeout into an abort deadline. The AI SDK has no first-class
 * timeout, so we drive it via abortSignal. (`LlmRequest` carries no external
 * signal, so the timeout is the only cancellation source.)
 */
function deadline(timeoutMs: number | undefined): {
  signal: AbortSignal | undefined;
  cleanup: () => void;
} {
  if (!timeoutMs) return { signal: undefined, cleanup: () => {} };
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`[ee-llm] timed out after ${timeoutMs}ms`)),
    timeoutMs,
  );
  return { signal: controller.signal, cleanup: () => clearTimeout(timer) };
}

/**
 * Build an `LlmTransport` for `cfg`. Runs on the primary model; on a non-abort
 * error, retries once on the fallback (never after the signal aborts).
 */
export function createAiSdkTransport(cfg: ProviderConfig): LlmTransport {
  const primary = buildModel(cfg, cfg.model);
  const fallback = cfg.fallbackModel ? buildModel(cfg, cfg.fallbackModel) : undefined;

  return async (req) => {
    const { signal, cleanup } = deadline(req.timeoutMs);
    const run = (model: LanguageModel): Promise<{ text: string }> =>
      generateText({ model, system: req.system, prompt: req.user, abortSignal: signal });
    try {
      try {
        return (await run(primary)).text;
      } catch (err) {
        if (!fallback || signal?.aborted) throw err;
        return (await run(fallback)).text;
      }
    } finally {
      cleanup();
    }
  };
}
