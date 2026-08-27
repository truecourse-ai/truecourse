/**
 * The api SESSION DRIVER: our own per-turn loop
 * on the AI SDK's `generateText` — tools declared without `execute` so the
 * model's tool call comes back unrun (one step per turn), the FULL message
 * history resent every turn under the configured provider's cache strategy
 * (`provider-tuning.ts` — breakpoints on the system prompt, a cluster's shared
 * prefix and the moving tail, or a per-request cluster key), and a per-turn
 * fallback-model retry.
 *
 * The driver owns MECHANICS only. The policy shell (`runAgentLoop` in
 * `@truecourse/shared/llm`) counts budgets from the events emitted here and
 * enforces them through `interrupt()`; tool argument validation lives in the
 * shell's tool wrapper, whose `SessionToolArgsError` this driver maps into
 * the re-ask path.
 *
 * The structured outcome is an injected `outcome` TOOL (this driver's
 * declared `structuredOutcome: 'tool'` capability): the model ends the
 * session by calling it with a value the shell validates against the
 * session's outcome schema. The name is reserved — a session tool may not
 * use it.
 */

import { randomUUID } from 'node:crypto';
import {
  generateText,
  jsonSchema,
  tool,
  type LanguageModel,
  type ModelMessage,
  type SystemModelMessage,
  type ToolSet,
} from 'ai';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ZodTypeAny } from 'zod';
import type {
  DriverResult,
  SessionDef,
  SessionDriver,
  SessionEventBody,
  SessionFailure,
  SessionEvent,
  SessionRunInput,
  SessionStatus,
  ToolContext,
  TurnUsage,
  RawPayload,
} from '@truecourse/agent-loop';
import { buildModel } from './model.js';
import { normalizeForStrictOutput, stripInjectedNulls, type SchemaPath } from './strict-schema.js';
import { providerTuningFor, type ProviderTuning } from './provider-tuning.js';
import type { ProviderConfig } from './types.js';
import { callUsageOf, type CallUsage } from './transport.js';

/** Reserved tool name the model calls to end the session with its outcome. */
export const OUTCOME_TOOL_NAME = 'outcome';

/** Sent when the session has no opening message at all. */
const BEGIN_MESSAGE = 'Begin.';
/** Sent after a text-only (deliberation) turn so the history keeps
 *  alternating; recorded as a real user message — the model saw it. */
const CONTINUE_NUDGE = `Continue. When you have reached the final result, call the \`${OUTCOME_TOOL_NAME}\` tool.`;

/**
 * How this driver answers a provider failure (item 11). The AI SDK's own
 * retry has no observation hook, so `maxRetries: 0` hands the loop to us and
 * every wait becomes a `provider-retry` transcript event. Attempts are per
 * TURN and per MODEL: the primary gets `attempts` tries, then the fallback
 * (when configured) gets the same allowance.
 */
export interface ApiRetryPolicy {
  /** Tries on ONE model, the first included. */
  attempts: number;
  /** The first backoff; doubled per attempt. The ladder is also a FLOOR under
   *  `Retry-After` — see {@link retryDelayMs}. */
  baseDelayMs: number;
  /** Cap on a SINGLE wait's deterministic part — a `Retry-After` past it is
   *  clamped, not obeyed. Jitter (up to +{@link RETRY_JITTER}) rides on top. */
  maxDelayMs: number;
}

export const DEFAULT_API_RETRY: ApiRetryPolicy = {
  attempts: 5,
  baseDelayMs: 2_000,
  maxDelayMs: 60_000,
};

/** Waits stretch by up to this fraction, uniformly at random, so concurrent
 *  sessions that failed together do not re-collide on the same tick. */
export const RETRY_JITTER = 0.25;

