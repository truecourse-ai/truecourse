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
import { createHash } from 'node:crypto';
import pLimit from 'p-limit';
import { cliTransport, extractJsonValue, type LlmTransport } from '@truecourse/shared/llm';
import type { Block } from './slicer.js';
import {
  BATCH_SYSTEM_ADDENDUM,
  LlmBatchEntrySchema,
  LlmExtractionSchema,
  SYSTEM_PROMPT,
  buildBatchUserPrompt,
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

export type BlockRunner = (
  blocks: Block[],
  /**
   * Fired as each block settles (success or failure), before the whole batch
   * resolves. Lets the cache layer persist results incrementally so a kill
   * mid-phase doesn't discard completed work. Implementations may ignore it.
   */
  onResult?: (result: BlockRunResult) => void | Promise<void>,
) => Promise<BlockRunResult[]>;

export interface SpawnRunnerOptions {
  /**
   * LLM transport. Defaults to `cliTransport()` (spawns `claude -p`). The
   * CLI/dashboard pass `agentTransport(io)` for headless/routine runs.
   */
  transport?: LlmTransport;
  /** Path to the claude binary (cli transport only). Defaults to `resolveClaudeBinary()`. */
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
  /**
   * Blocks per LLM call. Defaults to {@link defaultBatchSize} (env
   * `TRUECOURSE_EXTRACT_BATCH`, else 10). `1` = one call per block (the
   * original behavior). Batching amortizes the fixed per-call agent overhead.
   */
  batchSize?: number;
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

export function defaultBatchSize(): number {
  const env = process.env.TRUECOURSE_EXTRACT_BATCH;
  if (env) {
    const parsed = parseInt(env, 10);
    if (Number.isFinite(parsed) && parsed >= 1) return parsed;
  }
  return 10;
}

/**
 * Build a runner that calls the transport once per block. Each request is
 * independent — failures don't abort the batch.
 */
export function spawnRunner(opts: SpawnRunnerOptions = {}): BlockRunner {
  const transport = opts.transport ?? cliTransport({ bin: opts.bin });
  const concurrency = opts.concurrency ?? defaultConcurrency();
  const timeoutMs = opts.timeoutMs ?? 240_000;
  const batchSize = Math.max(1, opts.batchSize ?? defaultBatchSize());
  const limit = pLimit(concurrency);

  return async (blocks: Block[], onResult): Promise<BlockRunResult[]> => {
    const batches: Block[][] = [];
    for (let i = 0; i < blocks.length; i += batchSize) {
      batches.push(blocks.slice(i, i + batchSize));
    }
    // Fired the moment a block settles (success or error) — drives progress
    // and incremental cache persistence, so a kill mid-phase keeps finished work.
    const settle = async (r: BlockRunResult): Promise<void> => {
      opts.onBlockDone?.(r.block, Boolean(r.extraction));
      await onResult?.(r);
    };
    // Concurrency is over BATCHES — each batch is one transport call.
    const nested = await Promise.all(
      batches.map((batch) =>
        limit(async () => {
          for (const b of batch) opts.onBlockStart?.(b);
          // A lone block (batchSize 1, or a trailing/solo miss) skips batch
          // packaging entirely — no overhead, no truncation risk, no array wrap.
          if (batchSize === 1 || batch.length === 1) {
            const r = await runSingle(transport, batch[0], timeoutMs, opts.model, opts.fallbackModel);
            await settle(r);
            return [r];
          }
          return runBatch(transport, batch, timeoutMs, opts.model, opts.fallbackModel, settle);
        }),
      ),
    );
    return nested.flat();
  };
}

/**
 * Extract a single block, never throwing — failures become an error result.
 *
 * `itemCount` is the work-item weight stamped on the call's usage record (for
 * the LLM log). It defaults to 1, but the batch-recovery path passes 0: those
 * blocks were already counted by the batch call that failed to return them, so
 * counting them again here would double the per-item denominator.
 */
async function runSingle(
  transport: LlmTransport,
  block: Block,
  timeoutMs: number,
  model?: string,
  fallbackModel?: string,
  itemCount = 1,
): Promise<BlockRunResult> {
  const t0 = Date.now();
  try {
    const extraction = await runOne(transport, block, timeoutMs, model, fallbackModel, itemCount);
    return { block, extraction, durationMs: Date.now() - t0 };
  } catch (e) {
    return { block, error: e instanceof Error ? e.message : String(e), durationMs: Date.now() - t0 };
  }
}

/**
 * Extract N (>1) blocks in one call. `settle` fires per block as it resolves,
 * so persistence/progress happen at block granularity.
 *
 * Failure handling, designed to never fan out into an N-call storm under a
 * degraded API:
 *   - TRANSPORT-level failure (usage limit / timeout / non-zero exit — the
 *     transport throws) → ALL blocks error, zero retries (a singleton retry
 *     would hit the same wall — the API itself is degraded).
 *   - transport SUCCEEDS but the response is unusable (garbled/truncated batch
 *     JSON — common on weaker models) → the API is healthy, so recover EVERY
 *     block on the single-block path, where JSON output is far more reliable.
 *     This is bounded by the batch size (≤ N single calls), not a storm: a
 *     storm only arises from a degraded API, which is the throw case above.
 *   - response is usable but a FEW blocks are missing/invalid → recover only
 *     those on the single-block path.
 *
 * In all non-throw cases, blocks the batch didn't yield are routed through
 * single-block extraction — so messy batch output never silently drops a block
 * (the bug where unusable batches errored N blocks that then re-ran forever).
 */
async function runBatch(
  transport: LlmTransport,
  blocks: Block[],
  timeoutMs: number,
  model: string | undefined,
  fallbackModel: string | undefined,
  settle: (r: BlockRunResult) => Promise<void>,
): Promise<BlockRunResult[]> {
  const t0 = Date.now();
  // Content-addressed id over the exact block set, so a resumed run (agent
  // transport) only reuses a cached response when the same blocks are re-batched.
  const batchId = createHash('sha256')
    .update(blocks.map((b) => b.id).sort().join(','))
    .digest('hex')
    .slice(0, 16);

  let parsed: Map<string, LlmExtraction> = new Map();
  let transportThrew = false;
  let failure: string | null = null;
  try {
    const raw = await transport({
      id: `spec.claimExtract:batch:${batchId}`,
      stage: 'spec.claimExtract',
      model,
      fallbackModel,
      system: SYSTEM_PROMPT + BATCH_SYSTEM_ADDENDUM,
      user: buildBatchUserPrompt(blocks),
      responseFormat: 'json',
      timeoutMs,
      itemCount: blocks.length,
    });
    // May be empty (unusable JSON) — that's fine: missing blocks fall through to
    // single-block recovery below, because the API itself is clearly healthy.
    parsed = parseBatch(raw, blocks);
  } catch (e) {
    // The transport itself failed (API down / usage limit / timeout). A
    // per-block retry would hit the same wall — error all, no fan-out.
    transportThrew = true;
    failure = e instanceof Error ? e.message : String(e);
  }

  if (transportThrew) {
    const durationMs = Date.now() - t0;
    const errored = blocks.map((block) => ({ block, error: failure ?? 'batch failed', durationMs }));
    for (const r of errored) await settle(r);
    return errored;
  }

  const out: BlockRunResult[] = [];
  const missing: Block[] = [];
  for (const block of blocks) {
    const extraction = parsed.get(block.id);
    if (extraction) {
      const r: BlockRunResult = { block, extraction, durationMs: Date.now() - t0 };
      await settle(r);
      out.push(r);
    } else {
      missing.push(block);
    }
  }
  // Recover every block the batch didn't yield (a few partial misses, or ALL of
  // them when the batch JSON was unusable) on the single-block path. itemCount 0:
  // the batch call already counted these toward the work-item weight.
  for (const block of missing) {
    const r = await runSingle(transport, block, timeoutMs, model, fallbackModel, 0);
    await settle(r);
    out.push(r);
  }
  return out;
}

/** Parse a batch response into blockId → extraction, keeping only valid, in-batch ids. */
function parseBatch(raw: string, blocks: Block[]): Map<string, LlmExtraction> {
  const ids = new Set(blocks.map((b) => b.id));
  const map = new Map<string, LlmExtraction>();
  let data: unknown;
  try {
    data = JSON.parse(extractJsonValue(raw));
  } catch {
    return map; // unparseable → every block falls back to single mode
  }
  const arr: unknown[] = Array.isArray(data)
    ? data
    : Array.isArray((data as { blocks?: unknown[] })?.blocks)
      ? (data as { blocks: unknown[] }).blocks
      : Array.isArray((data as { results?: unknown[] })?.results)
        ? (data as { results: unknown[] }).results
        : [];
  for (const el of arr) {
    const entry = LlmBatchEntrySchema.safeParse(el);
    if (!entry.success) continue;
    const { blockId, topics, claims } = entry.data;
    if (!ids.has(blockId) || map.has(blockId)) continue;
    map.set(blockId, { topics, claims });
  }
  return map;
}

async function runOne(
  transport: LlmTransport,
  block: Block,
  timeoutMs: number,
  model?: string,
  fallbackModel?: string,
  itemCount = 1,
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
    itemCount,
  });
  const inner = JSON.parse(extractJsonValue(raw));
  return LlmExtractionSchema.parse(inner);
}
