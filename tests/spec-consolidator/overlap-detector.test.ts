/**
 * Overlap flagging examines unresolved within-area doc pairs and surfaces the
 * disagreements for the user. Pairs already covered by a relation (global or
 * area-scoped) are skipped; the per-area pair count is capped (reported, never
 * silently dropped); and verdicts cache per pair.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resetKvCacheStore } from '@truecourse/llm';
import { flagOverlaps } from '../../packages/spec-consolidator/src/index.js';
import type { Area, DocCandidate, OverlapRunner, Relation } from '../../packages/spec-consolidator/src/index.js';

function doc(p: string): DocCandidate {
  return {
    path: p,
    absPath: `/abs/${p}`,
    content: `body of ${p}`,
    kind: 'prd',
    preview: `body of ${p}`,
    lastTouched: '2026-01-01T00:00:00Z',
    contentHash: `hash-${p}`,
    size: 100,
  };
}

function area(id: string, refs: string[]): Area {
  const slash = id.indexOf('/');
  return {
    id,
    product: id.slice(0, slash),
    concern: id.slice(slash + 1),
    docRefs: refs,
    overlaps: [],
  };
}

const flagAll: OverlapRunner = async ({ a, b }) => ({ overlap: true, note: `${a.path} vs ${b.path}` });

let repo: string;
beforeEach(() => {
  resetKvCacheStore();
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-overlap-'));
});
afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

describe('flagOverlaps', () => {
  it('flags a disagreeing pair', async () => {
    const docs = [doc('a.md'), doc('b.md')];
    const out = await flagOverlaps(repo, [area('core/auth', ['a.md', 'b.md'])], docs, { runner: flagAll });
    expect(out.get('core/auth')).toEqual([{ docs: ['a.md', 'b.md'], note: 'a.md vs b.md', sections: [] }]);
  });

  it('carries the conflicting sections the runner reports', async () => {
    const docs = [doc('a.md'), doc('b.md')];
    const runner: OverlapRunner = async ({ a, b }) => ({
      overlap: true,
      note: 'window differs',
      sections: [
        { doc: a.path, heading: 'Cancellation' },
        { doc: b.path, heading: 'Refunds' },
      ],
    });
    const out = await flagOverlaps(repo, [area('core/auth', ['a.md', 'b.md'])], docs, { runner });
    expect(out.get('core/auth')?.[0].sections).toEqual([
      { doc: 'a.md', heading: 'Cancellation' },
      { doc: 'b.md', heading: 'Refunds' },
    ]);
  });

  it('does not flag complementary docs', async () => {
    const docs = [doc('a.md'), doc('b.md')];
    const runner: OverlapRunner = async () => ({ overlap: false, note: '' });
    const out = await flagOverlaps(repo, [area('core/auth', ['a.md', 'b.md'])], docs, { runner });
    expect(out.size).toBe(0);
  });

  it('skips a pair a global relation already resolves', async () => {
    let calls = 0;
    const runner: OverlapRunner = async (i) => {
      calls++;
      return flagAll(i);
    };
    const relations: Relation[] = [{ type: 'replace', older: 'a.md', newer: 'b.md', detectedFrom: 'filename' }];
    const out = await flagOverlaps(repo, [area('core/auth', ['a.md', 'b.md'])], [doc('a.md'), doc('b.md')], {
      runner,
      relations,
    });
    expect(calls).toBe(0);
    expect(out.size).toBe(0);
  });

  it('honors relation scope — a scoped relation only resolves its own area', async () => {
    const relations: Relation[] = [
      { type: 'precedence', older: 'a.md', newer: 'b.md', scope: 'core/auth' },
    ];
    const areas = [area('core/auth', ['a.md', 'b.md']), area('core/users-entity', ['a.md', 'b.md'])];
    const out = await flagOverlaps(repo, areas, [doc('a.md'), doc('b.md')], { runner: flagAll, relations });
    expect(out.has('core/auth')).toBe(false); // resolved here
    expect(out.has('core/users-entity')).toBe(true); // still flagged elsewhere
  });

  it('dedups the same disagreement flagged across shared areas', async () => {
    // One doc pair co-occurs in two areas and the runner flags it in both with
    // identical sections — one real disagreement. It collapses to the
    // lexicographically-first area so the user sees a single conflict.
    const docs = [doc('a.md'), doc('b.md')];
    const areas = [area('booking/appointments', ['a.md', 'b.md']), area('booking/auth', ['a.md', 'b.md'])];
    const runner: OverlapRunner = async ({ a, b }) => ({
      overlap: true,
      note: 'cancellation window differs',
      sections: [
        { doc: a.path, heading: 'Core domain' },
        { doc: b.path, heading: 'Key flows' },
      ],
    });
    const out = await flagOverlaps(repo, areas, docs, { runner });
    expect(out.has('booking/appointments')).toBe(true); // first area keeps it
    expect(out.has('booking/auth')).toBe(false); // duplicate dropped
    expect(out.get('booking/appointments')).toHaveLength(1);
  });

  it('keeps distinct conflicts between the same pair (different sections)', async () => {
    // The same pair disagrees on DIFFERENT sections in each area — two genuinely
    // different disagreements, so neither is deduped away.
    const docs = [doc('a.md'), doc('b.md')];
    const areas = [area('svc/x', ['a.md', 'b.md']), area('svc/y', ['a.md', 'b.md'])];
    const runner: OverlapRunner = async ({ areaId, a }) => ({
      overlap: true,
      note: `differs in ${areaId}`,
      sections: [{ doc: a.path, heading: areaId === 'svc/x' ? 'Auth' : 'Billing' }],
    });
    const out = await flagOverlaps(repo, areas, docs, { runner });
    expect(out.has('svc/x')).toBe(true);
    expect(out.has('svc/y')).toBe(true);
  });

  it('caps pairs per area and reports the cap', async () => {
    const docs = [doc('a.md'), doc('b.md'), doc('c.md')]; // 3 pairs
    const capped: Array<[string, number, number]> = [];
    let calls = 0;
    const runner: OverlapRunner = async (i) => {
      calls++;
      return flagAll(i);
    };
    await flagOverlaps(repo, [area('core/auth', ['a.md', 'b.md', 'c.md'])], docs, {
      runner,
      maxPairsPerArea: 2,
      onCapped: (areaId, examined, total) => capped.push([areaId, examined, total]),
    });
    expect(capped).toEqual([['core/auth', 2, 3]]);
    expect(calls).toBe(2);
  });

  it('caches verdicts per pair', async () => {
    let calls = 0;
    const runner: OverlapRunner = async (i) => {
      calls++;
      return flagAll(i);
    };
    const docs = [doc('a.md'), doc('b.md')];
    const areas = [area('core/auth', ['a.md', 'b.md'])];
    await flagOverlaps(repo, areas, docs, { runner });
    await flagOverlaps(repo, areas, docs, { runner });
    expect(calls).toBe(1);
  });

  it('does nothing when disabled', async () => {
    let calls = 0;
    const runner: OverlapRunner = async (i) => {
      calls++;
      return flagAll(i);
    };
    const out = await flagOverlaps(repo, [area('core/auth', ['a.md', 'b.md'])], [doc('a.md'), doc('b.md')], {
      runner,
      enabled: false,
    });
    expect(out.size).toBe(0);
    expect(calls).toBe(0);
  });

  it('ignores single-doc areas (no pairs)', async () => {
    const out = await flagOverlaps(repo, [area('core/auth', ['a.md'])], [doc('a.md')], { runner: flagAll });
    expect(out.size).toBe(0);
  });
});
