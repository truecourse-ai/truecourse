/**
 * Per-block extraction runner. Spawns one `claude -p` subprocess per
 * block, parses Claude Code's JSON envelope, validates the inner
 * payload against `LlmExtractionSchema`, and returns a typed result.
 *
 * The runner is injected — tests pass a stub that returns canned
 * outputs without touching the subprocess at all. Same pattern the
 * contract-extractor uses; keeps the orchestrator pure.
 */

import { spawn } from 'node:child_process';
import { resolveClaudeBinary } from '@truecourse/shared';
import os from 'node:os';
import pLimit from 'p-limit';
import type { Block } from './slicer.js';
import { buildModelArgs } from './model-args.js';
import {
  LlmExtractionSchema,
  SYSTEM_PROMPT,
  buildUserPrompt,
  type LlmExtraction,
} from './prompt.js';

export interface BlockRunResult {
  block: Block;
  /** Parsed extraction on success. */
  extraction?: LlmExtraction;
  /** Error message on failure (subprocess exit, parse, schema fail). */
  error?: string;
  durationMs: number;
}

export type BlockRunner = (blocks: Block[]) => Promise<BlockRunResult[]>;

export interface SpawnRunnerOptions {
  /** Path to the claude binary. Defaults to `resolveClaudeBinary()`. */
  bin?: string;
  /**
   * Model name passed to `claude --model`. When unset, the CLI default
   * applies. CLI and dashboard server resolve this per-stage via
   * `@truecourse/core/config/llm-models`.
   */
  model?: string;
  /** Optional fallback model passed to `claude --fallback-model`. */
  fallbackModel?: string;
  /** Concurrent subprocesses. Defaults to min(cpus, 4). */
  concurrency?: number;
  /** Per-call timeout. Defaults to 240000ms (matches contract-extractor's bumped timeout). */
  timeoutMs?: number;
  /** Hook fired before each subprocess spawn — useful for progress UIs. */
  onBlockStart?: (block: Block) => void;
  /** Hook fired after each subprocess completes (success or failure). */
  onBlockDone?: (block: Block, ok: boolean) => void;
}

export function defaultConcurrency(): number {
  const env = process.env.TRUECOURSE_MAX_CONCURRENCY;
  if (env) {
    const parsed = parseInt(env, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return Math.min(os.cpus().length, 4);
}

/**
 * Build a runner that spawns `claude -p` for each block. Each
 * subprocess is independent — failures don't abort the batch.
 */
export function spawnRunner(opts: SpawnRunnerOptions = {}): BlockRunner {
  const bin = opts.bin ?? resolveClaudeBinary();
  const concurrency = opts.concurrency ?? defaultConcurrency();
  const timeoutMs = opts.timeoutMs ?? 240_000;
  const modelArgs = buildModelArgs(opts.model, opts.fallbackModel);
  const limit = pLimit(concurrency);

  return async (blocks: Block[]): Promise<BlockRunResult[]> => {
    return Promise.all(
      blocks.map((block) =>
        limit(async () => {
          opts.onBlockStart?.(block);
          const t0 = Date.now();
          try {
            const extraction = await runOne(bin, block, timeoutMs, modelArgs);
            opts.onBlockDone?.(block, true);
            return { block, extraction, durationMs: Date.now() - t0 };
          } catch (e) {
            opts.onBlockDone?.(block, false);
            const message = e instanceof Error ? e.message : String(e);
            return { block, error: message, durationMs: Date.now() - t0 };
          }
        }),
      ),
    );
  };
}

async function runOne(
  bin: string,
  block: Block,
  timeoutMs: number,
  modelArgs: string[],
): Promise<LlmExtraction> {
  const userPrompt = buildUserPrompt({
    filePath: block.filePath,
    headingPath: block.headingPath,
    startLine: block.startLine,
    text: block.text,
  });
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

  return new Promise<LlmExtraction>((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`claude timed out after ${timeoutMs}ms for block ${block.id}`));
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
        const envelope = JSON.parse(Buffer.concat(stdout).toString('utf-8'));
        const text = typeof envelope === 'string' ? envelope : envelope.result;
        if (typeof text !== 'string') {
          reject(new Error(`claude returned no text for block ${block.id}`));
          return;
        }
        const inner = JSON.parse(stripCodeFences(text));
        resolve(LlmExtractionSchema.parse(inner));
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

