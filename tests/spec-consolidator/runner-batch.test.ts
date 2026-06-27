import { describe, it, expect, afterEach } from 'vitest';
import {
  spawnRunner,
  defaultBatchSize,
  type Block,
  type BlockRunResult,
} from '../../packages/spec-consolidator/src/index.js';
import type { LlmTransport } from '@truecourse/shared/llm';

/**
 * Batch-mode runner tests. These stub the TRANSPORT (not the runner) so they
 * exercise the real batching/parse/fallback logic in spawnRunner:
 *
 *   - N blocks → one transport call per batch
 *   - blocks missing from a (successful) batch response recover on the
 *     single-block path — batching never lowers the success rate
 *   - a transport-level failure errors the whole batch WITHOUT a per-block
 *     retry storm (one wasted call, not N)
 *   - batchSize:1 keeps the original one-call-per-block path
 */

function mkBlock(id: string, text = 'body'): Block {
  return { id, filePath: 'd.md', headingPath: ['H'], startLine: 1, endLine: 2, text };
}

type BatchReply = unknown | 'throw' | 'garbage';

function makeTransport(opts: {
  onBatch: (ids: string[]) => BatchReply;
  onSingle?: () => unknown;
}): {
  transport: LlmTransport;
  calls: Array<{ kind: 'batch' | 'single'; ids?: string[]; itemCount?: number }>;
} {
  const calls: Array<{ kind: 'batch' | 'single'; ids?: string[]; itemCount?: number }> = [];
  const transport: LlmTransport = async (req) => {
    if (req.system.includes('BATCH MODE')) {
      const ids = [...req.user.matchAll(/^=== BLOCK (\S+) ===$/gm)].map((m) => m[1]);
      calls.push({ kind: 'batch', ids, itemCount: req.itemCount });
      const r = opts.onBatch(ids);
      if (r === 'throw') throw new Error('boom');
      if (r === 'garbage') return 'not json {';
      return JSON.stringify(r);
    }
    calls.push({ kind: 'single', itemCount: req.itemCount });
    return JSON.stringify(opts.onSingle ? opts.onSingle() : { topics: [], claims: [] });
  };
  return { transport, calls };
}

const okBatch = (ids: string[]) => ids.map((id) => ({ blockId: id, topics: ['overview'], claims: [] }));

afterEach(() => {
  delete process.env.TRUECOURSE_EXTRACT_BATCH;
});

