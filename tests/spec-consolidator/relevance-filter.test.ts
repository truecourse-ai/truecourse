/**
 * The relevance filter's `onProgress` callback drives the numbered
 * "Discovering docs · N/total" progress shown during a spec scan. It fires
 * an initial `(0, total)` so the UI learns the total upfront, then once per
 * doc as each classification resolves (concurrent, so by completion order).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { filterByRelevance } from '../../packages/spec-consolidator/src/index.js';
import type { RelevanceRunner, DocCandidate } from '../../packages/spec-consolidator/src/index.js';

function doc(p: string): DocCandidate {
  return {
    path: p,
    absPath: `/abs/${p}`,
    kind: 'prd',
    preview: 'preview',
    lastTouched: '2026-01-01T00:00:00Z',
    contentHash: `hash-${p}`,
    size: 100,
  };
}

let repo: string;
beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-relevance-'));
});
afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

const includeAll: RelevanceRunner = async ({ doc }) => ({
  path: doc.path,
  include: true,
  reason: 'ok',
});

describe('filterByRelevance — onProgress', () => {
  it('reports an initial 0/total and ticks up to total/total', async () => {
    const docs = [doc('a.md'), doc('b.md'), doc('c.md')];
    const calls: Array<[number, number]> = [];

    const out = await filterByRelevance(repo, docs, {
      runner: includeAll,
      onProgress: (done, total) => calls.push([done, total]),
    });

    expect(out.included).toHaveLength(3);
    expect(calls[0]).toEqual([0, 3]); // initial, total known upfront
    expect(calls).toHaveLength(4); // initial + one per doc
    expect(calls[calls.length - 1]).toEqual([3, 3]);
    // done is monotonic non-decreasing; total is constant.
    for (let i = 1; i < calls.length; i++) {
      expect(calls[i][0]).toBeGreaterThanOrEqual(calls[i - 1][0]);
      expect(calls[i][1]).toBe(3);
    }
  });

  it('counts manual includes too (which skip the runner)', async () => {
    let runnerCalls = 0;
    const runner: RelevanceRunner = async ({ doc }) => {
      runnerCalls++;
      return { path: doc.path, include: true, reason: 'ok' };
    };
    const calls: Array<[number, number]> = [];

    await filterByRelevance(repo, [doc('keep.md')], {
      runner,
      manualIncludes: ['keep.md'],
      onProgress: (done, total) => calls.push([done, total]),
    });

    expect(runnerCalls).toBe(0); // manual include bypasses classification
    expect(calls[calls.length - 1]).toEqual([1, 1]); // still counted
  });

  it('does not fire onProgress when the filter is disabled', async () => {
    const calls: Array<[number, number]> = [];
    await filterByRelevance(repo, [doc('a.md')], {
      enabled: false,
      onProgress: (done, total) => calls.push([done, total]),
    });
    expect(calls).toHaveLength(0);
  });
});
