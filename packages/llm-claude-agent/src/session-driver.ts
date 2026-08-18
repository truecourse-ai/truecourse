/**
 * The Agent SDK SESSION DRIVER (AGENTIC_PIPELINE_PLAN §3.3, decisions
 * 2026-08-17): the claude-code mode of the agentic pipeline. One streaming-
 * input `query()` per session — ONE live subprocess (the user's installed
 * `claude` binary, their own harness login) serving every turn — with the
 * session's tools as in-process SDK MCP handlers and the structured outcome
 * via the SDK's native `outputFormat: {type: 'json_schema'}`.
 *
 * Spike-verified rules this file encodes (memory: agent-sdk-driver-decision):
 * - The query iterator THROWS after yielding an error-subtype result, so
 *   iteration is always wrapped.
 * - `system/init` fires per TURN — never a process-lifecycle signal; the
 *   provider session id is.
 * - The SDK's `num_turns` is never read: the policy shell counts budget from
 *   the `assistant-turn` events this driver emits.
 * - A success result MISSING `structured_output` is a malformed failure.
 *
 * ISOLATION IS INVARIANT (§3.3): the options block below is hardcoded and no
 * session type may weaken it — a session that needs the harness's own tools
 * is a plan amendment, not a configuration knob.
 */

import { zodToJsonSchema } from 'zod-to-json-schema';
import { z } from 'zod';
import { resolveClaudeBinary } from '@truecourse/shared';
import {
  type DriverResult,
  type SessionDef,
  type SessionDriver,
  type SessionFailure,
  type SessionRunInput,
  type SessionStatus,
  type SessionTool,
  type ToolContext,
  type TurnUsage,
} from '@truecourse/agent-loop';
import { loadSdk } from './sdk-import.js';
import type {
  SdkAssistantMessage,
  SdkMcpToolResult,
  SdkMessage,
  SdkModule,
  SdkQuery,
  SdkQueryOptions,
  SdkRateLimitEvent,
  SdkResultMessage,
  SdkSessionStore,
  SdkSystemMessage,
  SdkUserMessage,
} from './sdk-types.js';

/** The in-process MCP server all session tools live on; a tool named `x`
 *  reaches the model as `mcp__session__x`. */
export const SESSION_MCP_SERVER_NAME = 'session';

/** Sent on a cursor resume that carries no new observation — the session
 *  continues from where it was interrupted, on a fresh budget grant. */
const RESUME_NUDGE =
  'Continue from where you stopped. When you have reached the final result, produce the structured outcome.';

/** The opaque resume cursor this driver owns (§3.3). */
interface ClaudeAgentCursor {
  providerSessionId: string;
  /** Optional resume-at point inside the conversation (chain uuid). */
  resumeSessionAt?: string;
}

export interface ClaudeAgentDriverOptions {
  /** The user's `claude` binary; defaults to `resolveClaudeBinary()`. */
  pathToClaudeCodeExecutable?: string;
  model?: string;
  fallbackModel?: string;
  cwd?: string;
  /**
   * Provider session state mirror (§3.3: provider state lives in OUR store,
   * immune to the harness's retention window). Wired into the SDK's
   * `sessionStore` adapter; typically `providerSessionStore(<runDir>/provider)`.
   */
  sessionStore?: SdkSessionStore;
  /** Test seam: replaces the lazily imported SDK module. */
  sdk?: SdkModule;
}

