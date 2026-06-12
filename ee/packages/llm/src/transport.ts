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
 *
 * OBSERVABILITY: when a `recorder` is supplied, every call (success or failure)
 * is captured as one trace — the prompt/output the SDK already has, plus token
 * usage/latency/finish reason, tagged with the ambient `currentTrace()` (org /
 * job / repo). Recording NEVER breaks the call: a recorder error is swallowed.
 * The AI SDK's native OpenTelemetry emission is also enabled (`experimental_
 * telemetry`), so the same calls stay OTel-standard for a future exporter.
 */

import { generateText, type LanguageModel } from 'ai';
import type { LlmRequest, LlmTransport } from '@truecourse/shared/llm';
import type { LlmTraceInput, LlmTraceRecorder, TraceStatus } from '@truecourse/shared';
import { buildModel } from './model.js';
import { currentTrace, type TraceContext } from './trace-context.js';
import type { ProviderConfig } from './types.js';

export interface AiSdkTransportOptions {
  /** Trace sink. Omit (e.g. the config-probe call) to record nothing. */
  recorder?: LlmTraceRecorder;
}

/** The subset of the AI SDK result we capture (structurally satisfied by GenerateTextResult). */
interface CapturedResult {
  text: string;
  finishReason?: string | null;
  reasoningText?: string | null;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    reasoningTokens?: number;
  };
}

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

/** The granular unit id the call processed, parsed from `LlmRequest.id`. */
function sliceIdOf(id: string | undefined): string | null {
  if (!id) return null;
  const i = id.indexOf(':');
  return i >= 0 ? id.slice(i + 1) : null;
}

/** Per-call metadata for the AI SDK's OTel emission (attributes must be scalars). */
function telemetryMeta(req: LlmRequest, ctx: TraceContext | undefined): Record<string, string> {
  const m: Record<string, string> = {};
  if (req.stage) m.stage = req.stage;
  if (req.id) m.callId = req.id;
  if (ctx?.org) m.org = ctx.org;
  if (ctx?.traceId) m.traceId = ctx.traceId;
  if (ctx?.jobId) m.jobId = ctx.jobId;
  return m;
}

/** Non-null context tags that belong in the trace's free-form `metadata`. */
function traceMetadata(ctx: TraceContext | undefined, provider: string): Record<string, unknown> {
  const m: Record<string, unknown> = { provider };
  if (ctx?.jobId) m.jobId = ctx.jobId;
  if (ctx?.repoFullName) m.repoFullName = ctx.repoFullName;
  if (ctx?.commitSha) m.commitSha = ctx.commitSha;
  return m;
}

/** Fields common to the ok/error trace; the outcome fills the rest. */
function baseTrace(
  req: LlmRequest,
  ctx: TraceContext | undefined,
  cfg: ProviderConfig,
  model: string,
  usedFallback: boolean,
  startedAt: number,
): Omit<
  LlmTraceInput,
  | 'status'
  | 'errorMessage'
  | 'finishReason'
  | 'promptTokens'
  | 'completionTokens'
  | 'totalTokens'
  | 'reasoningTokens'
  | 'output'
  | 'reasoning'
> {
  return {
    workspaceOrgId: ctx?.org ?? null,
    traceId: ctx?.traceId ?? null,
    parentId: ctx?.parentId ?? null,
    stage: req.stage ?? null,
    callId: req.id ?? null,
    sliceId: sliceIdOf(req.id),
    module: null,
    topic: null,
    model,
    usedFallback,
    latencyMs: Date.now() - startedAt,
    system: req.system,
    user: req.user,
    metadata: traceMetadata(ctx, cfg.provider),
  };
}

function okTrace(base: ReturnType<typeof baseTrace>, result: CapturedResult): LlmTraceInput {
  const u = result.usage;
  return {
    ...base,
    status: 'ok',
    errorMessage: null,
    finishReason: result.finishReason ?? null,
    promptTokens: u?.inputTokens ?? null,
    completionTokens: u?.outputTokens ?? null,
    totalTokens: u?.totalTokens ?? null,
    reasoningTokens: u?.reasoningTokens ?? null,
    output: result.text,
    reasoning: result.reasoningText ?? null,
  };
}

function errorTrace(base: ReturnType<typeof baseTrace>, err: unknown): LlmTraceInput {
  return {
    ...base,
    status: 'error' as TraceStatus,
    errorMessage: (err as Error)?.message ?? String(err),
    finishReason: null,
    promptTokens: null,
    completionTokens: null,
    totalTokens: null,
    reasoningTokens: null,
    output: null,
    reasoning: null,
  };
}

/** Record without ever breaking the call: the store's failure must not throw out. */
async function safeRecord(recorder: LlmTraceRecorder | undefined, input: LlmTraceInput): Promise<void> {
  if (!recorder) return;
  try {
    await recorder.record(input);
  } catch (err) {
    console.warn(`[ee-llm] trace record failed: ${(err as Error).message}`);
  }
}

/**
 * Build an `LlmTransport` for `cfg`. Runs on the primary model; on a non-abort
 * error, retries once on the fallback (never after the signal aborts).
 */
export function createAiSdkTransport(
  cfg: ProviderConfig,
  opts: AiSdkTransportOptions = {},
): LlmTransport {
  const primary = buildModel(cfg, cfg.model);
  const fallback = cfg.fallbackModel ? buildModel(cfg, cfg.fallbackModel) : undefined;
  const fallbackModelId = cfg.fallbackModel ?? cfg.model;
  const recorder = opts.recorder;

  return async (req) => {
    const { signal, cleanup } = deadline(req.timeoutMs);
    const ctx = currentTrace();
    const startedAt = Date.now();
    const run = (model: LanguageModel) =>
      generateText({
        model,
        system: req.system,
        prompt: req.user,
        abortSignal: signal,
        experimental_telemetry: {
          isEnabled: true,
          functionId: req.stage ?? 'llm.call',
          metadata: telemetryMeta(req, ctx),
        },
      });

    try {
      let result: Awaited<ReturnType<typeof run>>;
      let usedFallback = false;
      try {
        result = await run(primary);
      } catch (err) {
        if (!fallback || signal?.aborted) {
          await safeRecord(recorder, errorTrace(baseTrace(req, ctx, cfg, cfg.model, false, startedAt), err));
          throw err;
        }
        usedFallback = true;
        try {
          result = await run(fallback);
        } catch (err2) {
          await safeRecord(
            recorder,
            errorTrace(baseTrace(req, ctx, cfg, fallbackModelId, true, startedAt), err2),
          );
          throw err2;
        }
      }
      const model = usedFallback ? fallbackModelId : cfg.model;
      await safeRecord(recorder, okTrace(baseTrace(req, ctx, cfg, model, usedFallback, startedAt), result));
      return result.text;
    } finally {
      cleanup();
    }
  };
}