/**
 * The wait before one retry (`attempt` is 1-based). Three rules (01 step 2i):
 *
 * - The exponential ladder (`baseDelayMs · 2^(attempt-1)`) FLOORS a provider's
 *   `Retry-After`: the header is advice about a world that does not include
 *   the load we ourselves are generating — twenty concurrent sessions each
 *   politely waiting the suggested 1s keep the deployment saturated forever.
 *   A `Retry-After` above the ladder is obeyed (clamped by `maxDelayMs`).
 * - `maxDelayMs` caps the deterministic part.
 * - Jitter stretches the result by up to +{@link RETRY_JITTER}, so it may
 *   exceed `maxDelayMs` by that fraction.
 *
 * Pure: `random` (uniform in [0, 1)) is injected for tests.
 */
export function retryDelayMs(
  policy: ApiRetryPolicy,
  attempt: number,
  retryAfterMs: number | undefined,
  random: () => number = Math.random,
): number {
  const ladder = policy.baseDelayMs * 2 ** (attempt - 1);
  const floored = retryAfterMs === undefined ? ladder : Math.max(retryAfterMs, ladder);
  const wait = Math.min(floored, policy.maxDelayMs);
  return Math.round(wait * (1 + RETRY_JITTER * random()));
}

export interface ApiSessionDriverOptions {
  /** Cost for one turn's usage, in USD — same hook as the one-shot transport.
   *  Present ⇒ turns record `costSource: 'model-priced'`; absent ⇒ `unpriced`. */
  pricing?: (modelId: string, usage: CallUsage) => number;
  /** Overrides on `DEFAULT_API_RETRY`, field by field. */
  retry?: Partial<ApiRetryPolicy>;
  /**
   * Pins the prompt-cache CLUSTER for the providers that key their cache per
   * REQUEST (openai, copilot) — calls sharing a key share a warm prefix.
   * A string pins one cluster across every session this driver runs; a
   * function is handed the driver's per-session id and returns the key.
   * Default: that session id, so one session's turns cluster together and
   * separate sessions never collide. Ignored by anthropic and bedrock, which
   * key their cache by the prefix content itself.
   *
   * A run that declares a `sharedPrefix` per session (item 8) names its cluster
   * there instead, and that key wins: it is the one the shared prefix is
   * actually shared under.
   */
  cacheKey?: string | ((sessionId: string) => string);
  /** Test seam: what a backoff wait is made of. Aborts with the signal. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** Test seam: the jitter's randomness (uniform in [0, 1)). */
  random?: () => number;
}

export function createApiSessionDriver(
  cfg: ProviderConfig,
  opts: ApiSessionDriverOptions = {},
): SessionDriver {
  const primary = { model: buildModel(cfg, cfg.model), modelId: cfg.model };
  const fallback = cfg.fallbackModel
    ? { model: buildModel(cfg, cfg.fallbackModel), modelId: cfg.fallbackModel }
    : undefined;
  const retry = { ...DEFAULT_API_RETRY, ...opts.retry };
  // Declared once, from the config — never re-decided at a call site.
  const tuning = providerTuningFor(cfg.provider);

  return {
    capabilities: { steering: 'turn-boundary', structuredOutcome: 'tool', resumeAtMessage: false },
    // Declared, never inferred: the config IS the answer to "what ran this".
    // The key and the headers stay out — a transcript is not a credential store.
    attribution: {
      provider: cfg.provider,
      model: cfg.model,
      ...(cfg.fallbackModel ? { fallbackModel: cfg.fallbackModel } : {}),
      ...(cfg.baseURL ? { endpoint: cfg.baseURL } : {}),
    },
    runSession(input) {
      let interrupted = false;
      let status: SessionStatus = 'running';
      const steers: string[] = [];
      const sessionId = randomUUID();

      const done = runApiSession(input, {
        primary,
        fallback,
        pricing: opts.pricing,
        retry,
        tuning,
        cacheKey:
          input.sharedPrefix?.cacheKey ??
          (typeof opts.cacheKey === 'function'
            ? opts.cacheKey(sessionId)
            : (opts.cacheKey ?? sessionId)),
        sharedPrefix: input.sharedPrefix?.messages.length ?? 0,
        sleep: opts.sleep ?? delay,
        random: opts.random ?? Math.random,
        onEvent: input.onEvent,
        interrupted: () => interrupted,
        drainSteers: () => steers.splice(0),
      }).then((result) => {
        status = result.kind === 'outcome' ? 'completed' : 'failed';
        return result;
      });

      return {
        done,
        status: () => status,
        steer: (message) => steers.push(message),
        interrupt: async () => {
          interrupted = true;
          // Settlement only — the shell's own `await handle.done` observes any
          // rejection. Without the rejection handler here, this second consumer
          // of `done` would turn a driver-defect rejection during an interrupt
          // into an unhandledRejection that kills the whole process.
          await done.then(
            () => undefined,
            () => undefined,
          );
        },
      };
    },
  };
}

