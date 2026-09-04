/**
 * The Agent SDK ONE-SHOT TRANSPORT: `@truecourse/shared/llm`'s `LlmTransport`
 * (one system + user prompt in, the model's raw text out) on the same
 * `query()` protocol the session driver runs — so the leaf stages that are a
 * single schema-described call (realization match, world classify, the claim
 * diff gate, the recipe proposal, the visual judge) reach the user's `claude`
 * login through the SDK instead of a hand-rolled `claude -p` spawn.
 *
 * What a call gets, mirroring the `-p` invocation it replaces byte for byte
 * where the model can tell: the system prompt as a FULL replace, no built-in
 * tools (an output-only stage must never explore the repo), only the user's
 * own settings loaded, the per-stage model and fallback aliases, and the
 * prompt as raw text so its content can never be read as an option.
 *
 * What it adds over the spawn: the SDK's typed messages. A subscription
 * rate-limit rejection and the harness's synthetic "you've hit your limit"
 * text are recognized as the call FAILING, never returned as an answer for a
 * parser to choke on — the failure the stage tallies then says why. Usage
 * lands in the same per-stage table and the same call-record sink, so a run
 * on this transport reads exactly like one on the spawn did.
 */

import {
  emitLlmCallRecord,
  recordUsageFromEnvelope,
  resolveStallTimeoutMs,
  resolveTimeoutScale,
  type EnvelopeUsage,
  type LlmRequest,
  type LlmTransport,
} from '@truecourse/shared/llm';
import { resolveClaudeBinary } from '@truecourse/shared';
import { loadSdk } from './sdk-import.js';
import type {
  SdkAssistantMessage,
  SdkMessage,
  SdkModule,
  SdkQueryOptions,
  SdkRateLimitEvent,
  SdkResultMessage,
  SdkUserMessage,
} from './sdk-types.js';

export interface ClaudeAgentTransportOptions {
  /** The user's `claude` binary; defaults to `resolveClaudeBinary()`. */
  pathToClaudeCodeExecutable?: string;
  /** Test seam: replaces the lazily imported SDK module. */
  sdk?: SdkModule;
}

/**
 * A backstop, not a budget: with no tools there is nothing to loop on, so a
 * one-shot answer is one turn. Above one only so the harness's own bookkeeping
 * turns can never end a legitimate answer as `error_max_turns`.
 */
const ONE_SHOT_MAX_TURNS = 3;

/** The model the harness stamps on text it wrote itself — a limit notice, never an answer. */
const SYNTHETIC_MODEL = '<synthetic>';

export function createClaudeAgentTransport(opts: ClaudeAgentTransportOptions = {}): LlmTransport {
  return async (req) => {
    // A missing SDK fails the call with the install one-liner, the same way a
    // session would — the probe every run starts with loads it first anyway.
    const sdk = opts.sdk ?? (await loadSdk());
    // Resolved per call, so one long-lived instance follows a binary override.
    const bin = opts.pathToClaudeCodeExecutable ?? resolveClaudeBinary();
    return runOneShot(sdk, bin, req);
  };
}

