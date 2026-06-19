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
}

/** Returns the model's raw assistant text. The caller strips fences + parses. */
export type LlmTransport = (req: LlmRequest) => Promise<string>;

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
        '--setting-sources',
        'project',
      ];
      const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      const out: Buffer[] = [];
      const err: Buffer[] = [];
      const timer = req.timeoutMs
        ? setTimeout(() => {
            proc.kill('SIGKILL');
            reject(new Error(`claude timed out after ${req.timeoutMs}ms`));
          }, req.timeoutMs)
        : null;
      proc.stdout.on('data', (b: Buffer) => out.push(b));
      proc.stderr.on('data', (b: Buffer) => err.push(b));
      proc.on('error', (e) => {
        if (timer) clearTimeout(timer);
        reject(e);
      });
      proc.on('close', (code) => {
        if (timer) clearTimeout(timer);
        if (code !== 0) {
          reject(new Error(`claude exited ${code}: ${Buffer.concat(err).toString('utf-8')}`));
          return;
        }
        try {
          const envelope = JSON.parse(Buffer.concat(out).toString('utf-8'));
          const text = typeof envelope === 'string' ? envelope : envelope.result;
          if (typeof text !== 'string') {
            reject(new Error('claude returned no text'));
            return;
          }
          resolve(text);
        } catch (e) {
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