interface SessionRuntime {
  primary: { model: LanguageModel; modelId: string };
  fallback?: { model: LanguageModel; modelId: string };
  pricing?: ApiSessionDriverOptions['pricing'];
  retry: ApiRetryPolicy;
  /** The configured provider's cache + tool-call strategy (item 7). */
  tuning: ProviderTuning;
  /** Resolved once per session — the cluster the request-keyed providers cache under. */
  cacheKey: string;
  /** How many leading messages are the cluster's shared prefix; 0 = none. */
  sharedPrefix: number;
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  /** The jitter's randomness — injected so retry waits are unit-testable. */
  random: () => number;
  /** The turn loop's own emitter, threaded down so a wait INSIDE one model
   *  call is recorded where it happened rather than inferred afterwards. */
  onEvent: SessionRunInput['onEvent'];
  interrupted: () => boolean;
  drainSteers: () => string[];
}

async function runApiSession(input: SessionRunInput, rt: SessionRuntime): Promise<DriverResult> {
  const { def, onEvent, signal } = input;
  const { toolset, widenedByTool } = buildToolset(def);
  const toolByName = new Map(def.tools.map((t) => [t.name, t]));
  // The shell's tool wrapper ignores the driver's ctx and injects its own;
  // this stub only satisfies the call signature.
  const driverToolCtx: ToolContext = {
    workItem: '',
    signal,
    dispatchChild: () => Promise.reject(new Error('dispatchChild is shell-provided')),
  };

  const messages: ModelMessage[] = [];
  if (input.resume) messages.push(...rebuildHistory(input.resume.events));
  // On a resume the transcript already carries the original opening messages;
  // whatever arrives here is a NEW observation.
  const say = (content: string): void => {
    messages.push({ role: 'user', content });
    onEvent({ type: 'user-message', content });
  };
  // The cluster's shared prefix opens a FRESH conversation, ahead of anything
  // this session alone was told. A resume rebuilds it out of the transcript
  // like any other user message, so saying it again would both duplicate it and
  // move the boundary the breakpoint below sits on.
  if (!input.resume) for (const content of input.sharedPrefix?.messages ?? []) say(content);
  for (const content of input.initialMessages) say(content);
  if (messages.length === 0) say(BEGIN_MESSAGE);

  const endedWithoutOutcome: DriverResult = {
    kind: 'failure',
    failure: { kind: 'malformed', detail: 'session ended without outcome', retryability: 'none' },
  };

  for (;;) {
    if (rt.interrupted() || signal.aborted) return endedWithoutOutcome;
    for (const m of rt.drainSteers()) say(m);

    let result: Awaited<ReturnType<typeof generateText>>;
    let modelId: string;
    try {
      ({ result, modelId } = await callModel(def, messages, toolset, signal, rt));
    } catch (err) {
      return { kind: 'failure', failure: classifyTransportError(err, signal) };
    }

    const usage = turnUsageOf(result.usage, modelId, rt.pricing);
    const toolCalls = result.toolCalls;
    const first = toolCalls[0];
    // What the RESPONSE says served the turn, which the configured model id
    // does not always answer: on Bedrock/Foundry it is a deployment name, and
    // a fallback swap changes it mid-session.
    const respondedModelId = result.response.modelId;
    const raw: RawPayload = {
      source: 'llm-api.generateText',
      payload: {
        modelId: respondedModelId,
        messages: result.response.messages,
        finishReason: result.finishReason,
        usage: result.usage,
      },
    };
    onEvent({
      type: 'assistant-turn',
      ...(result.text ? { text: result.text } : {}),
      ...(first
        ? { toolCall: { name: first.toolName, args: strippedInput(first, widenedByTool) } }
        : {}),
      usage,
      ...(respondedModelId ? { model: respondedModelId } : {}),
      raw,
    } as SessionEventBody & { raw?: RawPayload });
    messages.push(...(result.response.messages as ModelMessage[]));

    if (!first) {
      say(CONTINUE_NUDGE);
      continue;
    }

    let outcomeValue: unknown;
    let sawOutcome = false;
    for (const call of toolCalls) {
      // v6 surfaces an unknown or unparsable tool call as an invalid dynamic
      // call rather than throwing — the malformed cases. The call id still
      // gets an error result so the provider protocol stays well-formed.
      if (call.dynamic && (call.invalid || !toolByName.has(call.toolName))) {
        const reason =
          call.error instanceof Error ? call.error.message : `unknown tool \`${call.toolName}\``;
        replyToCall(messages, call.toolCallId, call.toolName, reason, true);
        onEvent({ type: 're-ask', invalid: JSON.stringify(call.input ?? null), reason });
        continue;
      }
      if (call.toolName === OUTCOME_TOOL_NAME) {
        sawOutcome = true;
        outcomeValue = strippedInput(call, widenedByTool);
        replyToCall(messages, call.toolCallId, call.toolName, 'outcome recorded', false);
        continue;
      }
      const sessionTool = toolByName.get(call.toolName);
      if (!sessionTool) {
        const reason = `unknown tool \`${call.toolName}\``;
        replyToCall(messages, call.toolCallId, call.toolName, reason, true);
        onEvent({ type: 're-ask', invalid: JSON.stringify(call.input ?? null), reason });
        continue;
      }
      try {
        const toolResult = await sessionTool.execute(
          strippedInput(call, widenedByTool),
          driverToolCtx,
        );
        replyToCall(
          messages,
          call.toolCallId,
          call.toolName,
          toolResult.content,
          toolResult.isError === true,
        );
        onEvent({
          type: 'tool-result',
          toolName: call.toolName,
          content: toolResult.content,
          ...(toolResult.isError !== undefined ? { isError: toolResult.isError } : {}),
        });
      } catch (err) {
        // Name-based check: the shell may be a different module instance of
        // `@truecourse/shared` than this package resolves, so `instanceof`
        // across the boundary is unreliable.
        if (err instanceof Error && err.name === 'SessionToolArgsError') {
          replyToCall(messages, call.toolCallId, call.toolName, err.message, true);
          onEvent({ type: 're-ask', invalid: JSON.stringify(call.input ?? null), reason: err.message });
        } else {
          // A throwing tool is a defect; surfaced as an error OBSERVATION the
          // session can react to, never a session failure.
          const message = `tool \`${call.toolName}\` crashed: ${err instanceof Error ? err.message : String(err)}`;
          replyToCall(messages, call.toolCallId, call.toolName, message, true);
          onEvent({ type: 'tool-result', toolName: call.toolName, content: message, isError: true });
        }
      }
    }
    if (sawOutcome) return { kind: 'outcome', value: outcomeValue };
  }
}

