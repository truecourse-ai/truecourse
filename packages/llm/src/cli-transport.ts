/**
 * The default transport: spawn the local `claude` binary in print mode and
 * validate the response. This is what the OSS / local product uses; it depends
 * only on a `claude` binary on PATH. The enterprise edition replaces it via
 * `setLlmTransport` with an API-backed transport.
 */

import spawn from 'cross-spawn';
import type { ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { buildModelArgs } from './model-args.js';
import type {
  CompleteRequest,
  CompleteResult,
  CompleteTextRequest,
  CompleteTextResult,
  CompleteUsage,
  Inferred,
  LlmTransport,
} from './transport.js';

const DEFAULT_TIMEOUT_MS = 600_000;

const BASE_ARGS = [
  '--print',
  '--output-format',
  'json',
  '--dangerously-skip-permissions',
  '--no-session-persistence',
];

/** Some models wrap JSON in a markdown fence even when told not to. */
function stripCodeFences(text: string): string {
  const t = text.trim();
  const m = /^```(?:json|JSON)?\s*\n([\s\S]*?)\n```$/.exec(t);
  return m ? m[1] : t;
}

function extractUsage(envelope: Record<string, unknown>): CompleteUsage | undefined {
  const u = envelope.usage as Record<string, number> | undefined;
  if (!u) return undefined;
  const input = u.input_tokens ?? 0;
  const output = u.output_tokens ?? 0;
  const cacheRead = u.cache_read_input_tokens ?? 0;
  const cacheWrite = u.cache_creation_input_tokens ?? 0;
  const cost = envelope.total_cost_usd;
  return {
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    // Billable total is input + output; cache tokens are tracked separately.
    totalTokens: input + output,
    costUsd: typeof cost === 'number' ? String(cost) : undefined,
  };
}

/** Pull an error message out of an `is_error` CLI envelope, if present. */
function envelopeError(raw: string): string | null {
  try {
    const env = JSON.parse(raw) as Record<string, unknown>;
    if (env.is_error) {
      const r = env.result ?? env.subtype;
      return typeof r === 'string' ? r : 'agent error';
    }
  } catch {
    // not a JSON envelope
  }
  return null;
}

/**
 * Strip Claude Code nesting-guard env vars so the spawned `claude` doesn't
 * detect (and refuse to run under) a parent Claude Code session.
 */
function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('CLAUDE_CODE') || key.startsWith('CLAUDE_INTERNAL')) {
      delete env[key];
    }
  }
  return env;
}

/** Spawn `claude` with the given args, pipe `prompt` on stdin, resolve stdout. */
function spawnClaude(
  args: string[],
  prompt: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<string> {
  const bin =
    process.env.CLAUDE_CODE_BIN ?? process.env.TRUECOURSE_CLI_BINARY ?? 'claude';
  return new Promise<string>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    // cross-spawn resolves Windows `.cmd`/`.ps1` shims without shell:true.
    const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'], env: cleanEnv() });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let done = false;
    let timer: NodeJS.Timeout;

    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      cleanup();
      fn();
    };
    function onAbort() {
      child.kill('SIGTERM');
      finish(() => reject(new DOMException('Aborted', 'AbortError')));
    }

    timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(() => reject(new Error(`[llm/cli] timed out after ${timeoutMs}ms`)));
    }, timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout!.on('data', (b: Buffer) => out.push(b));
    child.stderr!.on('data', (b: Buffer) => err.push(b));
    child.on('error', (e) =>
      finish(() => reject(new Error(`[llm/cli] failed to spawn ${bin}: ${e.message}`))),
    );
    child.on('close', (code) =>
      finish(() => {
        const stdout = Buffer.concat(out).toString('utf-8');
        if (code !== 0) {
          // The CLI usually reports the real error in its stdout envelope; fall
          // back to stderr only when there's no envelope error.
          const detail =
            envelopeError(stdout) ??
            Buffer.concat(err).toString('utf-8').trim().slice(0, 500);
          reject(new Error(`[llm/cli] ${bin} exited ${code}: ${detail}`));
          return;
        }
        resolve(stdout);
      }),
    );

    child.stdin!.write(prompt);
    child.stdin!.end();
  });
}

/**
 * Claude Code's `--output-format json` wraps the model output in an envelope.
 * With `--json-schema` the validated object lands in `structured_output`;
 * otherwise the raw text is in `result` (a JSON string we parse ourselves).
 */
/** Exposed for testing: parse + validate a Claude Code JSON envelope. */
export function parseEnvelope<S extends ZodTypeAny>(
  raw: string,
  schema: S,
): CompleteResult<Inferred<S>> {
  const envelope = JSON.parse(raw) as Record<string, unknown>;
  // An agent error can come back with exit code 0; surface it before parsing.
  if (envelope.is_error) {
    const r = envelope.result ?? envelope.subtype;
    throw new Error(`[llm/cli] agent error: ${typeof r === 'string' ? r : 'unknown'}`);
  }
  const usage = extractUsage(envelope);
  if (envelope.structured_output != null) {
    return { object: schema.parse(envelope.structured_output), usage };
  }
  const result = envelope.result;
  if (result != null) {
    const data =
      typeof result === 'string' ? JSON.parse(stripCodeFences(result)) : result;
    return { object: schema.parse(data), usage };
  }
  throw new Error('[llm/cli] CLI envelope had neither structured_output nor result');
}

export const cliTransport: LlmTransport = {
  async complete<S extends ZodTypeAny>(
    req: CompleteRequest<S>,
  ): Promise<CompleteResult<Inferred<S>>> {
    const args = [
      ...BASE_ARGS,
      ...buildModelArgs(req.model, req.fallbackModel),
      // Opt-in server-side schema enforcement; most callers validate the
      // returned text client-side instead (see CompleteRequest.cliJsonSchema).
      ...(req.cliJsonSchema
        ? ['--json-schema', JSON.stringify(zodToJsonSchema(req.schema, { target: 'openApi3' }))]
        : []),
      ...(req.system ? ['--append-system-prompt', req.system] : []),
      ...(req.cliArgs ?? []),
    ];
    const raw = await spawnClaude(
      args,
      req.prompt,
      req.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      req.signal,
    );
    return parseEnvelope(raw, req.schema);
  },

  async completeText(req: CompleteTextRequest): Promise<CompleteTextResult> {
    const args = [
      ...BASE_ARGS,
      ...buildModelArgs(req.model, req.fallbackModel),
      ...(req.system ? ['--append-system-prompt', req.system] : []),
      ...(req.cliArgs ?? []),
    ];
    const raw = await spawnClaude(
      args,
      req.prompt,
      req.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      req.signal,
    );
    const envelope = JSON.parse(raw) as Record<string, unknown>;
    if (envelope.is_error) {
      const r = envelope.result ?? envelope.subtype;
      throw new Error(`[llm/cli] agent error: ${typeof r === 'string' ? r : 'unknown'}`);
    }
    const usage = extractUsage(envelope);
    const result = envelope.result;
    const text = typeof result === 'string' ? result : '';
    return { text, usage };
  },
};