describe('spawnRunner — batching', () => {
  it('batches blocks: one call per batch, every block extracted', async () => {
    const { transport, calls } = makeTransport({ onBatch: okBatch });
    const onResults: BlockRunResult[] = [];
    let done = 0;
    const runner = spawnRunner({ transport, batchSize: 3, onBlockDone: () => (done += 1) });
    const blocks = [1, 2, 3, 4, 5].map((n) => mkBlock(`b${n}`));

    const results = await runner(blocks, (r) => {
      onResults.push(r);
    });

    expect(results).toHaveLength(5);
    expect(results.every((r) => r.extraction)).toBe(true);
    expect(calls.filter((c) => c.kind === 'batch')).toHaveLength(2); // 3 + 2
    expect(calls.filter((c) => c.kind === 'single')).toHaveLength(0);
    expect(onResults).toHaveLength(5); // incremental persistence hook per block
    expect(done).toBe(5); // progress ticks per block, not per batch
  });

  it('recovers blocks missing from a successful batch via the single-block path', async () => {
    const { transport, calls } = makeTransport({
      onBatch: (ids) => ids.filter((id) => id !== 'b2').map((id) => ({ blockId: id, topics: [], claims: [] })),
      onSingle: () => ({ topics: ['overview'], claims: [] }),
    });
    const runner = spawnRunner({ transport, batchSize: 10 });

    const results = await runner([mkBlock('b1'), mkBlock('b2'), mkBlock('b3')]);

    expect(results.every((r) => r.extraction)).toBe(true);
    const batchCalls = calls.filter((c) => c.kind === 'batch');
    const singleCalls = calls.filter((c) => c.kind === 'single');
    expect(batchCalls).toHaveLength(1);
    expect(singleCalls).toHaveLength(1); // only b2 fell back
    // itemCount accounting: the batch counts all 3 blocks; the recovery call
    // contributes 0 so the recovered block isn't double-counted in the LLM log.
    expect(batchCalls[0].itemCount).toBe(3);
    expect(singleCalls[0].itemCount).toBe(0);
  });

  it('a transport-level batch failure errors all blocks with NO per-block retry storm', async () => {
    const { transport, calls } = makeTransport({ onBatch: () => 'throw' });
    const runner = spawnRunner({ transport, batchSize: 10 });

    const results = await runner([mkBlock('b1'), mkBlock('b2')]);

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.error && !r.extraction)).toBe(true);
    expect(calls.filter((c) => c.kind === 'batch')).toHaveLength(1);
    expect(calls.filter((c) => c.kind === 'single')).toHaveLength(0); // critical: no N extra calls
  });

  it('recovers ALL blocks via single-block when the batch response is unusable', async () => {
    // Unusable batch JSON (but the transport SUCCEEDED) → the API is healthy, so
    // every block must fall back to single-block extraction, not error out.
    const { transport, calls } = makeTransport({
      onBatch: () => 'garbage',
      onSingle: () => ({ topics: ['overview'], claims: [] }),
    });
    const runner = spawnRunner({ transport, batchSize: 10 });

    const results = await runner([mkBlock('b1'), mkBlock('b2')]);

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.extraction)).toBe(true); // recovered, not errored
    expect(calls.filter((c) => c.kind === 'batch')).toHaveLength(1);
    expect(calls.filter((c) => c.kind === 'single')).toHaveLength(2); // one per block
  });

  it('still errors all blocks (no fan-out) when the TRANSPORT itself fails', async () => {
    // A transport-level throw (API down / usage limit) — a per-block retry would
    // hit the same wall, so error all with zero single-block calls.
    const { transport, calls } = makeTransport({
      onBatch: () => 'throw',
      onSingle: () => ({ topics: [], claims: [] }),
    });
    const runner = spawnRunner({ transport, batchSize: 10 });

    const results = await runner([mkBlock('b1'), mkBlock('b2')]);

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.error && !r.extraction)).toBe(true);
    expect(calls.filter((c) => c.kind === 'batch')).toHaveLength(1);
    expect(calls.filter((c) => c.kind === 'single')).toHaveLength(0);
  });

  it('routes a trailing solo block through the single-block path (no batch overhead)', async () => {
    const { transport, calls } = makeTransport({ onBatch: okBatch, onSingle: () => ({ topics: [], claims: [] }) });
    const runner = spawnRunner({ transport, batchSize: 3 });

    // 4 blocks, batchSize 3 → one [b1,b2,b3] batch + one [b4] solo (single path).
    const results = await runner([mkBlock('b1'), mkBlock('b2'), mkBlock('b3'), mkBlock('b4')]);

    expect(results).toHaveLength(4);
    expect(results.every((r) => r.extraction)).toBe(true);
    expect(calls.filter((c) => c.kind === 'batch')).toHaveLength(1);
    expect(calls.filter((c) => c.kind === 'single')).toHaveLength(1);
  });

  it('batchSize:1 keeps the original one-call-per-block path', async () => {
    const { transport, calls } = makeTransport({ onBatch: okBatch, onSingle: () => ({ topics: [], claims: [] }) });
    const runner = spawnRunner({ transport, batchSize: 1 });

    const results = await runner([mkBlock('b1'), mkBlock('b2'), mkBlock('b3')]);

    expect(results).toHaveLength(3);
    expect(results.every((r) => r.extraction)).toBe(true);
    expect(calls.filter((c) => c.kind === 'batch')).toHaveLength(0); // never uses batch mode
    expect(calls.filter((c) => c.kind === 'single')).toHaveLength(3);
  });

  it('defaultBatchSize: 10 by default, env override, invalid → default', () => {
    delete process.env.TRUECOURSE_EXTRACT_BATCH;
    expect(defaultBatchSize()).toBe(10);
    process.env.TRUECOURSE_EXTRACT_BATCH = '5';
    expect(defaultBatchSize()).toBe(5);
    process.env.TRUECOURSE_EXTRACT_BATCH = '0';
    expect(defaultBatchSize()).toBe(10);
    process.env.TRUECOURSE_EXTRACT_BATCH = 'nope';
    expect(defaultBatchSize()).toBe(10);
  });
});
