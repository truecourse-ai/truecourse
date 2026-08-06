/**
 * The direct-API LLM transport: implements `@truecourse/shared/llm`'s
 * `LlmTransport` on top of the Vercel AI SDK, so TrueCourse talks to
 * Anthropic / OpenAI / Bedrock / Copilot over their APIs instead of spawning a
 * `claude` binary. Both editions install one process-wide via
 * `setDefaultTransport` — the OSS CLI from the user's global config, `ee-server`
 * from the active stored provider config.
 *
 * Like the cli backend, it is content-agnostic: it returns the model's RAW
 * assistant text and the caller (each runner) strips fences + parses + Zod-
 * validates. The provider config fixes the model(s); the request's
 * `model`/`fallbackModel` hints are ignored unless `honorRequestModel` is set
 * (the OSS CLI sets it, so per-stage model overrides keep working).
 *
 * ACCOUNTING: every successful call reports its tokens to the shared per-stage
 * usage table, with a cost from the optional `pricing` hook — the same
 * ` · model · tokens · $cost` tags the cli backend produces.
 *
 * OBSERVABILITY: when a `recorder` is supplied (EE only — OSS passes none),
 * every call (success or failure) is captured as one trace — the prompt/output
 * the SDK already has, plus token usage/latency/finish reason, tagged with the
 * ambient `currentTrace()` (org / job / repo). Recording NEVER breaks the call:
 * a recorder error is swallowed. The AI SDK's native OpenTelemetry emission is
 * also enabled (`experimental_telemetry`), so the same calls stay OTel-standard
 * for a future exporter.
 */

import { generateText, generateObject, jsonSchema, tool, type LanguageModel, type ModelMessage } from 'ai';
import {
  recordStageUsage,
  resolveTimeoutScale,
  type LlmRequest,
  type LlmTransport,
  type LlmTransportWithTurn,
  type LlmTurnFn,
  type LlmTurnMessage,
  type LlmTurnReply,
  type LlmTurnRequest,
} from '@truecourse/shared/llm';
import type { LlmTraceInput, LlmTraceRecorder, TraceStatus } from '@truecourse/shared';
import { buildModel } from './model.js';
import {
  isObjectRootedSchema,
  NonObjectRootSchemaError,
  normalizeForStrictOutput,
  stripInjectedNulls,
} from './strict-schema.js';
import { currentTrace, type TraceContext } from './trace-context.js';
import type { ProviderConfig } from './types.js';

/** One call's token counts, in the same buckets the cli backend reports. */
export interface CallUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
}

export interface ApiTransportOptions {
  /** Trace sink. Omit (e.g. OSS, or the config-probe call) to record nothing. */
  recorder?: LlmTraceRecorder;
  /**
   * Cost for one call's usage, in USD. Omit (EE, the config probe) and calls are
   * recorded with a zero cost — tokens are still counted.
   */
  pricing?: (modelId: string, usage: CallUsage) => number;
  /**
   * Run each request on its own `model`/`fallbackModel` when it carries one,
   * falling back to the config's. Off by default: EE fixes the model in the
   * stored provider config and its requests carry cli tier aliases.
   */
  honorRequestModel?: boolean;
}

/** Former name of {@link ApiTransportOptions}, kept for EE consumers. */
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
 * non-cached detail when the provider reports one.
 */
function callUsageOf(usage: CapturedResult['usage']): CallUsage {
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
 * signal, so the timeout is the only cancellation source.)
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

/** The granular unit id the call processed, parsed from `LlmRequest.id`. */
function sliceIdOf(id: string | undefined): string | null {
  if (!id) return null;
  const i = id.indexOf(':');
  return i >= 0 ? id.slice(i + 1) : null;
}