/**
 * One model call, full history under the provider's cache strategy, retries
 * and the fallback swap. `maxRetries: 0` takes the retry away from the SDK —
 * it has no observation hook, and an unexplained multi-minute gap in a
 * transcript is indistinguishable from a hang. Every wait is a
 * `provider-retry` event instead; the shell ignores them for budget, so a
 * retry is never a turn.
 */
async function callModel(
  def: SessionDef,
  messages: readonly ModelMessage[],
  tools: ToolSet,
  signal: AbortSignal,
  rt: SessionRuntime,
): Promise<{ result: Awaited<ReturnType<typeof generateText>>; modelId: string }> {
  // The system prompt and the moving tail close the two cacheable prefixes,
  // and a cluster's shared prefix closes a third BETWEEN them: without a
  // breakpoint of its own it would only ever be cached as part of one session's
  // tail, which the next session of the cluster cannot read. A provider that
  // keys its cache per request leaves all of them unmarked.
  const breakpoint = rt.tuning.breakpoint;
  const sharedEnd = rt.sharedPrefix - 1;
  // The system prompt rides the SDK's `system` option, never `messages`: a
  // system role inside `messages` earns an "…can be a security risk…" warning
  // on stderr for every call, which garbles the CLI's progress output. As a
  // `SystemModelMessage` (not a bare string) it still carries its cache
  // breakpoint, and the SDK prepends it as the first message of the provider
  // prompt — so the request on the wire is unchanged. Resume changes nothing
  // either: the system prompt has always come from the session DEF, and
  // `rebuildHistory` never emits a system message.
  const system: SystemModelMessage = {
    role: 'system',
    content: def.systemPrompt,
    ...(breakpoint ? { providerOptions: breakpoint } : {}),
  };
  const prompt: ModelMessage[] = messages.map((m, i) =>
    breakpoint && (i === messages.length - 1 || i === sharedEnd)
      ? ({ ...m, providerOptions: { ...m.providerOptions, ...breakpoint } } as ModelMessage)
      : m,
  );
  const run = (candidate: { model: LanguageModel; modelId: string }) =>
    generateText({
      model: candidate.model,
      system,
      messages: prompt,
      tools,
      abortSignal: signal,
      maxRetries: 0,
      // Carries the prompt-cache cluster key and, because the transcript
      // event models ONE tool call per turn, this provider's way of asking
      // for a single call. A turn that still carries several is executed in
      // full — see the loop.
      providerOptions: rt.tuning.callOptions(candidate.modelId, rt.cacheKey),
    });

  const candidates = rt.fallback ? [rt.primary, rt.fallback] : [rt.primary];
  let retries = 0;
  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index];
    for (let attempt = 1; attempt <= rt.retry.attempts; attempt++) {
      try {
        return { result: await run(candidate), modelId: candidate.modelId };
      } catch (err) {
        // An abort is a decision, not a provider problem: never retried.
        if (signal.aborted) throw err;
        const failure = retryabilityOf(err);
        const again = attempt < rt.retry.attempts && failure.retryable;
        // Out of tries on this model — the fallback is the next thing to try,
        // and the swap is recorded like any other retry rather than silently.
        const next = again ? candidate : candidates[index + 1];
        if (!next) throw err;
        const delayMs = again ? retryDelayMs(rt.retry, attempt, failure.retryAfterMs, rt.random) : 0;
        rt.onEvent({
          type: 'provider-retry',
          attempt: ++retries,
          ...(failure.status !== undefined ? { status: failure.status } : {}),
          message: err instanceof Error ? err.message : String(err),
          delayMs,
          model: next.modelId,
        });
        if (delayMs > 0) await rt.sleep(delayMs, signal);
        // A shell interrupt lands mid-turn: stop spending waits on a turn
        // whose result is about to be discarded anyway.
        if (rt.interrupted() || signal.aborted) throw err;
        if (!again) break; // move on to the fallback model
      }
    }
  }
  /* c8 ignore next -- the loops above always return or throw */
  throw new Error('unreachable: no model candidate left');
}

