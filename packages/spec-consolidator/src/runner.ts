/**
 * Per-block extraction runner. For each block it builds a system + user
 * prompt and hands it to an `LlmTransport` (cli = spawn `claude -p`, agent =
 * filesystem mailbox), then validates the response against
 * `LlmExtractionSchema`.
 *
 * The runner is injected — tests pass a stub that returns canned outputs
 * without touching the transport at all. Concurrency lives here (p-limit);
 * the transport is a single-request function.
 */

import os from 'node:os';
import pLimit from 'p-limit';
import { cliTransport, stripCodeFences, type LlmTransport } from '@truecourse/shared/llm';
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
  /** Error message on failure (transport error, parse, schema fail). */
  error?: string;
  durationMs: number;
}

export type BlockRunner = (blocks: Block[]) => Promise<BlockRunResult[]>;

export interface SpawnRunnerOptions {
  /**
   * LLM transport. Defaults to `cliTransport()` (spawns `claude -p`). The
   * CLI/dashboard pass `agentTransport(io)` for headless/routine runs.
   */
  transport?: LlmTransport;
  /** Path to the claude binary (cli transport only). Defaults to `CLAUDE_CODE_BIN` env or 'claude'. */
  bin?: string;
  /**
   * Model name passed to `claude --model`. When unset, the CLI default
   * applies. CLI and dashboard server resolve this per-stage via
   * `@truecourse/core/config/llm-models`.
   */
  model?: string;
  /** Optional fallback model passed to `claude --fallback-model`. */
  fallbackModel?: string;
  /** Concurrent requests. Defaults to min(cpus, 4). */
  concurrency?: number;
  /** Per-call timeout. Defaults to 240000ms. */
  timeoutMs?: number;
  /** Hook fired before each request — useful for progress UIs. */
  onBlockStart?: (block: Block) => void;
  /** Hook fired after each request completes (success or failure). */
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
 * Build a runner that calls the transport once per block. Each request is
 * independent — failures don't abort the batch.
 */
export function spawnRunner(opts: SpawnRunnerOptions = {}): BlockRunner {
  const transport = opts.transport ?? cliTransport({ bin: opts.bin });
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
            const extraction = await runOne(transport, block, timeoutMs, opts.model, opts.fallbackModel);
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
  transport: LlmTransport,
  block: Block,
  timeoutMs: number,
  model?: string,
  fallbackModel?: string,
): Promise<LlmExtraction> {
  const userPrompt = buildUserPrompt({
    filePath: block.filePath,
    headingPath: block.headingPath,
    startLine: block.startLine,
    text: block.text,
  });
  const raw = await transport({
    id: `spec.claimExtract:${block.id}`,
    stage: 'spec.claimExtract',
    model,
    fallbackModel,
    system: SYSTEM_PROMPT,
    user: userPrompt,
    responseFormat: 'json',
    timeoutMs,
  });
  const inner = JSON.parse(stripCodeFences(raw));
  return LlmExtractionSchema.parse(inner);
}