export function createClaudeAgentSessionDriver(
  opts: ClaudeAgentDriverOptions = {},
): SessionDriver {
  return {
    capabilities: { steering: 'live', structuredOutcome: 'native', resumeAtMessage: true },
    // The backend is the user's own `claude` harness: the provider is fixed,
    // and the model is whatever we asked it for — an alias (`opus`), which is
    // why the per-turn `model` the API reports is recorded as well. Left
    // unset, the harness picks its own default and only the turns can say
    // which. There is no endpoint: the subprocess owns its own transport.
    attribution: {
      provider: 'claude-code',
      model: opts.model ?? 'harness-default',
      ...(opts.fallbackModel ? { fallbackModel: opts.fallbackModel } : {}),
    },
    runSession(input) {
      let status: SessionStatus = 'running';
      let interruptRequested = false;
      const queue = new AsyncQueue<SdkUserMessage>();
      let liveQuery: SdkQuery | undefined;

      const sendUser = (content: string): void => {
        // Recorded at the moment of INGESTION — when the SDK pulls the
        // message from the streaming input, not when we queue it. A message
        // queued into a dead or ending session is dropped unrecorded, so the
        // transcript never claims the model saw something it did not (and
        // the shell's retry probe can trust `user-message` events).
        queue.push({ type: 'user', message: { role: 'user', content }, parent_tool_use_id: null }, () =>
          input.onEvent({ type: 'user-message', content }),
        );
      };

      const done = runClaudeAgentSession(input, opts, {
        queue,
        sendUser,
        interrupted: () => interruptRequested,
        setQuery: (q) => {
          liveQuery = q;
        },
      }).then((result) => {
        status = result.kind === 'outcome' ? 'completed' : 'failed';
        return result;
      });

      return {
        done,
        status: () => status,
        steer: sendUser,
        interrupt: async () => {
          interruptRequested = true;
          try {
            await liveQuery?.interrupt();
          } catch {
            /* an interrupt race with a finished query is not an error */
          }
          queue.end();
          await done.then(() => undefined);
        },
      };
    },
  };
}

interface SessionWiring {
  queue: AsyncQueue<SdkUserMessage>;
  sendUser: (content: string) => void;
  interrupted: () => boolean;
  setQuery: (q: SdkQuery) => void;
}

