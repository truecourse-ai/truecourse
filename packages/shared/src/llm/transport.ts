/**
 * LLM transport — the single seam through which every one-shot LLM stage
 * reaches the model.
 *
 * A transport is a single-request function `(req) => Promise<rawText>`: it
 * takes a system + user prompt and returns the model's raw assistant text. The
 * caller does its own fence-stripping + JSON.parse + Zod validation, so the
 * transport is content-agnostic. Concurrency stays in each runner (its own
 * p-limit), so a single-request transport composes naturally.
 *
 * The implementations live beside their backends: the direct-API one in
 * `@truecourse/llm-api`, the Agent SDK one in `@truecourse/llm-claude-agent`.
 * This module owns the contract, the usage accounting and the process default.
 */

import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ZodTypeAny } from 'zod';
import {
  isSystemicTally,
  LlmStageFailureError,
  MAX_TALLY_ERROR_CHARS,
  type StageTransportTally,
} from './tally.js';

// Re-exported here so every output-only prompt reaches it through the same
// `@truecourse/shared/llm` entry it already imports the transport from.
export { OUTPUT_ONLY_GUARDRAIL } from './guardrail.js';
// The agent-session contract and policy shell live in `@truecourse/agent-loop`
// (decision 2026-08-17): one package defines the loop, one package per
// backend implements it.
export {
  StageTransportTallySchema,
  LlmStageFailureError,
  formatStageFailure,
  isSystemicTally,
  type StageTransportTally,
} from './tally.js';

/**
 * ONE image attached to a request — base64 bytes plus their media type, which is
 * the only form every backend agrees on (the `claude` CLI's stream-json envelope,
 * the AI SDK's image part, and the mailbox's JSON payload all take base64).
 * Deliberately NOT a path or a URL: a transport must never read the filesystem or
 * the network on the caller's behalf, and an artifact under `.truecourse/` is not
 * reachable from a hosted answerer anyway.
 */
export interface LlmImage {
  mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
  /** The raw bytes, base64-encoded — no `data:` prefix. */
  data: string;
}

export interface LlmRequest {
  /** Stable id (the runner's natural id, e.g. `contract.extract:<sliceId>`).
   *  Falls back to a content hash when absent. */
  id?: string;
  /** Pipeline stage, e.g. `spec.relevance` / `contract.extract` — informational. */
  stage?: string;
  /** Primary model (cli passes `--model`; agent treats it as a hint). */
  model?: string;
  /** Fallback model (cli passes `--fallback-model`). */
  fallbackModel?: string;
  system: string;
  user: string;
  /** What the answer should be: a JSON object the caller will parse, or free text.
   *  A hint for the agent answerer; the cli path ignores it. Defaults to 'json'. */
  responseFormat?: 'json' | 'text';
  /** Optional JSON-schema string the JSON answer must satisfy (agent hint). */
  schema?: string;
  /**
   * Whether `schema` is ENFORCED by the answerer. Defaults to true whenever
   * `schema` is present: the api transport submits it as provider-side structured
   * output and fails loudly if it cannot. `false` = the schema rides as a hint
   * only (mailbox answerers, prompt parity); the api transport uses plain JSON
   * mode and parse-time Zod validates, as in claude-code mode. Set it at the call
   * sites whose schema strict structured output cannot express — a typed record
   * or a non-object root. The cli/agent backends treat `schema` as informational
   * either way.
   */
  enforceSchema?: boolean;
  /** Per-call timeout in ms. */
  timeoutMs?: number;
  /**
   * Logical work items in this call (e.g. blocks in a claim-extract batch).
   * Informational only — drives per-item metrics in the call log. Defaults to 1.
   */
  itemCount?: number;
  /**
   * Images the model must LOOK at, alongside `user`. Absent (the overwhelmingly
   * common case) leaves every backend on the text path it has always taken —
   * adding a vision stage must not change one byte of how a text stage is sent.
   */
  images?: readonly LlmImage[];
}

/** True when a request carries anything for the model to look at. */
/** Returns the model's raw assistant text. The caller strips fences + parses. */
export type LlmTransport = (req: LlmRequest) => Promise<string>;

// ---------------------------------------------------------------------------
// per-stage usage accounting
// ---------------------------------------------------------------------------

/** Aggregated token + cost usage for one pipeline stage across a run. */
export interface StageUsage {
  stage: string;
  /** Resolved model id seen on the calls (e.g. `claude-sonnet-4-6`). */
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  costUsd: number;
  /** Number of real LLM calls (cache hits don't reach the transport). */
  calls: number;
}

