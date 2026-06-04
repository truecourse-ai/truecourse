/**
 * Per-slice extraction runner. For each cache-miss slice it builds a
 * system + user prompt and hands it to an `LlmTransport` (cli = spawn
 * `claude -p`, agent = filesystem mailbox), then validates the response
 * against `ExtractionResultSchema`. Concurrency is capped by
 * `TRUECOURSE_MAX_CONCURRENCY` (defaults to `min(os.cpus().length, 4)`).
 *
 * The transport is injected — tests pass a stub that returns canned
 * outputs without touching the transport at all. Concurrency lives here
 * (p-limit); the transport is a single-request function.
 */

import os from 'node:os';
import pLimit from 'p-limit';
import { cliTransport, stripCodeFences, type LlmTransport } from '@truecourse/shared/llm';
import type { ExtractionResult, SpecSlice } from './types.js';
import { ExtractionResultSchema } from './types.js';
import { buildUserPrompt, SYSTEM_PROMPT } from './prompt.js';

export interface ClaudeRunnerOptions {
  /**
   * LLM transport. Defaults to `cliTransport()` (spawns `claude -p`). The
   * CLI/dashboard pass `agentTransport(io)` for headless/routine runs.
   */
  transport?: LlmTransport;
  /** Override the binary; defaults to `claude` (resolved via PATH). */
  bin?: string;
  /** Model name passed to `claude --model`. Resolved per-stage by the caller. */
  model?: string;
  /** Fallback model passed to `claude --fallback-model`. */
  fallbackModel?: string;
  /** Hard cap on concurrent subprocesses. */
  concurrency?: number;
  /** Per-call timeout in milliseconds. */
  timeoutMs?: number;
  /** Hook fired before each request — useful for progress UIs. */
  onSliceStart?: (slice: SpecSlice) => void;
  /** Hook fired after each request completes (success or failure). */
  onSliceDone?: (slice: SpecSlice, ok: boolean) => void;
}

export interface SliceRunResult {
  slice: SpecSlice;
  /** The parsed extraction result on success. */
  result?: ExtractionResult;
  /** Error message on failure (subprocess exit, JSON parse, schema fail). */
  error?: string;
  /** Wall-clock duration in milliseconds. */
  durationMs: number;
}

export type SliceRunner = (slices: SpecSlice[]) => Promise<SliceRunResult[]>;

export function defaultConcurrency(): number {
  const env = process.env.TRUECOURSE_MAX_CONCURRENCY;
  if (env) {
    const parsed = parseInt(env, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return Math.min(os.cpus().length, 4);
}

/**
 * Build a runner that calls the transport once per slice. Each request is
 * independent — failures don't abort the batch; the orchestrator decides
 * whether to surface or retry.
 */
export function spawnRunner(opts: ClaudeRunnerOptions = {}): SliceRunner {
  const transport = opts.transport ?? cliTransport({ bin: opts.bin });
  const concurrency = opts.concurrency ?? defaultConcurrency();
  const timeoutMs = opts.timeoutMs ?? 600_000;
  const limit = pLimit(concurrency);

  return async (slices: SpecSlice[]): Promise<SliceRunResult[]> => {
    return Promise.all(
      slices.map((slice) =>
        limit(async () => {
          opts.onSliceStart?.(slice);
          const t0 = Date.now();
          try {
            const result = await runOne(transport, slice, timeoutMs, opts.model, opts.fallbackModel);
            opts.onSliceDone?.(slice, true);
            return { slice, result, durationMs: Date.now() - t0 };
          } catch (e) {
            opts.onSliceDone?.(slice, false);
            const message = e instanceof Error ? e.message : String(e);
            return { slice, error: message, durationMs: Date.now() - t0 };
          }
        }),
      ),
    );
  };
}

async function runOne(
  transport: LlmTransport,
  slice: SpecSlice,
  timeoutMs: number,
  model?: string,
  fallbackModel?: string,
): Promise<ExtractionResult> {
  const userPrompt = buildUserPrompt(slice);
  const raw = await transport({
    id: `contract.extract:${slice.id}`,
    stage: 'contract.extract',
    model,
    fallbackModel,
    system: SYSTEM_PROMPT,
    user: userPrompt,
    responseFormat: 'json',
    timeoutMs,
  });
  const inner = JSON.parse(stripCodeFences(raw));
  return ExtractionResultSchema.parse(inner);
}
