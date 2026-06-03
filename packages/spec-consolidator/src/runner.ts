/**
 * Per-block extraction runner. Spawns one `claude -p` subprocess per
 * block, parses Claude Code's JSON envelope, validates the inner
 * payload against `LlmExtractionSchema`, and returns a typed result.
 *
 * The runner is injected — tests pass a stub that returns canned
 * outputs without touching the subprocess at all. Same pattern the
 * contract-extractor uses; keeps the orchestrator pure.
 */

import os from 'node:os';
import pLimit from 'p-limit';
import { getLlmTransport } from '@truecourse/llm';
import type { Block } from './slicer.js';
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
  /**
   * @deprecated The binary is resolved by the CLI transport (via the
   * `CLAUDE_CODE_BIN` env var); this field is ignored.
   */
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
  const concurrency = opts.concurrency ?? defaultConcurrency();
  const timeoutMs = opts.timeoutMs ?? 240_000;
  const limit = pLimit(concurrency);

  return async (blocks: Block[]): Promise<BlockRunResult[]> => {
    return Promise.all(
      blocks.map((block) =>
        limit(async () => {
          opts.onBlockStart?.(block);
          const t0 = Date.now();
          try {
            const extraction = await runOne(block, opts.model, opts.fallbackModel, timeoutMs);
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
  block: Block,
  model: string | undefined,
  fallbackModel: string | undefined,
  timeoutMs: number,
): Promise<LlmExtraction> {
  const { object } = await getLlmTransport().complete({
    system: SYSTEM_PROMPT,
    prompt: buildUserPrompt({
      filePath: block.filePath,
      headingPath: block.headingPath,
      startLine: block.startLine,
      text: block.text,
    }),
    schema: LlmExtractionSchema,
    model,
    fallbackModel,
    timeoutMs,
    label: `consolidate:${block.id}`,
    cliArgs: ['--setting-sources', 'project'],
  });
  return object;
}