async function runClaudeAgentSession(
  input: SessionRunInput,
  opts: ClaudeAgentDriverOptions,
  wiring: SessionWiring,
): Promise<DriverResult> {
  const { def, onEvent, signal } = input;
  const cursor = input.resume?.cursor as ClaudeAgentCursor | undefined;
  let providerSessionId = cursor?.providerSessionId;
  const cursorOut = (): ClaudeAgentCursor | undefined =>
    providerSessionId ? { providerSessionId } : undefined;

  let sdk: SdkModule;
  try {
    sdk = opts.sdk ?? (await loadSdk());
  } catch (err) {
    return failure({
      kind: 'transport',
      detail: err instanceof Error ? err.message : String(err),
      class: 'validation',
      retryability: 'blocked',
    });
  }

  // One API assistant turn arrives as SEVERAL SDK assistant messages sharing
  // `message.id` (one per content block), each repeating the turn's usage —
  // observed live. Same-id messages merge into ONE buffered turn (one budget
  // turn, usage counted once), flushed before any non-assistant message and
  // before a tool handler runs, so ordering stays faithful.
  interface PendingTurn {
    id: string | undefined;
    texts: string[];
    toolCall?: { name: string; args: unknown };
    usage: TurnUsage;
    /** What the API said served this turn — an alias resolved, or a fallback. */
    model: string | undefined;
    raws: SdkAssistantMessage[];
  }
  let pendingTurn: PendingTurn | undefined;
  const flushTurn = (): void => {
    if (!pendingTurn) return;
    const text = pendingTurn.texts.join('\n');
    onEvent({
      type: 'assistant-turn',
      ...(text ? { text } : {}),
      ...(pendingTurn.toolCall ? { toolCall: pendingTurn.toolCall } : {}),
      usage: pendingTurn.usage,
      ...(pendingTurn.model ? { model: pendingTurn.model } : {}),
      raw: {
        source: 'claude-agent-sdk.assistant',
        payload: pendingTurn.raws.length === 1 ? pendingTurn.raws[0] : pendingTurn.raws,
      },
    });
    pendingTurn = undefined;
  };
  const bufferAssistant = (message: SdkAssistantMessage): void => {
    const id = message.message?.id;
    if (!pendingTurn || id === undefined || pendingTurn.id !== id) {
      flushTurn();
      pendingTurn = {
        id,
        texts: [],
        usage: turnUsageOf(message),
        model: message.message?.model,
        raws: [],
      };
    }
    const blocks = Array.isArray(message.message?.content) ? message.message.content : [];
    for (const block of blocks) {
      if (block.type === 'text') pendingTurn.texts.push((block as { text: string }).text);
      else if (block.type === 'tool_use' && !pendingTurn.toolCall) {
        const toolUse = block as { name: string; input: unknown };
        pendingTurn.toolCall = { name: bareToolName(toolUse.name), args: toolUse.input };
      }
    }
    pendingTurn.raws.push(message);
    // Without an id there is nothing to merge on — emit right away. Only
    // id-carrying messages wait for their possible same-id continuation
    // (flushed by the next message, a tool handler, or session end), which
    // can defer the budget check by at most one message — recorded honestly.
    if (id === undefined) flushTurn();
  };

  const server = sdk.createSdkMcpServer({
    name: SESSION_MCP_SERVER_NAME,
    version: '1.0.0',
    tools: def.tools.map((t) => buildMcpTool(sdk, t, onEvent, signal, flushTurn)),
  });

  const options: SdkQueryOptions = {
    // -- §3.3 isolation invariants, hardcoded ------------------------------
    tools: [], // no built-in tools
    disallowedTools: ['ToolSearch'], // deferred tool loading steals the first turn (spike)
    settingSources: [],
    systemPrompt: def.systemPrompt, // full replace
    // REPLACES the subprocess env, so the parent's is spread back in —
    // dropping it breaks credential lookup (keychain, PATH).
    env: { ...process.env, CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' },
    strictMcpConfig: true,
    settings: { autoCompactEnabled: false }, // compaction never runs (§3.3)
    // ----------------------------------------------------------------------
    mcpServers: { [SESSION_MCP_SERVER_NAME]: server as never },
    permissionMode: 'dontAsk',
    allowedTools: def.tools.map((t) => mcpToolName(t.name)),
    outputFormat: {
      type: 'json_schema',
      schema: zodToJsonSchema(def.outcomeSchema as unknown as z.ZodTypeAny, {
        $refStrategy: 'none',
      }),
    },
    // Distant backstop ONLY — the budget is the shell's counter over our
    // assistant-turn events; the SDK's turn scale is different (spike).
    maxTurns: Math.max(50, def.budget.turns * (def.budget.maxResumes + 1) * 10),
    pathToClaudeCodeExecutable: opts.pathToClaudeCodeExecutable ?? resolveClaudeBinary(),
    ...(opts.model ? { model: opts.model } : {}),
    ...(opts.fallbackModel ? { fallbackModel: opts.fallbackModel } : {}),
    ...(opts.cwd ? { cwd: opts.cwd } : {}),
    ...(opts.sessionStore ? { sessionStore: opts.sessionStore } : {}),
    ...(cursor
      ? {
          resume: cursor.providerSessionId,
          ...(cursor.resumeSessionAt ? { resumeSessionAt: cursor.resumeSessionAt } : {}),
        }
      : {}),
  };

  let query: SdkQuery;
  try {
    query = sdk.query({ prompt: wiring.queue, options });
  } catch (err) {
    return failure({
      kind: 'transport',
      detail: `query failed to start: ${err instanceof Error ? err.message : String(err)}`,
      class: 'transport',
      retryability: 'transient',
    });
  }
  wiring.setQuery(query);

  // Opening messages: fresh sessions get their initial messages (or a bare
  // opener); a resume treats them as NEW observations, nudging when empty.
  if (input.initialMessages.length > 0) {
    for (const m of input.initialMessages) wiring.sendUser(m);
  } else {
    wiring.sendUser(input.resume ? RESUME_NUDGE : 'Begin.');
  }

  const endedWithoutOutcome = (): DriverResult =>
    failure(
      { kind: 'malformed', detail: 'session ended without outcome', retryability: 'none' },
      cursorOut(),
    );

  let preflightDone = false;
  let lastResult: SdkResultMessage | undefined;
  // The iterator THROWS after yielding an error-subtype result — always
  // wrapped, and a result we already hold wins over the trailing throw.
  try {
    for await (const message of query as AsyncIterable<SdkMessage>) {
      if (message.type !== 'assistant') flushTurn();
      switch (message.type) {
        case 'system': {
          const system = message as SdkSystemMessage;
          // The harness owns this retry; we own the RECORD of it (item 11).
          // Budget-inert — a retry is not a turn — but a session that sits
          // silent for minutes is otherwise indistinguishable from a hang.
          if (system.subtype === 'api_retry') {
            onEvent({
              type: 'provider-retry',
              attempt: Math.max(1, Math.trunc(system.attempt ?? 1)),
              ...(typeof system.error_status === 'number'
                ? { status: system.error_status }
                : {}),
              message: system.error ?? 'the provider call failed retryably',
              delayMs: Math.max(0, system.retry_delay_ms ?? 0),
              model: attributedModel(opts),
              raw: { source: 'claude-agent-sdk.system', payload: system },
            });
            break;
          }
          if (system.subtype !== 'init') break; // status chatter
          // init fires PER TURN; only the session id is process truth.
          if (typeof system.session_id === 'string') providerSessionId = system.session_id;
          if (!preflightDone) {
            preflightDone = true;
            const problem = preflight(system, def);
            if (problem) {
              wiring.queue.end();
              try {
                await query.interrupt();
              } catch {
                /* already stopping */
              }
              return failure(problem, cursorOut());
            }
          }
          break;
        }
        case 'assistant': {
          const assistant = message as SdkAssistantMessage;
          if (assistant.parent_tool_use_id !== null) break; // subagent chatter
          bufferAssistant(assistant);
          break;
        }
        case 'user':
          // Tool results replayed by the SDK; the MCP handlers already
          // emitted the transcript events at execution time.
          break;
        case 'rate_limit_event': {
          // A LEVEL signal, fired on every change of the subscription's
          // rate-limit window — most of them say "still allowed", which is
          // not a wait and not a transcript line. Only `rejected` is the
          // provider actually holding this session back.
          const info = (message as SdkRateLimitEvent).rate_limit_info;
          if (info?.status !== 'rejected') break;
          onEvent({
            type: 'provider-retry',
            attempt: 1,
            message: `rate limited${info.rateLimitType ? ` (${info.rateLimitType})` : ''}`,
            delayMs: resetDelayMs(info.resetsAt),
            model: attributedModel(opts),
            raw: { source: 'claude-agent-sdk.rate_limit_event', payload: message },
          });
          break;
        }
        case 'result': {
          lastResult = message as SdkResultMessage;
          wiring.queue.end();
          if (lastResult.subtype === 'success' && lastResult.structured_output !== undefined) {
            return { kind: 'outcome', value: lastResult.structured_output, resumeCursor: cursorOut() };
          }
          // A shell-requested interrupt ends every non-outcome result the
          // same way; the shell rewrites it into the semantic failure.
          if (wiring.interrupted()) return endedWithoutOutcome();
          if (lastResult.subtype === 'success') {
            return failure(
              {
                kind: 'malformed',
                detail: 'session ended without structured output',
                retryability: 'none',
              },
              cursorOut(),
            );
          }
          return failure(mapResultError(lastResult), cursorOut());
        }
        default:
          if (!IGNORED_MESSAGE_TYPES.has(message.type)) {
            // A new SDK message type degrades loudly, never silently (§3.3).
            console.warn(`[llm-claude-agent] unhandled SDK message type: ${message.type}`);
          }
          break;
      }
    }
  } catch (err) {
    if (lastResult) {
      if (wiring.interrupted()) return endedWithoutOutcome();
      return failure(mapResultError(lastResult), cursorOut());
    }
    return failure(
      {
        kind: 'transport',
        detail: err instanceof Error ? err.message : String(err),
        class: 'transport',
        retryability: signal.aborted || wiring.interrupted() ? 'none' : 'transient',
      },
      cursorOut(),
    );
  } finally {
    flushTurn();
    wiring.queue.end();
  }
  // The stream ended without any result message (interrupt, closed input).
  return endedWithoutOutcome();
}

/** The model this driver declares — see the `attribution` block above. */
function attributedModel(opts: ClaudeAgentDriverOptions): string {
  return opts.model ?? 'harness-default';
}

/** `resetsAt` as a wait from now. The field is a unix timestamp whose unit
 *  the SDK does not state, so a value too small to be milliseconds is read
 *  as seconds; either way a past reset is no wait at all. */
function resetDelayMs(resetsAt: unknown): number {
  if (typeof resetsAt !== 'number' || !Number.isFinite(resetsAt)) return 0;
  const at = resetsAt > 1e12 ? resetsAt : resetsAt * 1000;
  return Math.max(0, at - Date.now());
}

function failure(f: SessionFailure, resumeCursor?: unknown): DriverResult {
  return { kind: 'failure', failure: f, ...(resumeCursor ? { resumeCursor } : {}) };
}

/**
 * Feature-detect what this driver depends on, from the first init message —
 * never version sniffing (§3.3 distribution). A missing/failed in-process
 * MCP server means no session tool can run: blocked, loudly.
 */
function preflight(init: SdkSystemMessage, def: SessionDef): SessionFailure | undefined {
  if (typeof init.session_id !== 'string' || init.session_id === '') {
    return {
      kind: 'transport',
      detail:
        'the installed claude binary did not report a session id — upgrade claude to a version supporting the Agent SDK session protocol',
      class: 'validation',
      retryability: 'blocked',
    };
  }
  // A session WITH tools needs the in-process server connected; missing from
  // the init entirely is just as fatal as failed-to-connect — the model
  // would burn its whole budget with nothing callable.
  if (def.tools.length > 0) {
    const servers = Array.isArray(init.mcp_servers) ? init.mcp_servers : [];
    const session = servers.find((s) => s.name === SESSION_MCP_SERVER_NAME);
    if (!session || session.status !== 'connected') {
      return {
        kind: 'transport',
        detail: `in-process MCP server \`${SESSION_MCP_SERVER_NAME}\` is ${session ? session.status : 'missing from the session'} — session tools cannot run`,
        class: 'validation',
        retryability: 'blocked',
      };
    }
  }
  return undefined;
}

function mcpToolName(bareName: string): string {
  return `mcp__${SESSION_MCP_SERVER_NAME}__${bareName}`;
}

function bareToolName(wireName: string): string {
  const prefix = `mcp__${SESSION_MCP_SERVER_NAME}__`;
  return wireName.startsWith(prefix) ? wireName.slice(prefix.length) : wireName;
}

/**
 * One session tool as an in-process MCP handler. The SDK subprocess pipeline
 * invokes it; the handler runs the (shell-wrapped) `execute` and emits the
 * transcript events at execution time. Schema-failing args surface as the
 * re-ask event plus an error result the model revises on; a crashing tool is
 * an error OBSERVATION, never a session failure.
 */
function buildMcpTool(
  sdk: SdkModule,
  tool: SessionTool,
  onEvent: SessionRunInput['onEvent'],
  signal: AbortSignal,
  flushTurn: () => void,
): unknown {
  const driverCtx: ToolContext = {
    workItem: '',
    signal,
    dispatchChild: () => Promise.reject(new Error('dispatchChild is shell-provided')),
  };
  const shape =
    tool.inputSchema instanceof z.ZodObject
      ? (tool.inputSchema as z.AnyZodObject).shape
      : // The SDK's tool() takes a raw shape; a non-object schema rides a
        // single `input` field. Session tools should prefer z.object roots.
        { input: tool.inputSchema };
  return sdk.tool(tool.name, tool.description, shape, async (args) => {
    // The tool_use part of the turn has been delivered; its buffered turn
    // must precede this call's result in the transcript.
    flushTurn();
    try {
      const result = await tool.execute(args, driverCtx);
      onEvent({
        type: 'tool-result',
        toolName: tool.name,
        content: result.content,
        ...(result.isError !== undefined ? { isError: result.isError } : {}),
      });
      return toMcpResult(result.content, result.isError === true);
    } catch (err) {
      // Name-based check — the shell may be a different module instance of
      // `@truecourse/shared`, so instanceof across the boundary is unreliable.
      if (err instanceof Error && err.name === 'SessionToolArgsError') {
        onEvent({ type: 're-ask', invalid: JSON.stringify(args ?? null), reason: err.message });
        return toMcpResult(err.message, true);
      }
      const message = `tool \`${tool.name}\` crashed: ${err instanceof Error ? err.message : String(err)}`;
      onEvent({ type: 'tool-result', toolName: tool.name, content: message, isError: true });
      return toMcpResult(message, true);
    }
  });
}

function toMcpResult(text: string, isError: boolean): SdkMcpToolResult {
  return { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) };
}

