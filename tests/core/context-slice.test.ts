/**
 * A repository's SLICE of the workspace corpus: what a repository may read,
 * cut down to the sources it links. Pure, so it is pinned here without a store.
 */

import { describe, it, expect } from 'vitest';
import {
  corpusDocSourceId,
  corpusSourceIds,
  sliceCorpus,
} from '@truecourse/core/services/context';
import type { CuratedCorpus } from '@truecourse/spec-consolidator';

const A = (name: string): string => `context/src-a/${name}`;
const B = (name: string): string => `context/src-b/${name}`;

const corpus = (): CuratedCorpus => ({
  version: 3,
  generatedAt: '2026-01-01T00:00:00Z',
  docs: [
    { ref: A('docs/one.md'), kind: 'prd', lastTouched: '', areaTags: ['p/c'], sourceId: 'src-a', sourceKind: 'repository' },
    { ref: A('docs/two.md'), kind: 'prd', lastTouched: '', areaTags: ['p/c'], sourceId: 'src-a', sourceKind: 'repository' },
    { ref: B('site.md'), kind: 'reference', lastTouched: '', areaTags: ['p/c'], sourceId: 'src-b', sourceKind: 'site' },
  ],
  areas: [
    {
      id: 'p/c',
      product: 'p',
      concern: 'c',
      docRefs: [A('docs/one.md'), A('docs/two.md'), B('site.md')],
      overlaps: [
        { docs: [A('docs/one.md'), A('docs/two.md')], note: 'in-slice', sections: [], areas: ['p/c'] },
        { docs: [A('docs/one.md'), B('site.md')], note: 'crosses out', sections: [], areas: ['p/c'] },
      ],
      notReached: [B('site.md')],
      uncheckedPairs: [
        { a: { doc: A('docs/one.md'), heading: null }, b: { doc: B('site.md'), heading: null }, keys: [] },
      ],
    },
    { id: 'only/b', product: 'only', concern: 'b', docRefs: [B('site.md')], overlaps: [] },
  ],
  skippedDocs: [
    { ref: A('docs/skipped.md'), reason: 'changelog' },
    { ref: B('dropped.md'), reason: 'changelog' },
  ],
});

describe('sliceCorpus', () => {
  it('keeps only the documents of the sources the repository reads', () => {
    const slice = sliceCorpus(corpus(), ['src-a'])!;
    expect(slice.docs.map((d) => d.ref)).toEqual([A('docs/one.md'), A('docs/two.md')]);
    expect(slice.skippedDocs.map((d) => d.ref)).toEqual([A('docs/skipped.md')]);
  });

  it('drops an area that has no document left, and restricts the rest', () => {
    const slice = sliceCorpus(corpus(), ['src-a'])!;
    expect(slice.areas.map((a) => a.id)).toEqual(['p/c']);
    expect(slice.areas[0].docRefs).toEqual([A('docs/one.md'), A('docs/two.md')]);
  });

  it('keeps only a disagreement whose BOTH documents the repository reads', () => {
    const slice = sliceCorpus(corpus(), ['src-a'])!;
    expect(slice.areas[0].overlaps.map((o) => o.note)).toEqual(['in-slice']);
    expect(slice.areas[0].notReached).toEqual([]);
    expect(slice.areas[0].uncheckedPairs).toEqual([]);
  });

  it('is null when the repository reads no source that yielded a document', () => {
    expect(sliceCorpus(corpus(), [])).toBeNull();
    expect(sliceCorpus(corpus(), ['src-c'])).toBeNull();
  });

  it('reads a document’s source from the stamp, else from its ref', () => {
    expect(corpusDocSourceId({ ref: A('x.md'), sourceId: 'stamped' })).toBe('stamped');
    expect(corpusDocSourceId({ ref: A('x.md') })).toBe('src-a');
    expect(corpusDocSourceId({ ref: 'docs/x.md' })).toBeNull();
    expect(corpusSourceIds(corpus())).toEqual(['src-a', 'src-b']);
  });
});
