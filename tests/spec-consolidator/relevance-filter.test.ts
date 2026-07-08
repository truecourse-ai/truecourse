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
import {
  filterByRelevance,
  buildRelevanceUserPrompt,
  RELEVANCE_SYSTEM_PROMPT,
} from '../../packages/spec-consolidator/src/index.js';
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

/**
 * The classifier must SEE the doc's path (fixture/sample-tree specs describe a
 * fictional product and are not this repo's spec — the path is the signal the
 * content lacks). The path rides the user prompt; the system prompt teaches the
 * model to weigh it as evidence, not a blanket verdict.
 */
describe('filterByRelevance — path-aware relevance', () => {
  const fixturePath =
    'tests/fixtures/sample-js-project-il/reference/specs/modules/orders/data.md';

  it('puts the doc repo-relative path in the assembled user prompt', () => {
    const prompt = buildRelevanceUserPrompt(doc(fixturePath));
    expect(prompt).toContain(fixturePath);
    expect(prompt).toMatch(/PATH/); // clearly labeled field
  });

  it('system prompt instructs dropping fixture/sample-tree test-data specs, path as evidence', () => {
    expect(RELEVANCE_SYSTEM_PROMPT).toMatch(/fixture/i);
    expect(RELEVANCE_SYSTEM_PROMPT).toMatch(/test.?data/i);
    expect(RELEVANCE_SYSTEM_PROMPT).toMatch(/evidence/i); // not an automatic verdict
  });

  it('drops a fixture-tree spec via a path-based verdict', async () => {
    // Stands in for the LLM: uses the PATH the same way the model is told to —
    // a fixture-tree spec describing a sample product is not this repo's spec.
    const runner: RelevanceRunner = async ({ doc }) => {
      const isFixtureTree = /(^|\/)(tests|fixtures|__fixtures__|examples)\//.test(doc.path);
      return isFixtureTree
        ? { path: doc.path, include: false, reason: `test-data spec for a sample product (${doc.path})` }
        : { path: doc.path, include: true, reason: 'describes this repository' };
    };
    const out = await filterByRelevance(repo, [doc('docs/orders-api.md'), doc(fixturePath)], {
      runner,
    });
    expect(out.included.map((d) => d.path)).toEqual(['docs/orders-api.md']);
    expect(out.skipped.map((s) => s.doc.path)).toEqual([fixturePath]);
    expect(out.skipped[0].reason).toMatch(/test-data|sample product/i);
  });
});