/**
 * Provider usage into the four buckets. Cost stays `unpriced` on turns: the
 * SDK reports cost cumulatively per RESULT, not per assistant message, and a
 * dishonest split would be worse than none — pricing can be derived from the
 * recorded tokens downstream.
 */
function turnUsageOf(message: SdkAssistantMessage): TurnUsage {
  const usage = message.message?.usage;
  return {
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
    cacheCreateTokens: usage?.cache_creation_input_tokens ?? 0,
    costUsd: 0,
    costSource: 'unpriced',
  };
}

function mapResultError(result: SdkResultMessage): SessionFailure {
  const detail =
    Array.isArray(result.errors) && result.errors.length > 0
      ? result.errors.join('; ')
      : `SDK result: ${result.subtype}`;
  if (result.subtype === 'error_max_structured_output_retries') {
    return { kind: 'malformed', detail, retryability: 'none' };
  }
  if (result.subtype === 'error_max_turns') {
    // Our budget should interrupt long before this distant backstop.
    return { kind: 'malformed', detail: `SDK turn backstop reached: ${detail}`, retryability: 'none' };
  }
  return { kind: 'transport', detail, class: 'provider', retryability: 'transient' };
}

/**
 * Message types we deliberately ignore — known chatter, not turns. Two that
 * used to live here now have cases of their own: `rate_limit_event` (a level
 * signal whose `rejected` state IS a wait) and `api_retry` — which was never
 * a top-level type at all, only a `system` subtype, so ignoring it here never
 * did anything.
 */
