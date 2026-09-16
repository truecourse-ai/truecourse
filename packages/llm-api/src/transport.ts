/**
 * The direct-API LLM transport: implements `@truecourse/shared/llm`'s
 * `LlmTransport` on top of the Vercel AI SDK, so TrueCourse talks to
 * Anthropic / OpenAI / Bedrock / Copilot over their APIs instead of running on
 * the machine's own `claude` login. The dashboard server builds one per run
 * from the asking workspace's stored provider config and threads it into the
 * run.
 *
 * Like the claude-code backend, it is content-agnostic: it returns the model's
 * RAW assistant text and the caller (each runner) strips fences + parses + Zod-
 * validates. The provider config fixes the model(s); the request's
 * `model`/`fallbackModel` hints are ignored unless `honorRequestModel` is set
 * (the default in `createApiTransportFor`, so per-stage model overrides keep
 * working).
 *
 * ACCOUNTING: every successful call reports its tokens to the shared per-stage
 * usage table, with a cost from the optional `pricing` hook — the same
 * ` · model · tokens · $cost` tags the claude-code backend produces.
 *
 * OBSERVABILITY: the AI SDK's native OpenTelemetry emission is enabled
 * (`experimental_telemetry`), tagged with the ambient `currentTrace()` (org /
 * job / repo), so every call stays OTel-standard for a future exporter.
 */

import { generateText, generateObject, jsonSchema, type LanguageModel, type ModelMessage } from 'ai';
import {
  recordStageUsage,
  resolveTimeoutScale,
  type LlmRequest,
  type LlmTransport,
} from '@truecourse/shared/llm';
import { buildModel } from './model.js';
import {
  isObjectRootedSchema,
  NonObjectRootSchemaError,
  normalizeForStrictOutput,
  stripInjectedNulls,
} from './strict-schema.js';
import { currentTrace, type TraceContext } from './trace-context.js';
import type { ProviderConfig } from './types.js';

/** One call's token counts, in the same buckets the claude-code backend reports. */
export interface CallUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
}

export interface ApiTransportOptions {
  /**
   * Cost for one call's usage, in USD. Omit (the config probe) and calls are
   * recorded with a zero cost — tokens are still counted.
   */
  pricing?: (modelId: string, usage: CallUsage) => number;
  /**
   * Run each request on its own `model`/`fallbackModel` when it carries one,
   * falling back to the config's. Off by default: the stored provider config
   * fixes the model, and a stage's request carries a tier alias, not a model id.
   */
  honorRequestModel?: boolean;
}

/** Former name of {@link ApiTransportOptions}, kept for callers still on it. */
export type AiSdkTransportOptions = ApiTransportOptions;

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
    inputTokenDetails?: {
      noCacheTokens?: number;
      cacheReadTokens?: number;
      cacheWriteTokens?: number;
    };
  };
}

/**
 * Split the SDK's usage into the four non-overlapping buckets `StageUsage`
 * tracks. `inputTokens` is the input TOTAL, so the fresh-input bucket is the
 * non-cached detail when the provider reports one. Shared with the session
 * driver, whose per-turn usage rides the same buckets.
 */
export function callUsageOf(usage: CapturedResult['usage']): CallUsage {
  const details = usage?.inputTokenDetails;
  return {
    inputTokens: details?.noCacheTokens ?? usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    cacheReadTokens: details?.cacheReadTokens ?? 0,
    cacheCreateTokens: details?.cacheWriteTokens ?? 0,
  };
}

/**
 * Turn a per-call timeout into an abort deadline. The AI SDK has no first-class
 * timeout, so we drive it via abortSignal. (`LlmRequest` carries no external
 * signal, so the timeout is the only cancellation source, and nothing can cut a
 * call short once its deadline is spent.) ONE deadline covers the whole call,
 * the fallback model included: `timeoutMs` is the wall clock a caller is
 * promised, which is what lets the config probe fail fast and a long stage name
 * a ceiling that means what it says.
 *
 * The request's ceiling is multiplied by `resolveTimeoutScale()` — the same
 * `TRUECOURSE_LLM_TIMEOUT_SCALE` knob the cli and agent backends apply — so one
 * env var widens every per-call timeout whatever transport is installed. This is
 * the only place the package consumes a timeout, so scaling here covers it all.
 */
function deadline(timeoutMs: number | undefined): {
  signal: AbortSignal | undefined;
  cleanup: () => void;
} {
  if (!timeoutMs) return { signal: undefined, cleanup: () => {} };
  const effectiveMs = timeoutMs * resolveTimeoutScale();
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`[llm-api] timed out after ${effectiveMs}ms`)),
    effectiveMs,
  );
  return { signal: controller.signal, cleanup: () => clearTimeout(timer) };
}

/**
 * How the user half of the call reaches the SDK. A text-only request keeps the
 * `prompt` string it has always used — the ~20 text stages must not change shape
 * because a vision stage exists. A request carrying images has to become a
 * MESSAGE of content parts, because that is the only form an image can travel in.
 * The `system` prompt is unaffected either way: it rides its own field.
 */
type PromptInput = { prompt: string } | { messages: ModelMessage[] };

function promptInputOf(req: LlmRequest): PromptInput {
  const images = req.images ?? [];
  if (images.length === 0) return { prompt: req.user };
  return {
    messages: [
      {
        role: 'user',
        content: [
          // Text FIRST — the instruction has to be in context before the pixels.
          { type: 'text', text: req.user },
          ...images.map((image) => ({
            type: 'image' as const,
            image: image.data,
            mediaType: image.mediaType,
          })),
        ],
      },
    ],
  };
}