/**
 * Is another attempt worth making? Read from the error's SHAPE, never its
 * message — and by shape rather than `instanceof`, the same reason the tool
 * paths use a name check: the SDK error may come from a different module
 * instance than this file resolves.
 *
 * `isRetryable` is the SDK's own verdict on a call it made (`APICallError`,
 * `GatewayError`): 408/409/429, 5xx and its transport cases. A status the SDK
 * judged final is final. Everything left carried no response at all — a
 * connection failure (timeout, reset) worth another attempt, unless it is an
 * SDK error (every one of them is named `AI_*`), which means a bad argument,
 * tool or schema on our side: a defect retrying cannot fix.
 */
function retryabilityOf(err: unknown): {
  retryable: boolean;
  status?: number;
  retryAfterMs?: number;
} {
  const shape = err as {
    statusCode?: unknown;
    isRetryable?: unknown;
    responseHeaders?: Record<string, string>;
  };
  const status = typeof shape?.statusCode === 'number' ? shape.statusCode : undefined;
  if (typeof shape?.isRetryable === 'boolean') {
    const retryAfterMs = retryAfterOf(shape.responseHeaders);
    return {
      retryable: shape.isRetryable,
      ...(status !== undefined ? { status } : {}),
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    };
  }
  if (status !== undefined) return { retryable: false, status };
  return { retryable: !(err instanceof Error && err.name.startsWith('AI_')) };
}