// Process-wide, keyed by stage; call resetStageUsage() up front to be safe.
//
// The dashboard server no longer shares one process-wide transport — each run
// carries the credentials of the workspace that asked for it — but this tally
// is still process-global, so it is only accurate while ONE run is in flight.
// Scoping usage per run is the remaining half of that move.
const stageUsage = new Map<string, StageUsage>();

/** Clear accumulated usage — call once at the start of a run. */
export function resetStageUsage(): void {
  stageUsage.clear();
}

/** Snapshot of accumulated per-stage usage (a copy; safe to read mid-run). */
export function getStageUsage(): Map<string, StageUsage> {
  return new Map(stageUsage);
}

/** Total tokens (input + output + both cache classes) for a stage. */
export function stageTokenTotal(u: StageUsage): number {
  return u.inputTokens + u.outputTokens + u.cacheReadTokens + u.cacheCreateTokens;
}

/** Accumulate one call's usage under its stage. No-op shape when fields absent. */
export function recordStageUsage(
  stage: string | undefined,
  u: {
    model?: string;
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheCreateTokens?: number;
    costUsd?: number;
  },
): void {
  const key = stage ?? 'unknown';
  const prev: StageUsage = stageUsage.get(key) ?? {
    stage: key,
    model: '',
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreateTokens: 0,
    costUsd: 0,
    calls: 0,
  };
  prev.inputTokens += u.inputTokens ?? 0;
  prev.outputTokens += u.outputTokens ?? 0;
  prev.cacheReadTokens += u.cacheReadTokens ?? 0;
  prev.cacheCreateTokens += u.cacheCreateTokens ?? 0;
  prev.costUsd += u.costUsd ?? 0;
  prev.calls += 1;
  if (u.model) prev.model = u.model;
  stageUsage.set(key, prev);
}

// ---------------------------------------------------------------------------
// per-stage transport failure accounting
// ---------------------------------------------------------------------------

/**
 * A run's transport wrapper: one counting seam every stage of that run calls
 * through, so a pipeline can answer "did this stage actually reach the model?"
 * instead of inferring health from whatever its fail-open defaults produced.
 * Scoped to the audit object (NOT process-global like `stageUsage`), so
 * concurrent runs in one process each account for themselves.
 */
export interface TransportAudit {
  /** The wrapped transport — every stage of the run must call THIS one. */
  transport: LlmTransport;
  /** Tally for one stage; zeroed when the stage never reached the transport. */
  tally(stage: string): StageTransportTally;
  /** Tallies of every stage that reached the transport, in first-call order. */
  tallies(): StageTransportTally[];
  /** Tallies of the stages that lost at least one call. Empty on a clean run. */
  failures(): StageTransportTally[];
  /** True when a stage attempted calls and EVERY one of them failed. */
  isSystemicFailure(stage: string): boolean;
  /** Throw {@link LlmStageFailureError} when `stage` failed systemically. */
  assertStageHealthy(stage: string): void;
}

/**
 * Wrap `inner` so every call is counted under its `req.stage`, and a thrown call
 * is counted as a transport FAILURE with its message retained. Cache hits never
 * reach a transport, so a stage that resolved entirely from cache records zero
 * attempts — healthy, never a failure.
 */
export function auditTransport(inner: LlmTransport): TransportAudit {
  const byStage = new Map<string, StageTransportTally>();
  const entryFor = (stage: string): StageTransportTally => {
    const existing = byStage.get(stage);
    if (existing) return existing;
    const fresh: StageTransportTally = { stage, attempts: 0, failures: 0 };
    byStage.set(stage, fresh);
    return fresh;
  };
  const transport: LlmTransport = async (req) => {
    const tally = entryFor(req.stage ?? 'unknown');
    tally.attempts++;
    try {
      return await inner(req);
    } catch (e) {
      tally.failures++;
      const message = e instanceof Error ? e.message : String(e);
      if (!tally.firstError) tally.firstError = message.slice(0, MAX_TALLY_ERROR_CHARS);
      throw e;
    }
  };
  const audit: TransportAudit = {
    transport,
    tally: (stage) => ({ ...(byStage.get(stage) ?? { stage, attempts: 0, failures: 0 }) }),
    tallies: () => [...byStage.values()].map((t) => ({ ...t })),
    failures: () => [...byStage.values()].filter((t) => t.failures > 0).map((t) => ({ ...t })),
    isSystemicFailure: (stage) => isSystemicTally(byStage.get(stage)),
    assertStageHealthy: (stage) => {
      if (isSystemicTally(byStage.get(stage))) throw new LlmStageFailureError(audit.tally(stage));
    },
  };
  return audit;
}