/** The granular unit id the call processed, parsed from `LlmRequest.id`. */
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
/** Fields common to the ok/error trace; the outcome fills the rest. */
/** Report one successful call's tokens + cost to the shared per-stage table. */
function recordUsage(
  req: LlmRequest,
  model: string,
  result: CapturedResult,
  pricing: ApiTransportOptions['pricing'],
): void {
  const usage = callUsageOf(result.usage);
  let costUsd = 0;
  if (pricing) {
    try {
      const priced = pricing(model, usage);
      if (Number.isFinite(priced)) costUsd = priced;
    } catch {
      /* pricing is observational — an unpriceable call still reports tokens */
    }
  }
  recordStageUsage(req.stage, { model, ...usage, costUsd });
}

/** Record without ever breaking the call: the store's failure must not throw out. */
/**
 * Build an `LlmTransport` for `cfg`. Runs on the primary model; on a non-abort
 * error, retries once on the fallback (never after the signal aborts).
 */
export function createApiTransport(
  cfg: ProviderConfig,
  opts: ApiTransportOptions = {},
): LlmTransport {
  const models = new Map<string, LanguageModel>();
  models.set(cfg.model, buildModel(cfg, cfg.model));
  if (cfg.fallbackModel) models.set(cfg.fallbackModel, buildModel(cfg, cfg.fallbackModel));
  const modelFor = (id: string): LanguageModel => {
    const cached = models.get(id);
    if (cached) return cached;
    const built = buildModel(cfg, id);
    models.set(id, built);
    return built;
  };
  const requested = (id: string | undefined): string | undefined =>
    opts.honorRequestModel ? id?.trim() || undefined : undefined;

  return async (req) => {
    // Structured output. A caller-supplied JSON-schema is ENFORCED: it is
    // normalized into the strict subset providers accept (every property required
    // + optionals widened to accept null) and submitted to `generateObject`, so
    // the model returns a schema-valid object — no prose/markdown to strip. A
    // schema strict output cannot express THROWS here, before any model call:
    // there is no silent degradation. The call sites whose schemas are
    // inexpressible say so with `enforceSchema: false`, which sends the schema as
    // a prompt hint only and runs the call in JSON mode (still valid JSON, with
    // the caller's Zod validating). JSON mode returns a JSON OBJECT, so that path
    // rejects a non-object-rooted schema too — the opt-out buys out of strict
    // enforcement, never of the object root. Schema-less calls (free-text answers)
    // stay on `generateText`. Computed before the timeout deadline so a rejected
    // schema leaves no timer behind.
    const rawSchema = req.schema ? JSON.parse(req.schema) : undefined;
    const enforced =
      rawSchema !== undefined && req.enforceSchema !== false
        ? normalizeForStrictOutput(rawSchema, req.stage)
        : undefined;
    const jsonMode = rawSchema !== undefined && !enforced;
    if (jsonMode && !isObjectRootedSchema(rawSchema)) throw new NonObjectRootSchemaError(req.stage);
    const { signal, cleanup } = deadline(req.timeoutMs);
    const modelId = requested(req.model) ?? cfg.model;
    const fallbackId = requested(req.fallbackModel) ?? cfg.fallbackModel;
    const fallbackModelId = fallbackId ?? modelId;
    const primary = modelFor(modelId);
    const fallback = fallbackId ? modelFor(fallbackId) : undefined;
    const ctx = currentTrace();
    // Omit an empty/whitespace system prompt — the AI SDK would otherwise send it
    // as an empty text block, which the Anthropic API rejects ("text content blocks
    // must be non-empty"). Callers that pack everything into `user` legitimately
    // pass system: ''.
    const system = req.system?.trim() ? req.system : undefined;
    const promptInput = promptInputOf(req);
    const telemetry = {
      isEnabled: true as const,
      functionId: req.stage ?? 'llm.call',
      metadata: telemetryMeta(req, ctx),
    };
    const run = async (model: LanguageModel): Promise<CapturedResult> => {
      if (enforced) {
        const r = await generateObject({
          model,
          schema: jsonSchema(enforced.schema),
          system,
          ...promptInput,
          abortSignal: signal,
          experimental_telemetry: telemetry,
        });
        // The reply was produced against the NORMALIZED schema, where every
        // optional is required-and-nullable. Drop the nulls that widening
        // introduced before the caller's Zod sees them — it accepts a missing
        // optional, not an explicit null.
        const object = stripInjectedNulls(r.object, enforced.widened);
        return { text: JSON.stringify(object), finishReason: r.finishReason, usage: r.usage };
      }
      if (jsonMode) {
        const r = await generateObject({
          model,
          output: 'no-schema',
          system,
          ...promptInput,
          abortSignal: signal,
          experimental_telemetry: telemetry,
        });
        return { text: JSON.stringify(r.object), finishReason: r.finishReason, usage: r.usage };
      }
      const r = await generateText({
        model,
        system,
        ...promptInput,
        abortSignal: signal,
        experimental_telemetry: telemetry,
      });
      return {
        text: r.text,
        finishReason: r.finishReason,
        reasoningText: r.reasoningText,
        usage: r.usage,
      };
    };

    try {
      let result: CapturedResult;
      let usedFallback = false;
      try {
        result = await run(primary);
      } catch (err) {
        if (!fallback || signal?.aborted) throw err;
        usedFallback = true;
        result = await run(fallback);
      }
      const model = usedFallback ? fallbackModelId : modelId;
      recordUsage(req, model, result, opts.pricing);
      return result.text;
    } finally {
      cleanup();
    }
  };
}

/** Former name of {@link createApiTransport}, kept for callers still on it. */
export const createAiSdkTransport = createApiTransport;