const IGNORED_MESSAGE_TYPES = new Set([
  'stream_event',
  'tool_progress',
  'thinking_tokens',
  'status',
  'auth_status',
  'task_notification',
  'task_started',
  'task_updated',
  'task_progress',
  'background_tasks_changed',
  'session_state_changed',
  'commands_changed',
  'notification',
  'files_persisted',
  'tool_use_summary',
  'memory_recall',
  'informational',
  'prompt_suggestion',
]);

/**
 * Minimal push-based async iterable feeding the streaming-input prompt.
 * Each item may carry an `onConsume` fired at the moment the consumer pulls
 * it — the ingestion hook the user-message recording rides on. Items still
 * queued when the stream closes are dropped, their hooks never fired.
 */
class AsyncQueue<T> implements AsyncIterable<T> {
  private items: Array<{ value: T; onConsume?: () => void }> = [];
  private resolvers: Array<(r: IteratorResult<T>) => void> = [];
  private closed = false;

  push(value: T, onConsume?: () => void): void {
    if (this.closed) return;
    const resolve = this.resolvers.shift();
    if (resolve) {
      onConsume?.();
      resolve({ value, done: false });
    } else {
      this.items.push({ value, onConsume });
    }
  }

  end(): void {
    if (this.closed) return;
    this.closed = true;
    this.items = [];
    for (const resolve of this.resolvers.splice(0)) {
      resolve({ value: undefined as never, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        const item = this.items.shift();
        if (item) {
          item.onConsume?.();
          return Promise.resolve({ value: item.value, done: false });
        }
        if (this.closed) return Promise.resolve({ value: undefined as never, done: true });
        return new Promise((resolve) => this.resolvers.push(resolve));
      },
    };
  }
}
