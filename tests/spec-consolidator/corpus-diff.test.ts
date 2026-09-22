/**
 * The diff between two versions of a workspace corpus: documents by ref,
 * areas by id, a document's re-tagging by the areas that list it, and the
 * overlap flags by document pair.
 */
import { describe, it, expect } from 'vitest';
import { diffCorpora, type CuratedCorpus } from '../../packages/spec-consolidator/src/index';

const doc = (ref: string): CuratedCorpus['docs'][number] => ({
  ref,
  kind: 'prd',
  lastTouched: '',
  areaTags: [],
});

const corpus = (docs: string[], areas: Array<{ id: string; docRefs: string[]; overlaps?: [string, string][] }>): CuratedCorpus => ({
  version: 3,
  generatedAt: '2026-01-01T00:00:00Z',
  docs: docs.map(doc),
  areas: areas.map((a) => ({
    id: a.id,
    product: a.id.split('/')[0]!,
    concern: a.id.split('/')[1]!,
    docRefs: a.docRefs,
    overlaps: (a.overlaps ?? []).map((docs) => ({ docs, note: '', sections: [], areas: [] })),
  })),
  skippedDocs: [],
});

describe('diffCorpora', () => {
  it('reports documents added, removed and re-tagged, areas added and removed, and flags opened and closed', () => {
    const prior = corpus(
      ['d1', 'd2', 'd3'],
      [
        { id: 'p/a', docRefs: ['d1', 'd2'], overlaps: [['d1', 'd2']] },
        { id: 'p/b', docRefs: ['d3'] },
      ],
    );
    const next = corpus(
      ['d1', 'd2', 'd4'],
      [
        { id: 'p/a', docRefs: ['d1'] },
        { id: 'p/c', docRefs: ['d2', 'd4'], overlaps: [['d4', 'd2']] },
      ],
    );
    expect(diffCorpora(prior, next)).toEqual({
      docs: {
        added: ['d4'],
        removed: ['d3'],
        retagged: [{ ref: 'd2', from: ['p/a'], to: ['p/c'] }],
      },
      areas: { added: ['p/c'], removed: ['p/b'] },
      conflicts: { opened: 1, closed: 1 },
    });
  });

  it('counts an overlap pair once whichever way round it is written', () => {
    const prior = corpus(['d1', 'd2'], [{ id: 'p/a', docRefs: ['d1', 'd2'], overlaps: [['d1', 'd2']] }]);
    const next = corpus(['d1', 'd2'], [{ id: 'p/a', docRefs: ['d1', 'd2'], overlaps: [['d2', 'd1']] }]);
    expect(diffCorpora(prior, next).conflicts).toEqual({ opened: 0, closed: 0 });
  });

  it('reads an absent side as empty', () => {
    const next = corpus(['d1'], [{ id: 'p/a', docRefs: ['d1'] }]);
    expect(diffCorpora(null, next)).toEqual({
      docs: { added: ['d1'], removed: [], retagged: [] },
      areas: { added: ['p/a'], removed: [] },
      conflicts: { opened: 0, closed: 0 },
    });
    expect(diffCorpora(next, null).docs.removed).toEqual(['d1']);
  });
});