/** `Retry-After`, in either legal form: delta-seconds or an HTTP date. */
function retryAfterOf(headers: Record<string, string> | undefined): number | undefined {
  const value = headers?.['retry-after'] ?? headers?.['Retry-After'];
  if (value === undefined) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, at - Date.now());
}

/** An abortable wait — an interrupt must not sit out a 60s backoff. */
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
  });
}

/**
 * Compile the session's tools (plus the injected outcome tool) into the AI
 * SDK toolset. Input schemas ride the same strict-subset normalization the
 * structured-output path uses; where a schema is inexpressible in the strict
 * subset it is sent as-is (the shell's Zod validation still gates `execute`).
 * Tools carry no `execute` — one step per turn, the loop runs them.
 */
function buildToolset(def: SessionDef): {
  toolset: ToolSet;
  widenedByTool: Map<string, readonly SchemaPath[]>;
} {
  const toolset: ToolSet = {};
  const widenedByTool = new Map<string, readonly SchemaPath[]>();
  const add = (name: string, description: string, schema: ZodTypeAny): void => {
    const rawSchema = zodToJsonSchema(schema, { $refStrategy: 'none' });
    let inputSchema: unknown = rawSchema;
    let widened: readonly SchemaPath[] = [];
    try {
      const strict = normalizeForStrictOutput(rawSchema);
      inputSchema = strict.schema;
      widened = strict.widened;
    } catch {
      /* inexpressible in the strict subset — send unnormalized */
    }
    toolset[name] = tool({ description, inputSchema: jsonSchema(inputSchema as never) });
    widenedByTool.set(name, widened);
  };
  for (const t of def.tools) {
    if (t.name === OUTCOME_TOOL_NAME) {
      throw new Error(`session tool name \`${OUTCOME_TOOL_NAME}\` is reserved for the outcome`);
    }
    add(t.name, t.description, t.inputSchema);
  }
  add(
    OUTCOME_TOOL_NAME,
    'Report the final structured outcome of this session. Call exactly once, when the work is done.',
    def.outcomeSchema as unknown as ZodTypeAny,
  );
  return { toolset, widenedByTool };
}

/** Drop the nulls the strict-schema widening introduced before anything
 *  downstream (the shell's Zod, the transcript) sees the args. */
function strippedInput(
  call: { toolName: string; input: unknown },
  widenedByTool: Map<string, readonly SchemaPath[]>,
): unknown {
  const widened = widenedByTool.get(call.toolName);
  return widened && widened.length > 0 ? stripInjectedNulls(call.input, widened) : call.input;
}

/** Answer one tool-call id so the provider conversation stays well-formed. */
function replyToCall(
  messages: ModelMessage[],
  toolCallId: string,
  toolName: string,
  value: string,
  isError: boolean,
): void {
  messages.push({
    role: 'tool',
    content: [
      {
        type: 'tool-result',
        toolCallId,
        toolName,
        output: { type: isError ? 'error-text' : 'text', value },
      },
    ],
  });
}

/**
 * Rebuild the exact message history from a persisted transcript (events
 * carry full content, so completeness is correctness). Non-
 * conversational events (grants, children, questions, terminal records) are
 * skipped; a tool call the transcript never answered — an interrupt landed
 * mid-flight — is closed with an error result so the history stays legal.
 */