/** Token/cost/timing usage parsed out of one `claude -p` JSON envelope. */
export interface EnvelopeUsage {
  /** Resolved model id (e.g. `claude-sonnet-4-6`), or the requested alias. */
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  costUsd: number;
  /** Agent turns the call took. >1 means the model looped (extra cost). */
  numTurns?: number;
  /** Claude's own wall time for the call (`duration_ms`). */
  claudeDurationMs?: number;
  /** Total API time (`duration_api_ms`). */
  apiDurationMs?: number;
  /** Time to first token (`ttft_ms`). */
  ttftMs?: number;
  /** Claude's startup before the first API request (`time_to_request_ms`). */
  timeToRequestMs?: number;
}

/**
 * Pull token/cost/timing/model usage out of the terminal `result` event (same
 * shape as the buffered `claude -p --output-format json` envelope, and as the
 * Agent SDK's own result message). The `agent` transport has no such envelope,
 * so usage there is simply absent (returns null).
 */
export function parseEnvelopeUsage(req: LlmRequest, envelope: unknown): EnvelopeUsage | null {
  if (!envelope || typeof envelope !== 'object') return null;
  const env = envelope as Record<string, unknown>;
  const usage = (env.usage ?? {}) as Record<string, unknown>;
  const modelUsage = (env.modelUsage ??
    (usage.modelUsage as unknown) ??
    {}) as Record<string, { inputTokens?: number }>;
  // Resolve the model id: prefer the modelUsage key matching the requested
  // alias (e.g. 'sonnet' → 'claude-sonnet-4-6'); else the busiest key; else
  // the alias the caller passed.
  const keys = Object.keys(modelUsage);
  let model = req.model ?? '';
  if (keys.length) {
    const alias = (req.model ?? '').toLowerCase();
    const inTok = (k: string): number => modelUsage[k]?.inputTokens ?? 0;
    const busiest = keys.reduce((a, b) => (inTok(b) > inTok(a) ? b : a));
    const aliasKey = alias ? keys.find((k) => k.toLowerCase().includes(alias)) : undefined;
    // Prefer the alias's resolved id, but only when it actually did work: if
    // --fallback-model served the call, the primary alias key shows ~0 tokens,
    // so fall back to the busiest key (the model that produced the output).
    model = aliasKey && inTok(aliasKey) > 0 ? aliasKey : busiest;
  }
  const num = (v: unknown): number => (typeof v === 'number' ? v : 0);
  const numU = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);
  return {
    model,
    inputTokens: num(usage.input_tokens),
    outputTokens: num(usage.output_tokens),
    cacheReadTokens: num(usage.cache_read_input_tokens),
    cacheCreateTokens: num(usage.cache_creation_input_tokens),
    costUsd: num(env.total_cost_usd),
    numTurns: numU(env.num_turns),
    claudeDurationMs: numU(env.duration_ms),
    apiDurationMs: numU(env.duration_api_ms),
    ttftMs: numU(env.ttft_ms),
    timeToRequestMs: numU(env.time_to_request_ms),
  };
}

/** Parse + record one call's usage under its stage. Returns the parsed usage. */
export function recordUsageFromEnvelope(req: LlmRequest, envelope: unknown): EnvelopeUsage | null {
  const u = parseEnvelopeUsage(req, envelope);
  if (u) recordStageUsage(req.stage, u);
  return u;
}

// ---------------------------------------------------------------------------
// per-call logging sink
// ---------------------------------------------------------------------------

/**
 * One `claude -p` invocation's metrics + raw I/O, emitted to the installed sink
 * (if any) on every terminal path — success or failure. Cache hits never reach
 * the transport, so they never produce a record. The raw `system`/`user`/
 * `responseText` are present so a sink can dump full I/O; the transport does not
 * retain them after the sink returns.
 */
