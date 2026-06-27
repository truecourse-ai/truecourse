/**
 * LLM transport — the single seam through which every LLM-powered runner
 * (spec-consolidator's block/conflict/relevance/chain runners,
 * contract-extractor's slice runner + repair pass) reaches the model.
 *
 * A transport is a single-request function `(req) => Promise<rawText>`: it
 * takes a system + user prompt and returns the model's raw assistant text.
 * The caller does its own fence-stripping + JSON.parse + Zod validation, so
 * the transport is content-agnostic. Concurrency stays in each runner (its
 * existing p-limit), so a single-request transport composes naturally.
 *
 * Two backends:
 *   - `cliTransport` — spawns `claude -p …` (the default; same behavior the
 *     runners had inline). Needs the `claude` binary on PATH.
 *   - `agentTransport` — a filesystem mailbox: writes each prompt to
 *     `<io>/requests/<id>.json` and waits for `<io>/responses/<id>.json`. An
 *     orchestrating agent that is *already an LLM* (a Claude Code routine)
 *     answers the prompts, so contracts can be generated with no `claude`
 *     subprocess and no API key.
 */

import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { resolveClaudeBinary } from '../claude-binary.js';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ZodTypeAny } from 'zod';

export interface LlmRequest {
  /** Stable id (the runner's natural id, e.g. `spec.claimExtract:<block.id>`).
   *  Falls back to a content hash when absent. */
  id?: string;
  /** Pipeline stage, e.g. `spec.claimExtract` / `contract.extract` — informational. */
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
  /** Per-call timeout in ms. */
  timeoutMs?: number;
  /**
   * Logical work items in this call (e.g. blocks in a claim-extract batch).
   * Informational only — drives per-item metrics in the call log. Defaults to 1.
   */
  itemCount?: number;
}

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

// Process-wide, keyed by stage. A CLI run is one process, so this scopes
// naturally to the run; call resetStageUsage() up front to be safe.
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
 * Pull token/cost/timing/model usage out of a `claude -p --output-format json`
 * envelope. The `agent` transport has no such envelope, so usage there is
 * simply absent (returns null).
 */