function rebuildHistory(events: readonly SessionEvent[]): ModelMessage[] {
  const messages: ModelMessage[] = [];
  let pending: { toolCallId: string; toolName: string } | undefined;
  let counter = 0;
  const closePending = (reason: string): void => {
    if (!pending) return;
    messages.push({
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: pending.toolCallId,
          toolName: pending.toolName,
          output: { type: 'error-text', value: reason },
        },
      ],
    });
    pending = undefined;
  };
  for (const event of events) {
    switch (event.type) {
      case 'user-message':
        closePending('interrupted before the tool result was recorded');
        messages.push({ role: 'user', content: event.content });
        break;
      case 'assistant-turn': {
        closePending('interrupted before the tool result was recorded');
        const parts: Extract<ModelMessage, { role: 'assistant' }>['content'] = [];
        if (event.text) parts.push({ type: 'text', text: event.text });
        if (event.toolCall) {
          const toolCallId = `resume-call-${counter++}`;
          parts.push({
            type: 'tool-call',
            toolCallId,
            toolName: event.toolCall.name,
            input: event.toolCall.args,
          });
          pending = { toolCallId, toolName: event.toolCall.name };
        }
        if (parts.length > 0) messages.push({ role: 'assistant', content: parts });
        break;
      }
      case 'tool-result':
        if (pending) {
          messages.push({
            role: 'tool',
            content: [
              {
                type: 'tool-result',
                toolCallId: pending.toolCallId,
                toolName: event.toolName,
                output: { type: event.isError ? 'error-text' : 'text', value: event.content },
              },
            ],
          });
          pending = undefined;
        } else {
          // A parallel second call's result: the event schema recorded only
          // the turn's first call, so there is no call to pair this with.
          // Re-enter it as an explicitly labeled user message — honest about
          // its provenance — rather than fabricate a tool-call pair.
          messages.push({
            role: 'user',
            content: `[transcript] Result of an additional parallel \`${event.toolName}\` call from the previous turn: ${event.content}`,
          });
        }
        break;
      case 're-ask':
        if (pending) {
          closePending(event.reason);
        } else {
          messages.push({
            role: 'user',
            content: `Your previous action was invalid (${event.reason}): ${event.invalid}`,
          });
        }
        break;
      default:
        break;
    }
  }
  closePending('interrupted before the tool result was recorded');
  return messages;
}

/** Split the SDK usage into `TurnUsage`, pricing when a hook is present. */
function turnUsageOf(
  usage: Awaited<ReturnType<typeof generateText>>['usage'] | undefined,
  modelId: string,
  pricing: ApiSessionDriverOptions['pricing'],
): TurnUsage {
  const callUsage: CallUsage = callUsageOf(usage);
  let costUsd = 0;
  let costSource: TurnUsage['costSource'] = 'unpriced';
  if (pricing) {
    try {
      const priced = pricing(modelId, callUsage);
      if (Number.isFinite(priced)) {
        costUsd = priced;
        costSource = 'model-priced';
      }
    } catch {
      /* pricing is observational */
    }
  }
  const reasoningTokens = usage?.outputTokenDetails?.reasoningTokens;
  return {
    ...callUsage,
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
    costUsd,
    costSource,
  };
}

/** The retryability axis, from the error's shape — never its message. */
function classifyTransportError(err: unknown, signal: AbortSignal): SessionFailure {
  const detail = err instanceof Error ? err.message : String(err);
  if (signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
    return { kind: 'transport', detail, class: 'transport', retryability: 'none' };
  }
  const statusCode =
    typeof (err as { statusCode?: unknown })?.statusCode === 'number'
      ? ((err as { statusCode: number }).statusCode)
      : undefined;
  if (statusCode === 401 || statusCode === 403) {
    return { kind: 'transport', detail, class: 'permission', retryability: 'blocked' };
  }
  if (statusCode === 400 || statusCode === 404 || statusCode === 422) {
    return { kind: 'transport', detail, class: 'validation', retryability: 'none' };
  }
  if (statusCode !== undefined) {
    return { kind: 'transport', detail, class: 'provider', retryability: 'transient' };
  }
  return { kind: 'transport', detail, class: 'transport', retryability: 'transient' };
}
