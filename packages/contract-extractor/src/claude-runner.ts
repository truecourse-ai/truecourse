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
import { spawn } from 'node:child_process';
import { resolveClaudeBinary } from '@truecourse/shared';
import pLimit from 'p-limit';
import type { ExtractionResult, SpecSlice } from './types.js';
import { ExtractionResultSchema } from './types.js';
import { buildUserPrompt, SYSTEM_PROMPT } from './prompt.js';
import { buildModelArgs } from './model-args.js';

export interface ClaudeRunnerOptions {
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
 * Build a runner that spawns `claude -p` for each slice. Each subprocess
 * is independent — failures don't abort the batch; the orchestrator
 * decides whether to surface or retry.
 */
export function spawnRunner(opts: ClaudeRunnerOptions = {}): SliceRunner {
  const bin = opts.bin ?? resolveClaudeBinary();
  const concurrency = opts.concurrency ?? defaultConcurrency();
  const timeoutMs = opts.timeoutMs ?? 600_000;
  const modelArgs = buildModelArgs(opts.model, opts.fallbackModel);
  const limit = pLimit(concurrency);

  return async (slices: SpecSlice[]): Promise<SliceRunResult[]> => {
    return Promise.all(
      slices.map((slice) =>
        limit(async () => {
          opts.onSliceStart?.(slice);
          const t0 = Date.now();
          try {
            const result = await runOne(bin, slice, timeoutMs, modelArgs);
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
  bin: string,
  slice: SpecSlice,
  timeoutMs: number,
  modelArgs: string[],
): Promise<ExtractionResult> {
  const userPrompt = buildUserPrompt(slice);
  const args = [
    '-p',
    userPrompt,
    ...modelArgs,
    '--output-format',
    'json',
    '--append-system-prompt',
    SYSTEM_PROMPT,
    '--setting-sources',
    'project',
  ];

  return new Promise<ExtractionResult>((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`claude timed out after ${timeoutMs}ms for slice ${slice.id}`));
    }, timeoutMs);

    proc.stdout.on('data', (b: Buffer) => stdout.push(b));
    proc.stderr.on('data', (b: Buffer) => stderr.push(b));
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`claude exited ${code}: ${Buffer.concat(stderr).toString('utf-8')}`));
        return;
      }
      try {
        // Claude Code's --output-format json wraps the model's response in
        // an envelope. The actual model text lives at .result on stdout.
        const envelope = JSON.parse(Buffer.concat(stdout).toString('utf-8'));
        const text = typeof envelope === 'string' ? envelope : envelope.result;
        if (typeof text !== 'string') {
          reject(new Error(`claude returned no text for slice ${slice.id}`));
          return;
        }
        const inner = JSON.parse(stripCodeFences(text));
        resolve(ExtractionResultSchema.parse(inner));
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  });
}

/**
 * Some models wrap JSON in markdown code fences even when told not to.
 * Strip a single leading ```...``` fence (with or without lang tag).
 */
function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = /^```(?:json|JSON)?\s*\n([\s\S]*?)\n```$/.exec(trimmed);
  return fenceMatch ? fenceMatch[1] : trimmed;
}
