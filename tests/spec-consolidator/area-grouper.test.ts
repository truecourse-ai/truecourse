/**
 * Grouping is the deterministic heart of the corpus path: it canonicalizes the
 * classifier's free-form tags, places a multi-area doc into EVERY area it
 * covers, and lets `decisions.json#manualAreas` override a mis-tag — all without
 * an LLM, so re-running it is free and stable.
 */
import { describe, it, expect } from 'vitest';
import { groupByArea } from '../../packages/spec-consolidator/src/index.js';
import type { DocCandidate, DocAreaTags, ManualArea } from '../../packages/spec-consolidator/src/index.js';

function doc(p: string, lastTouched = '2026-01-01T00:00:00Z'): DocCandidate {
  return {
    path: p,
    absPath: `/abs/${p}`,
    kind: 'prd',
    preview: '',
    lastTouched,
    contentHash: `hash-${p}`,
    size: 100,
  };
}

describe('groupByArea', () => {
  it('clusters synonym tags into one canonical area', () => {
    const docs = [doc('a.md'), doc('b.md')];
    const tags = new Map<string, DocAreaTags>([
      ['a.md', { tags: [{ product: 'core', concern: 'authentication' }] }],
      ['b.md', { tags: [{ product: 'core', concern: 'auth' }] }],
    ]);
    const { areas } = groupByArea(docs, tags);
    expect(areas).toHaveLength(1);
    expect(areas[0].id).toBe('core/auth');
    expect(areas[0].docRefs).toEqual(['a.md', 'b.md']);
  });

  it('places a multi-area doc into every area it covers', () => {
    const docs = [doc('god-prd.md')];
    const tags = new Map<string, DocAreaTags>([
      [
        'god-prd.md',
        {
          tags: [
            { product: 'core', concern: 'users' },
            { product: 'core', concern: 'auth' },
            { product: 'core', concern: 'tenancy' },
          ],
        },
      ],
    ]);
    const { docs: corpusDocs, areas } = groupByArea(docs, tags);
    expect(corpusDocs[0].areaTags).toEqual(['core/auth', 'core/tenancy', 'core/users-entity']);
    expect(areas.map((a) => a.id)).toEqual(['core/auth', 'core/tenancy', 'core/users-entity']);
    for (const a of areas) expect(a.docRefs).toEqual(['god-prd.md']);
  });

  it('keeps two products with the same concern in separate areas', () => {
    const docs = [doc('cap.md'), doc('ccm.md')];
    const tags = new Map<string, DocAreaTags>([
      ['cap.md', { tags: [{ product: 'capacity-app', concern: 'events' }] }],
      ['ccm.md', { tags: [{ product: 'ccm-dashboard', concern: 'events' }] }],
    ]);
    const { areas } = groupByArea(docs, tags);
    expect(areas.map((a) => a.id)).toEqual(['capacity-app/events', 'ccm-dashboard/events']);
  });

  it('carries the doc status onto the corpus doc', () => {
    const docs = [doc('a.md')];
    const tags = new Map<string, DocAreaTags>([
      ['a.md', { tags: [{ product: 'core', concern: 'auth' }], status: 'shipped' }],
    ]);
    const { docs: corpusDocs } = groupByArea(docs, tags);
    expect(corpusDocs[0].status).toBe('shipped');
  });

  it('lets manualAreas override auto-tags entirely', () => {
    const docs = [doc('mistagged.md')];
    const tags = new Map<string, DocAreaTags>([
      ['mistagged.md', { tags: [{ product: 'core', concern: 'billing' }] }],
    ]);
    const manual: ManualArea[] = [{ doc: 'mistagged.md', areas: ['Capacity-App/Events'] }];
    const { docs: corpusDocs, areas } = groupByArea(docs, tags, manual);
    expect(corpusDocs[0].areaTags).toEqual(['capacity-app/events']);
    expect(areas.map((a) => a.id)).toEqual(['capacity-app/events']);
  });

  it('a vocab merge folds minted tags but NEVER renames a pinned area', () => {
    // The strapi 2026-08-20 regression: settle merged
    // `content-manager → admin-panel-configuration`, and the pin was folded
    // through the map too — the user's stated area id must stay literal.
    const docs = [doc('pinned.md'), doc('minted.md')];
    const tags = new Map<string, DocAreaTags>([
      ['pinned.md', { tags: [{ product: 'core', concern: 'content-manager' }] }],
      ['minted.md', { tags: [{ product: 'core', concern: 'content-manager' }] }],
    ]);
    const manual: ManualArea[] = [{ doc: 'pinned.md', areas: ['core/content-manager'] }];
    const vocab = { products: {}, concerns: { 'content-manager': 'admin-panel-configuration' } };
    const { docs: corpusDocs, areas } = groupByArea(docs, tags, manual, vocab);
    expect(corpusDocs.find((d) => d.ref === 'pinned.md')?.areaTags).toEqual(['core/content-manager']);
    expect(corpusDocs.find((d) => d.ref === 'minted.md')?.areaTags).toEqual(['core/admin-panel-configuration']);
    expect(areas.map((a) => a.id)).toEqual(['core/admin-panel-configuration', 'core/content-manager']);
  });

  it('produces a stable, sorted area + docRef ordering', () => {
    const docs = [doc('z.md'), doc('a.md')];
    const tags = new Map<string, DocAreaTags>([
      ['z.md', { tags: [{ product: 'core', concern: 'auth' }] }],
      ['a.md', { tags: [{ product: 'core', concern: 'auth' }] }],
    ]);
    const { areas } = groupByArea(docs, tags);
    expect(areas[0].docRefs).toEqual(['a.md', 'z.md']);
  });

  it('handles a doc with no tags (still in the corpus, ungrouped)', () => {
    const docs = [doc('orphan.md')];
    const tags = new Map<string, DocAreaTags>([['orphan.md', { tags: [] }]]);
    const { docs: corpusDocs, areas } = groupByArea(docs, tags);
    expect(corpusDocs[0].areaTags).toEqual([]);
    expect(areas).toHaveLength(0);
  });
});