/** Per-call metadata for the AI SDK's OTel emission (attributes must be scalars). */
function telemetryMeta(
  req: Pick<LlmRequest, 'stage' | 'id'>,
  ctx: TraceContext | undefined,
): Record<string, string> {
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
  req: Pick<LlmRequest, 'stage' | 'id' | 'system' | 'user'>,
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

/** Report one successful call's tokens + cost to the shared per-stage table. */
function recordUsage(
  stage: string | undefined,
  model: string,
  result: CapturedResult,
  pricing: ApiTransportOptions['pricing'],
): { usage: CallUsage; costUsd: number } {
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
  recordStageUsage(stage, { model, ...usage, costUsd });
  return { usage, costUsd };
}

/** Record without ever breaking the call: the store's failure must not throw out. */
async function safeRecord(recorder: LlmTraceRecorder | undefined, input: LlmTraceInput): Promise<void> {
  if (!recorder) return;
  try {
    await recorder.record(input);
  } catch (err) {
    console.warn(`[llm-api] trace record failed: ${(err as Error).message}`);
  }
}

/**
 * Build an `LlmTransport` for `cfg`. Runs on the primary model; on a non-abort
 * error, retries once on the fallback (never after the signal aborts).
 */
export function createApiTransport(
  cfg: ProviderConfig,
  opts: ApiTransportOptions = {},
): LlmTransportWithTurn {
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
  const recorder = opts.recorder;
  const requested = (id: string | undefined): string | undefined =>
    opts.honorRequestModel ? id?.trim() || undefined : undefined;

  const transport: LlmTransportWithTurn = async (req) => {
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
    const startedAt = Date.now();
    // Omit an empty/whitespace system prompt — the AI SDK would otherwise send it
    // as an empty text block, which the Anthropic API rejects ("text content blocks
    // must be non-empty"). Callers that pack everything into `user` legitimately
    // pass system: ''.
    const system = req.system?.trim() ? req.system : undefined;
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
          prompt: req.user,
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
          prompt: req.user,
          abortSignal: signal,
          experimental_telemetry: telemetry,
        });
        return { text: JSON.stringify(r.object), finishReason: r.finishReason, usage: r.usage };
      }
      const r = await generateText({
        model,
        system,
        prompt: req.user,
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
      let result: Awaited<ReturnType<typeof run>>;
      let usedFallback = false;
      try {
        result = await run(primary);
      } catch (err) {
        if (!fallback || signal?.aborted) {
          await safeRecord(recorder, errorTrace(baseTrace(req, ctx, cfg, modelId, false, startedAt), err));
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
      const model = usedFallback ? fallbackModelId : modelId;
      recordUsage(req.stage, model, result, opts.pricing);
      await safeRecord(recorder, okTrace(baseTrace(req, ctx, cfg, model, usedFallback, startedAt), result));
      return result.text;
    } finally {
      cleanup();
    }
  };

  transport.turn = apiTurn(cfg, opts, modelFor, requested);
  return transport;
}

/** Rebuild the SDK's message array from the loop's neutral history. A text-
 *  parsed action has no provider call id, so its result rides a plain user
 *  message (the loop already renders it that way); only native calls produce
 *  `tool`-role messages here. */
function toModelMessages(messages: LlmTurnMessage[]): ModelMessage[] {
  return messages.map((m): ModelMessage => {
    if (m.role === 'user') return { role: 'user', content: m.text };
    if (m.role === 'assistant') {
      if (!m.toolCall) return { role: 'assistant', content: m.text };
      return {
        role: 'assistant',
        content: [
          ...(m.text ? [{ type: 'text' as const, text: m.text }] : []),
          {
            type: 'tool-call' as const,
            toolCallId: m.toolCall.id ?? 'call_0',
            toolName: m.toolCall.name,
            input: m.toolCall.arguments,
          },
        ],
      };
    }
    return {
      role: 'tool',
      content: [
        {
          type: 'tool-result' as const,
          toolCallId: m.toolCallId ?? 'call_0',
          toolName: m.toolName ?? 'tool',
          output: { type: 'text' as const, value: m.text },
        },
      ],
    };
  });
}

/**
 * The api turn backend: AI SDK native tool calling, one step per turn. Tools
 * are declared WITHOUT `execute`, so the SDK returns the model's tool call
 * instead of running anything — dispatch belongs to the agent loop. The full
 * history replays on every turn (no server-side session in api mode); provider
 * prompt caching keeps the replay cheap.
 */
function apiTurn(
  cfg: ProviderConfig,
  opts: ApiTransportOptions,
  modelFor: (id: string) => LanguageModel,
  requested: (id: string | undefined) => string | undefined,
): LlmTurnFn {
  const recorder = opts.recorder;
  const turn = async (req: LlmTurnRequest): Promise<LlmTurnReply> => {
    const { signal, cleanup } = deadline(req.timeoutMs);
    const modelId = requested(req.model) ?? cfg.model;
    const fallbackId = requested(req.fallbackModel) ?? cfg.fallbackModel;
    const fallbackModelId = fallbackId ?? modelId;
    const primary = modelFor(modelId);
    const fallback = fallbackId ? modelFor(fallbackId) : undefined;
    const ctx = currentTrace();
    const startedAt = Date.now();
    const system = req.system?.trim() ? req.system : undefined;
    const messages = toModelMessages(req.messages);
    const tools = Object.fromEntries(
      req.tools.map((t) => [
        t.name,
        tool({ description: t.description, inputSchema: jsonSchema(JSON.parse(t.schema)) }),
      ]),
    );
    const telemetry = {
      isEnabled: true as const,
      functionId: req.stage ?? 'llm.turn',
      metadata: telemetryMeta({ stage: req.stage, id: req.id }, ctx),
    };
    // Trace identity: the turn's user side is its trailing message.
    const lastText = req.messages[req.messages.length - 1]?.text ?? '';
    const traceReq = { system: req.system, user: lastText, stage: req.stage, id: req.id };
    const runTurn = (model: LanguageModel) =>
      generateText({
        model,
        system,
        messages,
        tools,
        abortSignal: signal,
        experimental_telemetry: telemetry,
      });
    try {
      let result: Awaited<ReturnType<typeof runTurn>>;
      let usedFallback = false;
      try {
        result = await runTurn(primary);
      } catch (err) {
        if (!fallback || signal?.aborted) {
          await safeRecord(recorder, errorTrace(baseTrace(traceReq, ctx, cfg, modelId, false, startedAt), err));
          throw err;
        }
        usedFallback = true;
        try {
          result = await runTurn(fallback);
        } catch (err2) {
          await safeRecord(
            recorder,
            errorTrace(baseTrace(traceReq, ctx, cfg, fallbackModelId, true, startedAt), err2),
          );
          throw err2;
        }
      }
      const model = usedFallback ? fallbackModelId : modelId;
      const tc = result.toolCalls?.[0];
      const outputText = result.text || (tc ? JSON.stringify({ tool: tc.toolName, args: tc.input }) : '');
      const captured: CapturedResult = {
        text: outputText,
        finishReason: result.finishReason,
        usage: result.usage,
      };
      const { usage, costUsd } = recordUsage(req.stage, model, captured, opts.pricing);
      await safeRecord(recorder, okTrace(baseTrace(traceReq, ctx, cfg, model, usedFallback, startedAt), captured));
      return {
        text: result.text ?? '',
        ...(tc ? { toolCall: { id: tc.toolCallId, name: tc.toolName, arguments: tc.input } } : {}),
        usage: { ...usage, costUsd },
      };
    } finally {
      cleanup();
    }
  };
  turn.nativeTools = true;
  return turn;
}

/** Former name of {@link createApiTransport}, kept for EE consumers. */
export const createAiSdkTransport = createApiTransport;