export interface LlmCallRecord {
  /** ISO start time. */
  ts: string;
  stage: string;
  /** Resolved model id when the envelope reported it, else the requested alias. */
  model: string;
  id: string;
  /** Logical work items in this call (blocks in a batch); 1 for a single call. */
  itemCount: number;
  ok: boolean;
  /**
   * WHICH clock (if any) ended the call — `timeout` = the wall-clock ceiling,
   * `stall` = the started-then-silent stream guard, `error` = anything else
   * (non-zero exit, API error, bad output). Explicit rather than string-matched
   * off `error`, because telling a long-but-alive call from a hung one is the
   * whole point of the record.
   */
  outcome: 'ok' | 'timeout' | 'stall' | 'error';
  error?: string;
  exitCode: number | null;
  /** Our spawn→close wall time. */
  wallMs: number;
  /** Effective (scaled) wall-clock ceiling in force; absent when uncapped. */
  timeoutMs?: number;
  /** Effective (scaled) stall window in force. */
  stallTimeoutMs?: number;
  /**
   * NDJSON events observed before the terminal moment. `0` on a ceiling kill
   * means the call died in pre-first-token silence (deep reasoning or a dead
   * proxy); `> 0` means it was streaming right up to the ceiling.
   */
  eventCount: number;
  /** Silence at the terminal moment (ms since the last event); absent pre-stream. */
  msSinceLastEvent?: number;
  claudeDurationMs?: number;
  apiDurationMs?: number;
  ttftMs?: number;
  timeToRequestMs?: number;
  numTurns?: number;
  /** Bytes we sent: system + user prompt length. */
  inputChars: number;
  outputChars: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  costUsd: number;
  system: string;
  user: string;
  responseText: string;
}

let callSink: ((rec: LlmCallRecord) => void) | undefined;

/**
 * Install (or clear, with `undefined`) the per-call log sink.
 *
 * This is a process-global single slot — the same scoping as `stageUsage` above.
 * It is therefore single-run-only: do not enable per-call logging while two LLM
 * pipelines run concurrently in one process (their records would interleave into
 * one sink and the first to finish would clear it for the other). A server
 * enabling the (opt-in) logger must serialize runs. Run-scoping via
 * AsyncLocalStorage would lift this.
 */
export function setLlmCallSink(sink: ((rec: LlmCallRecord) => void) | undefined): void {
  callSink = sink;
}

/** The installed per-call sink, or `undefined` when none is set. */
export function getLlmCallSink(): ((rec: LlmCallRecord) => void) | undefined {
  return callSink;
}

/**
 * Hand one call record to the installed sink. Every `claude`-backed transport
 * reports through here — the `-p` spawn below and the Agent SDK one-shot in
 * `@truecourse/llm-claude-agent` — so the call log reads the same whichever
 * produced the call.
 */
export function emitLlmCallRecord(rec: LlmCallRecord): void {
  if (!callSink) return;
  try {
    callSink(rec);
  } catch {
    /* logging must never break a run */
  }
}

// ---------------------------------------------------------------------------
// process-wide default transport
// ---------------------------------------------------------------------------

/**
 * Optional process-installed default transport. A long-lived server can't pass
 * a transport through every call site — so the enterprise edition installs an
 * API-backed transport ONCE at boot via `setDefaultTransport`.
 * Runners/providers that aren't handed an explicit transport fall back to this.
 * Unset (OSS) → `undefined`, so callers supply their own transport.
 */
let installedDefault: LlmTransport | undefined;

/** Install (or clear, with `undefined`) the process-wide default transport. */
export function setDefaultTransport(transport: LlmTransport | undefined): void {
  installedDefault = transport;
}

/** The process-installed default transport, or `undefined` when none is set. */
export function getDefaultTransport(): LlmTransport | undefined {
  return installedDefault;
}

/** User-facing error when no LLM provider is configured (enterprise). */
export const NO_LLM_PROVIDER_MESSAGE =
  'No LLM provider is configured. Set one in Settings → Models.';

/**
 * The enterprise edition NEVER falls back to the local `claude` CLI. Until a
 * provider is configured, EE installs THIS as the process default (via
 * `setDefaultTransport`), so any LLM work errors loudly instead of silently
 * spawning the (often-absent) CLI. Replaced by the real AI-SDK transport the
 * moment a provider is saved/loaded.
 */
export const noProviderTransport: LlmTransport = async () => {
  throw new Error(NO_LLM_PROVIDER_MESSAGE);
};

/**
 * Whether a REAL provider transport is installed — not the no-provider sentinel
 * and not unset. EE entry points that do LLM work (knowledge sync, the gate's
 * contract generation) check this UP FRONT to fail loudly; otherwise the
 * consolidator's fail-open handling (e.g. the relevance filter defaults to
 * "include" on a transport error) silently swallows the "no provider" failure
 * and the run looks like it succeeded with no output.
 */
export function isLlmConfigured(): boolean {
  const t = getDefaultTransport();
  return t !== undefined && t !== noProviderTransport;
}

/**
 * Strip a single leading ```...``` fence (some models wrap JSON in fences even
 * when told not to). Shared so every runner strips identically.
 */
export function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const fence = /^```(?:json|JSON)?\s*\n([\s\S]*?)\n```$/.exec(trimmed);
  return fence ? fence[1] : trimmed;
}

