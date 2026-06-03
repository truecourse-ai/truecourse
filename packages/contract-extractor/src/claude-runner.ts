/**
 * Claude Code subprocess runner. Spawns `claude -p` for each cache-miss
 * slice, with a concurrency cap controlled by `TRUECOURSE_MAX_CONCURRENCY`
 * (defaults to `min(os.cpus().length, 4)`).
 *
 * The runner is interface-shaped so tests can pass a stub instead of
 * spawning real subprocesses. The default implementation (`spawnRunner`)
 * uses `claude` from PATH with `--output-format json` and feeds the
 * system prompt via `--append-system-prompt`.
 */

import os from 'node:os';
import pLimit from 'p-limit';
import { getLlmTransport } from '@truecourse/llm';
import type { ExtractionResult, SpecSlice } from './types.js';
import { ExtractionResultSchema } from './types.js';
import { buildUserPrompt, SYSTEM_PROMPT } from './prompt.js';

export interface ClaudeRunnerOptions {
  /**
   * @deprecated The binary is resolved by the CLI transport (via the
   * `CLAUDE_CODE_BIN` env var); this field is ignored. Kept for call-site
   * compatibility.
   */
  bin?: string;
  /** Model name passed through to the transport. Resolved per-stage by the caller. */
  model?: string;
  /** Fallback model passed to `claude --fallback-model`. */
  fallbackModel?: string;
  /** Hard cap on concurrent subprocesses. */
  concurrency?: number;
  /** Per-call timeout in milliseconds. */
  timeoutMs?: number;
  /** Hook fired before each subprocess spawn — useful for progress UIs. */
  onSliceStart?: (slice: SpecSlice) => void;
  /** Hook fired after each subprocess completes (success or failure). */
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
 * Build a runner that issues one structured LLM call per slice through the
 * active transport (CLI locally, an API provider in enterprise). Each call is
 * independent — failures don't abort the batch; the orchestrator decides
 * whether to surface or retry.
 */
export function spawnRunner(opts: ClaudeRunnerOptions = {}): SliceRunner {
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
            const result = await runOne(slice, opts.model, opts.fallbackModel, timeoutMs);
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
  slice: SpecSlice,
  model: string | undefined,
  fallbackModel: string | undefined,
  timeoutMs: number,
): Promise<ExtractionResult> {
  const { object } = await getLlmTransport().complete({
    system: SYSTEM_PROMPT,
    prompt: buildUserPrompt(slice),
    schema: ExtractionResultSchema,
    model,
    fallbackModel,
    timeoutMs,
    label: `extract:${slice.id}`,
    // Preserve the extractor's project-scoped settings on the CLI transport.
    cliArgs: ['--setting-sources', 'project'],
  });
  return object;
}