async function runOneShot(sdk: SdkModule, bin: string, req: LlmRequest): Promise<string> {
  const t0 = Date.now();
  const ts = new Date().toISOString();
  const inputChars = req.system.length + req.user.length;
  const itemCount = req.itemCount ?? 1;
  const id = req.id ?? '';
  const stage = req.stage ?? 'unknown';

  // The same two clocks the spawn kept: a wall-clock ceiling covering even
  // pre-first-token silence, and a stall guard that arms on the first message
  // and kills a started-then-silent stream. Both scaled by the one env knob.
  const timeoutMs = req.timeoutMs ? req.timeoutMs * resolveTimeoutScale() : undefined;
  const stallMs = resolveStallTimeoutMs();
  const abort = new AbortController();
  let ceilingTimer: ReturnType<typeof setTimeout> | null = null;
  let stallTimer: ReturnType<typeof setTimeout> | null = null;
  let killed: { outcome: 'timeout' | 'stall'; message: string } | undefined;
  const kill = (outcome: 'timeout' | 'stall', message: string): void => {
    if (killed) return;
    killed = { outcome, message };
    abort.abort(new Error(message));
  };
  const clearTimers = (): void => {
    if (ceilingTimer) clearTimeout(ceilingTimer);
    if (stallTimer) clearTimeout(stallTimer);
    ceilingTimer = null;
    stallTimer = null;
  };

  // Liveness, as the spawn observed it off the NDJSON stream: how many
  // messages arrived, when the last one did, and when the first token showed.
  let eventCount = 0;
  let firstEventAt: number | undefined;
  let firstDeltaAt: number | undefined;
  let lastEventAt: number | undefined;
  const obsSilenceMs = (): number | undefined =>
    lastEventAt !== undefined ? Date.now() - lastEventAt : undefined;
  const obsTtftMs = (): number | undefined => (firstDeltaAt !== undefined ? firstDeltaAt - t0 : undefined);
  const obsTimeToRequestMs = (): number | undefined =>
    firstEventAt !== undefined ? firstEventAt - t0 : undefined;

  const armOrResetStall = (waitMs: number = stallMs): void => {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      // The timer is due against the loop's clock; the message that stamped
      // `lastEventAt` may have landed inside the window. Kill only on silence
      // we can prove, and wait out the remainder otherwise.
      const silentMs = lastEventAt !== undefined ? Date.now() - lastEventAt : stallMs;
      if (silentMs < stallMs) {
        armOrResetStall(stallMs - silentMs);
        return;
      }
      kill('stall', `claude stalled: no stream event for ${stallMs}ms (TRUECOURSE_LLM_STALL_TIMEOUT_MS)`);
    }, waitMs);
  };
  const observe = (message: SdkMessage): void => {
    const now = Date.now();
    if (firstEventAt === undefined) firstEventAt = now;
    eventCount += 1;
    lastEventAt = now;
    armOrResetStall();
    if (firstDeltaAt === undefined && isFirstTokenDelta(message)) firstDeltaAt = now;
  };

  let reported = false;
  const fail = (error: string, outcome: 'timeout' | 'stall' | 'error' = 'error'): Error => {
    if (!reported) {
      reported = true;
      clearTimers();
      emitLlmCallRecord({
        ts, stage, model: req.model ?? '', id, itemCount,
        ok: false, outcome, error, exitCode: null, wallMs: Date.now() - t0,
        timeoutMs, stallTimeoutMs: stallMs,
        eventCount, msSinceLastEvent: obsSilenceMs(),
        ttftMs: obsTtftMs(), timeToRequestMs: obsTimeToRequestMs(),
        inputChars, outputChars: 0,
        inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0, costUsd: 0,
        system: req.system, user: req.user, responseText: '',
      });
    }
    return new Error(error);
  };
  const succeed = (usage: EnvelopeUsage | null, text: string): void => {
    if (reported) return;
    reported = true;
    clearTimers();
    emitLlmCallRecord({
      ts, stage, model: usage?.model || req.model || '', id, itemCount,
      ok: true, outcome: 'ok', exitCode: 0, wallMs: Date.now() - t0,
      timeoutMs, stallTimeoutMs: stallMs,
      eventCount, msSinceLastEvent: obsSilenceMs(),
      inputChars, outputChars: text.length,
      inputTokens: usage?.inputTokens ?? 0, outputTokens: usage?.outputTokens ?? 0,
      cacheReadTokens: usage?.cacheReadTokens ?? 0, cacheCreateTokens: usage?.cacheCreateTokens ?? 0,
      costUsd: usage?.costUsd ?? 0, numTurns: usage?.numTurns,
      claudeDurationMs: usage?.claudeDurationMs, apiDurationMs: usage?.apiDurationMs,
      ttftMs: obsTtftMs(), timeToRequestMs: obsTimeToRequestMs(),
      system: req.system, user: req.user, responseText: text,
    });
  };

  const options: SdkQueryOptions = {
    // Output-only by design: no built-in tools, no MCP servers, no deferred
    // tool loading, no compaction — the prompt carries everything the stage
    // needs and the model must never explore or modify the repo.
    tools: [],
    disallowedTools: ['ToolSearch'],
    strictMcpConfig: true,
    settings: { autoCompactEnabled: false },
    permissionMode: 'dontAsk',
    // Full REPLACE of the harness's own system prompt, as `--system-prompt` was.
    systemPrompt: req.system,
    // Only the operator's own settings, never the scanned repo's CLAUDE.md.
    settingSources: ['user'],
    // REPLACES the subprocess env, so the parent's is spread back in —
    // dropping it breaks credential lookup (keychain, PATH).
    env: { ...process.env, CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' },
    includePartialMessages: true,
    maxTurns: ONE_SHOT_MAX_TURNS,
    abortController: abort,
    pathToClaudeCodeExecutable: bin,
    ...(req.model ? { model: req.model } : {}),
    ...(req.fallbackModel ? { fallbackModel: req.fallbackModel } : {}),
  };

  ceilingTimer = timeoutMs
    ? setTimeout(() => kill('timeout', `claude timed out after ${timeoutMs}ms`), timeoutMs)
    : null;

  let query: AsyncIterable<SdkMessage>;
  try {
    query = sdk.query({ prompt: promptOf(req), options });
  } catch (err) {
    throw fail(`claude query failed to start: ${err instanceof Error ? err.message : String(err)}`);
  }

  let result: SdkResultMessage | undefined;
  let rateLimit: SdkRateLimitEvent['rate_limit_info'] | undefined;
  let syntheticText: string | undefined;
  // The iterator THROWS after yielding an error-subtype result — a result we
  // already hold wins over the trailing throw, exactly as in the driver.
  try {
    for await (const message of query) {
      observe(message);
      switch (message.type) {
        case 'assistant': {
          const assistant = message as SdkAssistantMessage;
          if (assistant.message?.model === SYNTHETIC_MODEL) {
            syntheticText = assistantText(assistant) || syntheticText;
          }
          break;
        }
        case 'rate_limit_event': {
          const info = (message as SdkRateLimitEvent).rate_limit_info;
          if (info?.status === 'rejected') rateLimit = info;
          break;
        }
        case 'result':
          result = message as SdkResultMessage;
          break;
        default:
          break;
      }
    }
  } catch (err) {
    if (killed) throw fail(killed.message, killed.outcome);
    if (!result) throw fail(`claude query failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (killed) throw fail(killed.message, killed.outcome);
  if (!result) throw fail('claude produced no result message');

  const limitNote = rateLimit
    ? ` — rate limited${rateLimit.rateLimitType ? ` (${rateLimit.rateLimitType})` : ''}${resetNote(rateLimit.resetsAt)}`
    : '';
  if (result.subtype !== 'success') {
    const detail =
      Array.isArray(result.errors) && result.errors.length > 0
        ? result.errors.join('; ')
        : `SDK result: ${result.subtype}`;
    throw fail(`claude ${result.subtype}${limitNote}: ${detail}`.slice(0, 500));
  }
  // An API error surfaces as a success-shaped result flagged `is_error` (a
  // 429, a 5xx) — a transport failure, never text for the caller to parse.
  if (result.is_error === true) {
    const status = result.api_error_status ? ` (api ${result.api_error_status})` : '';
    const detail = typeof result.result === 'string' ? `: ${result.result}` : '';
    throw fail(`claude API error${status}${limitNote}${detail}`.slice(0, 500));
  }
  // Text the harness wrote itself ("You've hit your session limit …") is the
  // call being refused, whatever the result's subtype says.
  if (syntheticText !== undefined) {
    throw fail(`claude refused the call${limitNote}: ${syntheticText}`.slice(0, 500));
  }
  const text = result.result;
  if (typeof text !== 'string') throw fail('claude returned no text');
  let usage: EnvelopeUsage | null = null;
  try {
    usage = recordUsageFromEnvelope(req, result);
  } catch {
    /* usage is observational only */
  }
  succeed(usage, text);
  return text;
}

/**
 * The user half of the call. Text-only rides as the plain string prompt (one
 * turn, no option grammar for its content to collide with). Images need
 * content BLOCKS, which only the streaming-input form carries: one message,
 * text first so the instruction precedes the pixels, then the input closes so
 * the query ends with the turn.
 */
function promptOf(req: LlmRequest): string | AsyncIterable<SdkUserMessage> {
  const images = req.images ?? [];
  if (images.length === 0) return req.user;
  const message: SdkUserMessage = {
    type: 'user',
    parent_tool_use_id: null,
    message: {
      role: 'user',
      content: [
        { type: 'text', text: req.user },
        ...images.map((image) => ({
          type: 'image' as const,
          source: { type: 'base64' as const, media_type: image.mediaType, data: image.data },
        })),
      ],
    },
  };
  return (async function* () {
    yield message;
  })();
}

function assistantText(message: SdkAssistantMessage): string {
  const blocks = Array.isArray(message.message?.content) ? message.message.content : [];
  return blocks
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text' && typeof (b as { text?: unknown }).text === 'string')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

/** True for the partial message carrying the model's first visible token. */
function isFirstTokenDelta(message: SdkMessage): boolean {
  if (message.type !== 'stream_event') return false;
  const event = (message as { event?: { type?: unknown; delta?: { type?: unknown } } }).event;
  if (event?.type !== 'content_block_delta') return false;
  const delta = event.delta?.type;
  return delta === 'text_delta' || delta === 'thinking_delta';
}

/** `resetsAt` as a wait from now, in whole seconds; silent for a past or unknown reset. */
function resetNote(resetsAt: unknown): string {
  if (typeof resetsAt !== 'number' || !Number.isFinite(resetsAt)) return '';
  const at = resetsAt > 1e12 ? resetsAt : resetsAt * 1000;
  const waitS = Math.ceil((at - Date.now()) / 1000);
  return waitS > 0 ? `, resets in ${waitS}s` : '';
}