function parseEnvelopeUsage(req: LlmRequest, envelope: unknown): EnvelopeUsage | null {
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
function recordUsageFromEnvelope(req: LlmRequest, envelope: unknown): EnvelopeUsage | null {
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
  error?: string;
  exitCode: number | null;
  /** Our spawn→close wall time. */
  wallMs: number;
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
 * one sink and the first to finish would clear it for the other). The CLI runs
 * one pipeline per process, so this holds there; a server enabling the (opt-in)
 * logger must serialize runs. Run-scoping via AsyncLocalStorage would lift this.
 */
export function setLlmCallSink(sink: ((rec: LlmCallRecord) => void) | undefined): void {
  callSink = sink;
}

function emitCall(rec: LlmCallRecord): void {
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
 * Optional process-installed default transport. The CLI threads `cli`/`agent`
 * per run, but a long-lived server can't pass a transport through every call
 * site — so the enterprise edition installs an API-backed transport ONCE at
 * boot via `setDefaultTransport`. Runners/providers that aren't handed an
 * explicit transport fall back to this. Unset (OSS) → `undefined`, so callers
 * use their own `cliTransport()` and behavior is byte-for-byte unchanged.
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
 */
export function jsonSchemaHint(schema: ZodTypeAny): string {
  return JSON.stringify(zodToJsonSchema(schema, { $refStrategy: 'none' }));
}

// ---------------------------------------------------------------------------
// cli backend — spawn `claude -p`
// ---------------------------------------------------------------------------

export interface CliTransportOptions {
  /**
   * Binary; defaults to `resolveClaudeBinary()` (CLAUDE_CODE_BINARY →
   * CLAUDE_CODE_BIN → `claude` on PATH). Resolving here — the one place that
   * spawns `claude` — keeps every runner pointed at the same binary the
   * up-front CLI preflight tests, with no per-runner duplication.
   */
  bin?: string;
}

export function cliTransport(opts: CliTransportOptions = {}): LlmTransport {
  const bin = opts.bin ?? resolveClaudeBinary();
  return (req) =>
    new Promise<string>((resolve, reject) => {
      const t0 = Date.now();
      const ts = new Date().toISOString();
      const inputChars = req.system.length + req.user.length;
      const itemCount = req.itemCount ?? 1;
      const id = req.id ?? '';
      const stage = req.stage ?? 'unknown';
      let reported = false;
      let timer: ReturnType<typeof setTimeout> | null = null;

      // Emit exactly one call record, on the first terminal path. A timeout
      // SIGKILLs the proc, whose `close` then fires too — the guard prevents a
      // double record (and the late reject is a no-op on a settled promise).
      const fail = (error: string, exitCode: number | null): void => {
        if (reported) return;
        reported = true;
        if (timer) clearTimeout(timer);
        emitCall({
          ts, stage, model: req.model ?? '', id, itemCount,
          ok: false, error, exitCode, wallMs: Date.now() - t0,
          inputChars, outputChars: 0,
          inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0, costUsd: 0,
          system: req.system, user: req.user, responseText: '',
        });
      };
      const succeed = (usage: EnvelopeUsage | null, text: string): void => {
        if (reported) return;
        reported = true;
        if (timer) clearTimeout(timer);
        emitCall({
          ts, stage, model: usage?.model || req.model || '', id, itemCount,
          ok: true, exitCode: 0, wallMs: Date.now() - t0,
          inputChars, outputChars: text.length,
          inputTokens: usage?.inputTokens ?? 0, outputTokens: usage?.outputTokens ?? 0,
          cacheReadTokens: usage?.cacheReadTokens ?? 0, cacheCreateTokens: usage?.cacheCreateTokens ?? 0,
          costUsd: usage?.costUsd ?? 0, numTurns: usage?.numTurns,
          claudeDurationMs: usage?.claudeDurationMs, apiDurationMs: usage?.apiDurationMs,
          ttftMs: usage?.ttftMs, timeToRequestMs: usage?.timeToRequestMs,
          system: req.system, user: req.user, responseText: text,
        });
      };

      const modelArgs: string[] = [];
      if (req.model) modelArgs.push('--model', req.model);
      if (req.fallbackModel) modelArgs.push('--fallback-model', req.fallbackModel);
      const args = [
        '-p',
        req.user,
        ...modelArgs,
        '--output-format',
        'json',
        '--append-system-prompt',
        req.system,
        // `user` (not `project`): these stages are pure text-in/JSON-out and
        // never need the *scanned* repo's CLAUDE.md or tools. Loading `project`
        // hauled that file into every call — ~5k cache-creation tokens (1.25x)
        // per block of pure overhead. `user` keeps only the operator's own config.
        '--setting-sources',
        'user',
      ];
      const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      const out: Buffer[] = [];
      const err: Buffer[] = [];
      timer = req.timeoutMs
        ? setTimeout(() => {
            proc.kill('SIGKILL');
            fail(`claude timed out after ${req.timeoutMs}ms`, null);
            reject(new Error(`claude timed out after ${req.timeoutMs}ms`));
          }, req.timeoutMs)
        : null;
      proc.stdout.on('data', (b: Buffer) => out.push(b));
      proc.stderr.on('data', (b: Buffer) => err.push(b));
      proc.on('error', (e) => {
        fail(e instanceof Error ? e.message : String(e), null);
        reject(e);
      });
      proc.on('close', (code) => {
        if (code !== 0) {
          const msg = `claude exited ${code}: ${Buffer.concat(err).toString('utf-8')}`;
          fail(msg, code);
          reject(new Error(msg));
          return;
        }
        try {
          const envelope = JSON.parse(Buffer.concat(out).toString('utf-8'));
          // An API error can surface as exit 0 WITH `is_error: true` in the
          // envelope (e.g. 429 usage-limit, 5xx). Treat that as a transport
          // failure too — so callers (the batch runner) see a thrown error and
          // do NOT fan out into per-block retries against a degraded API.
          if (envelope && typeof envelope === 'object' && envelope.is_error === true) {
            const status = envelope.api_error_status ? ` (api ${envelope.api_error_status})` : '';
            const detail = typeof envelope.result === 'string' ? `: ${envelope.result}` : '';
            const msg = `claude API error${status}${detail}`.slice(0, 500);
            fail(msg, code);
            reject(new Error(msg));
            return;
          }
          // Best-effort token/cost accounting — never let it break extraction.
          let usage: EnvelopeUsage | null = null;
          try {
            usage = recordUsageFromEnvelope(req, envelope);
          } catch {
            /* usage is observational only */
          }
          const text = typeof envelope === 'string' ? envelope : envelope.result;
          if (typeof text !== 'string') {
            fail('claude returned no text', 0);
            reject(new Error('claude returned no text'));
            return;
          }
          succeed(usage, text);
          resolve(text);
        } catch (e) {
          fail(e instanceof Error ? e.message : String(e), 0);
          reject(e instanceof Error ? e : new Error(String(e)));
        }
      });
    });
}

// ---------------------------------------------------------------------------
// agent backend — filesystem mailbox
// ---------------------------------------------------------------------------

export interface AgentTransportOptions {
  /** Poll interval in ms (default 200). */
  pollMs?: number;
  /** Timeout used when a request omits `timeoutMs` (default 600000). */
  defaultTimeoutMs?: number;
}

/**
 * Mailbox protocol under `ioDir`:
 *   requests/<id>.json   { id, stage, model, fallbackModel, responseFormat, schema, system, user }
 *   responses/<id>.json  { text } | { error }
 * Both files are written atomically (write-tmp + rename) so neither side reads
 * a partial file. Each concurrent transport call owns one id; the runner's own
 * concurrency drives how many requests are in flight.
 */
export function agentTransport(ioDir: string, opts: AgentTransportOptions = {}): LlmTransport {
  const reqDir = path.join(ioDir, 'requests');
  const resDir = path.join(ioDir, 'responses');
  fs.mkdirSync(reqDir, { recursive: true });
  fs.mkdirSync(resDir, { recursive: true });
  const pollMs = opts.pollMs ?? 200;
  const defaultTimeout = opts.defaultTimeoutMs ?? 600_000;

  return async (req) => {
    const id = sanitizeId(req.id ?? deriveId(req));
    const reqPath = path.join(reqDir, `${id}.json`);
    const resPath = path.join(resDir, `${id}.json`);

    // Resume-friendly: if an answer is already present (e.g. a re-run after a
    // crash), consume it without re-writing the request.
    if (!fs.existsSync(resPath)) {
      atomicWrite(
        reqPath,
        JSON.stringify(
          {
            id,
            stage: req.stage,
            model: req.model,
            fallbackModel: req.fallbackModel,
            responseFormat: req.responseFormat ?? 'json',
            schema: req.schema,
            system: req.system,
            user: req.user,
          },
          null,
          2,
        ),
      );
    }

    const deadline = Date.now() + (req.timeoutMs ?? defaultTimeout);
    for (;;) {
      if (fs.existsSync(resPath)) {
        let parsed: { text?: string; error?: string };
        try {
          parsed = JSON.parse(fs.readFileSync(resPath, 'utf-8'));
        } catch {
          // partial write — retry
          await sleep(pollMs);
          continue;
        }
        if (parsed.error) throw new Error(`agent answer error for ${id}: ${parsed.error}`);
        if (typeof parsed.text === 'string') return parsed.text;
        throw new Error(`agent answer for ${id} missing "text"`);
      }
      if (Date.now() > deadline) {
        throw new Error(`agent transport timed out (${id}) waiting for ${resPath}`);
      }
      await sleep(pollMs);
    }
  };
}

function deriveId(req: LlmRequest): string {
  return createHash('sha256')
    .update(`${req.stage ?? ''}\0${req.system}\0${req.user}`)
    .digest('hex')
    .slice(0, 24);
}

/** Keep request/response filenames portable: only word chars, dot, and dash. */
function sanitizeId(id: string): string {
  return id.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 200);
}

function atomicWrite(filePath: string, data: string): void {
  const tmp = `${filePath}.tmp-${randomUUID()}`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, filePath);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