/**
 * Extract the first balanced JSON value (`{…}` or `[…]`) from a model response,
 * robust to the ways weaker models wrap it: ```json fences (closed or not),
 * content on the same line as the fence, and trailing prose AFTER the JSON
 * ("…here is the JSON. Note: these are design choices, not specs."). The strict
 * `stripCodeFences` only matches a cleanly-fenced block, so a chatty response
 * left the fence in and `JSON.parse` choked on the leading backtick.
 *
 * Scans string/escape-aware so brackets inside string values don't throw off
 * the depth count. Returns the raw substring (caller still parses + validates);
 * falls back to the fence-stripped text when no bracket is found.
 */
export function extractJsonValue(text: string): string {
  const body = stripCodeFences(text);
  const start = body.search(/[[{]/);
  if (start === -1) return body;
  const open = body[start];
  const close = open === '[' ? ']' : '}';
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < body.length; i++) {
    const c = body[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return body.slice(start, i + 1);
    }
  }
  return body.slice(start); // unbalanced (truncated) — best effort for the caller
}

/**
 * Render a Zod schema as a JSON-schema STRING for `LlmRequest.schema`. The EE AI
 * SDK transport feeds this to `generateObject` (structured output, schema-
 * enforced); the OSS cli transport ignores it (it relies on the schema being
 * described in the prompt + `stripCodeFences`).
 *
 * `$refStrategy: 'none'` INLINES every reused sub-schema rather than emitting a
 * `$ref`. zod-to-json-schema's default refs a reused sub-schema by its first
 * path (e.g. `#/properties/topics/items`), but provider structured-output
 * validators require `$ref`s under `$defs`/`definitions` and reject the rest
 * ("References must be defined under '$defs'…") — which fails the whole call.
 * Inlining sidesteps it; these extraction schemas are flat DTOs, not recursive.
 *
 * `definitions` opts a DEEPLY-SHARED schema out of that inlining: each named
 * sub-schema renders once under `definitions` and is referenced everywhere it
 * recurs. Without it the web scenario schema — whose locator union (with its
 * 80-role enum) recurs in every verb, expectation, and capture — renders at
 * ~119K characters; named, it is ~18K. Callers without `definitions` get the
 * exact bytes they always did, so every existing prompt fingerprint holds.
 */
export function jsonSchemaHint(schema: ZodTypeAny, definitions?: Record<string, ZodTypeAny>): string {
  if (definitions) {
    return JSON.stringify(zodToJsonSchema(schema, { $refStrategy: 'root', definitions }));
  }
  return JSON.stringify(zodToJsonSchema(schema, { $refStrategy: 'none' }));
}

// ---------------------------------------------------------------------------
// per-call timeout scaling
// ---------------------------------------------------------------------------

/**
 * Multiplier applied to every per-call timeout (`TRUECOURSE_LLM_TIMEOUT_SCALE`,
 * a float; default 1). Scaling here — the single point every stage's ceiling
 * flows through — preserves the per-stage relative ceilings while letting a
 * slow model or proxy widen them all with one knob (e.g. `2`–`3`). Invalid,
 * zero, or negative values fall back to 1. Read per call so tests and long-run
 * env changes take effect without a restart.
 */
export function resolveTimeoutScale(): number {
  const env = process.env.TRUECOURSE_LLM_TIMEOUT_SCALE;
  if (env) {
    const parsed = parseFloat(env);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 1;
}

/** Default stall timeout (ms) when `TRUECOURSE_LLM_STALL_TIMEOUT_MS` is unset. */
export const DEFAULT_STALL_TIMEOUT_MS = 300_000;

/**
 * Effective stall timeout for a streaming transport: once the stream has
 * started, no event for this long → the call is killed as a stall. Reads
 * `TRUECOURSE_LLM_STALL_TIMEOUT_MS` (default 5 min) and applies the same
 * `resolveTimeoutScale` multiplier as the wall-clock ceiling, so one knob widens
 * both. Invalid/zero/negative → the default. This is NOT a first-token timeout:
 * pre-first-event silence is legitimate deep reasoning and only the ceiling
 * covers it; the stall clock arms only after the first event arrives.
 */
export function resolveStallTimeoutMs(): number {
  const env = process.env.TRUECOURSE_LLM_STALL_TIMEOUT_MS;
  let base = DEFAULT_STALL_TIMEOUT_MS;
  if (env) {
    const parsed = parseFloat(env);
    if (Number.isFinite(parsed) && parsed > 0) base = parsed;
  }
  return base * resolveTimeoutScale();
}
