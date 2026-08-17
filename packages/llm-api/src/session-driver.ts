/**
 * The api SESSION DRIVER (AGENTIC_PIPELINE_PLAN §3.3): our own per-turn loop
 * on the AI SDK's `generateText` — tools declared without `execute` so the
 * model's tool call comes back unrun (one step per turn), the FULL message
 * history resent every turn with `cache_control` breakpoints on the system
 * prompt and the moving tail, and a per-turn fallback-model retry.
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

import { generateText, jsonSchema, tool, type LanguageModel, type ModelMessage, type ToolSet } from 'ai';
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
import type { ProviderConfig } from './types.js';
import { callUsageOf, type CallUsage } from './transport.js';

/** Reserved tool name the model calls to end the session with its outcome. */
export const OUTCOME_TOOL_NAME = 'outcome';

/** Sent when the session has no opening message at all. */
const BEGIN_MESSAGE = 'Begin.';
/** Sent after a text-only (deliberation) turn so the history keeps
 *  alternating; recorded as a real user message — the model saw it. */
const CONTINUE_NUDGE = `Continue. When you have reached the final result, call the \`${OUTCOME_TOOL_NAME}\` tool.`;

const CACHE_BREAKPOINT = { anthropic: { cacheControl: { type: 'ephemeral' as const } } };

export interface ApiSessionDriverOptions {
  /** Cost for one turn's usage, in USD — same hook as the one-shot transport.
   *  Present ⇒ turns record `costSource: 'model-priced'`; absent ⇒ `unpriced`. */
  pricing?: (modelId: string, usage: CallUsage) => number;
}

export function createApiSessionDriver(
  cfg: ProviderConfig,
  opts: ApiSessionDriverOptions = {},
): SessionDriver {
  const primary = { model: buildModel(cfg, cfg.model), modelId: cfg.model };
  const fallback = cfg.fallbackModel
    ? { model: buildModel(cfg, cfg.fallbackModel), modelId: cfg.fallbackModel }
    : undefined;

  return {
    capabilities: { steering: 'turn-boundary', structuredOutcome: 'tool', resumeAtMessage: false },
    runSession(input) {
      let interrupted = false;
      let status: SessionStatus = 'running';
      const steers: string[] = [];

      const done = runApiSession(input, {
        primary,
        fallback,
        pricing: opts.pricing,
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
          await done.then(() => undefined);
        },
      };
    },
  };
}

interface SessionRuntime {
  primary: { model: LanguageModel; modelId: string };
  fallback?: { model: LanguageModel; modelId: string };
  pricing?: ApiSessionDriverOptions['pricing'];
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
  // whatever arrives here is a NEW observation (§3.3 resume-with-observation).
  const say = (content: string): void => {
    messages.push({ role: 'user', content });
    onEvent({ type: 'user-message', content });
  };
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
    const raw: RawPayload = {
      source: 'llm-api.generateText',
      payload: {
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
      // call rather than throwing — §3.3's malformed cases. The call id still
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

/** One model call, full history + cache breakpoints, fallback retry. */
async function callModel(
  def: SessionDef,
  messages: readonly ModelMessage[],
  tools: ToolSet,
  signal: AbortSignal,
  rt: SessionRuntime,
): Promise<{ result: Awaited<ReturnType<typeof generateText>>; modelId: string }> {
  const prompt: ModelMessage[] = [
    { role: 'system', content: def.systemPrompt, providerOptions: CACHE_BREAKPOINT },
    ...messages.map((m, i) =>
      i === messages.length - 1
        ? ({ ...m, providerOptions: { ...m.providerOptions, ...CACHE_BREAKPOINT } } as ModelMessage)
        : m,
    ),
  ];
  const run = (model: LanguageModel) =>
    generateText({
      model,
      messages: prompt,
      tools,
      abortSignal: signal,
      // The transcript event models ONE tool call per turn, so parallel
      // calls are discouraged at the source (anthropic honors this; other
      // providers ignore the namespaced option). A turn that still carries
      // several is executed in full — see the loop.
      providerOptions: { anthropic: { disableParallelToolUse: true } },
    });
  try {
    return { result: await run(rt.primary.model), modelId: rt.primary.modelId };
  } catch (err) {
    if (!rt.fallback || signal.aborted) throw err;
    return { result: await run(rt.fallback.model), modelId: rt.fallback.modelId };
  }
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
 * Rebuild the exact message history from a persisted transcript (§3.9:
 * events carry full content, so completeness is correctness). Non-
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

/** The §3.3 retryability axis, from the error's shape — never its message. */
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
