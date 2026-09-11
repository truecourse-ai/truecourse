/**
 * A repository's SLICE of the workspace corpus, and the fold that re-subjects a
 * repository's old decisions under the context ref grammar. Both are pure, so
 * both are pinned here without a store: what a repository may read, and what
 * happens to a standing choice whose document moved.
 */

import { describe, it, expect } from 'vitest';
import {
  corpusDocSourceId,
  corpusSourceIds,
  foldRepoDecisions,
  mapDecisionDocRef,
  mapDecisionScopePath,
  sliceCorpus,
} from '@truecourse/core/services/context';
import type { CuratedCorpus, DecisionsFile } from '@truecourse/spec-consolidator';

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

// ---------------------------------------------------------------------------
// The decisions fold — a repository's standing choices, re-subjected.
// ---------------------------------------------------------------------------

const INPUT = {
  repositorySourceId: 'repo-src',
  siteSourceIds: new Map([['old-site', 'new-site']]),
  repoFullName: 'acme/widgets',
};

const decisions = (over: Partial<DecisionsFile> = {}): DecisionsFile => ({
  version: 2,
  manualIncludes: [],
  manualExcludes: [],
  manualAreas: [],
  conflictResolutions: [],
  scopeVerdicts: [],
  instructions: [],
  ...over,
});

describe('mapping a decision’s subject', () => {
  it('re-homes a repository doc under its Repository source', () => {
    expect(mapDecisionDocRef('docs/x.md', INPUT)).toBe('context/repo-src/docs/x.md');
  });

  it('re-homes an old registry page under the site source it became', () => {
    expect(mapDecisionDocRef('.truecourse/specs/sources/old-site/cms/a.md', INPUT)).toBe(
      'context/new-site/cms/a.md',
    );
  });

  it('maps nothing for a page whose source did not come across', () => {
    expect(mapDecisionDocRef('.truecourse/specs/sources/gone/a.md', INPUT)).toBeNull();
  });

  it('turns `.` into the repository’s whole source, and a directory into a subtree', () => {
    expect(mapDecisionScopePath('.', INPUT)).toBe('context/repo-src');
    expect(mapDecisionScopePath('docs/archive/', INPUT)).toBe('context/repo-src/docs/archive');
  });

  it('turns an old source id into the new one', () => {
    expect(mapDecisionScopePath('old-site', INPUT)).toBe('new-site');
    expect(mapDecisionScopePath('.truecourse/specs/sources/old-site', INPUT)).toBe('new-site');
    expect(mapDecisionScopePath('.truecourse/specs/sources/gone', INPUT)).toBeNull();
  });
});

describe('foldRepoDecisions', () => {
  it('folds every kind of row onto the new grammar', () => {
    const result = foldRepoDecisions(
      null,
      decisions({
        manualIncludes: ['docs/keep.md'],
        manualExcludes: ['docs/drop.md'],
        manualAreas: [{ doc: 'docs/keep.md', areas: ['p/c'] }],
        instructions: ['treat docs/en as canonical'],
        scopeVerdicts: [
          { path: 'docs', verdict: 'keep', reason: 'specs', decidedAt: '2026-01-01T00:00:00Z' },
        ],
        conflictResolutions: [
          {
            docA: 'docs/keep.md',
            anchorA: 'A',
            docB: 'docs/drop.md',
            anchorB: 'B',
            verdict: 'a',
            resolvedAt: '2026-01-01T00:00:00Z',
          },
        ],
      }),
      INPUT,
    );

    expect(result.changed).toBe(true);
    expect(result.decisions.manualIncludes).toEqual(['context/repo-src/docs/keep.md']);
    expect(result.decisions.manualExcludes).toEqual(['context/repo-src/docs/drop.md']);
    expect(result.decisions.manualAreas[0].doc).toBe('context/repo-src/docs/keep.md');
    expect(result.decisions.scopeVerdicts[0].path).toBe('context/repo-src/docs');
    expect(result.decisions.conflictResolutions[0]).toMatchObject({
      docA: 'context/repo-src/docs/keep.md',
      docB: 'context/repo-src/docs/drop.md',
    });
    expect(result.decisions.instructions).toEqual(['treat docs/en as canonical']);
    expect(result.dropped).toEqual([]);
  });

  it('drops a row whose subject maps to nothing, and says which', () => {
    const result = foldRepoDecisions(
      null,
      decisions({ manualIncludes: ['.truecourse/specs/sources/gone/a.md'] }),
      INPUT,
    );
    expect(result.decisions.manualIncludes).toEqual([]);
    expect(result.dropped).toEqual([
      {
        kind: 'include',
        subject: '.truecourse/specs/sources/gone/a.md',
        reason: 'no such document under the new grammar',
      },
    ]);
  });

  it('lets a user row replace an auto row for the same subject, never the reverse', () => {
    const auto = foldRepoDecisions(
      null,
      decisions({
        scopeVerdicts: [
          { path: 'docs', verdict: 'exclude', reason: 'guessed', decidedAt: '2026-01-01T00:00:00Z', resolvedBy: 'auto' },
        ],
      }),
      INPUT,
    );
    const user = foldRepoDecisions(
      auto.decisions,
      decisions({
        scopeVerdicts: [
          { path: 'docs', verdict: 'keep', reason: 'a human looked', decidedAt: '2026-02-01T00:00:00Z', resolvedBy: 'user' },
        ],
      }),
      INPUT,
    );
    expect(user.decisions.scopeVerdicts).toHaveLength(1);
    expect(user.decisions.scopeVerdicts[0]).toMatchObject({ verdict: 'keep', resolvedBy: 'user' });

    // The auto row does not win it back.
    const again = foldRepoDecisions(
      user.decisions,
      decisions({
        scopeVerdicts: [
          { path: 'docs', verdict: 'exclude', reason: 'guessed again', decidedAt: '2026-03-01T00:00:00Z', resolvedBy: 'auto' },
        ],
      }),
      INPUT,
    );
    expect(again.decisions.scopeVerdicts[0]).toMatchObject({ verdict: 'keep' });
  });

  it('keeps the NEWER resolution when two repositories disagree on one conflict', () => {
    const dispute = (verdict: 'a' | 'b', resolvedAt: string) =>
      decisions({
        conflictResolutions: [
          { docA: 'docs/x.md', anchorA: 'H', docB: 'docs/y.md', anchorB: 'H', verdict, resolvedAt },
        ],
      });
    const first = foldRepoDecisions(null, dispute('a', '2026-01-01T00:00:00Z'), INPUT);
    const second = foldRepoDecisions(first.decisions, dispute('b', '2026-06-01T00:00:00Z'), {
      ...INPUT,
      repoFullName: 'acme/other',
    });

    expect(second.decisions.conflictResolutions).toHaveLength(1);
    expect(second.decisions.conflictResolutions[0].verdict).toBe('b');
    expect(second.settled).toEqual([
      { subject: 'context/repo-src/docs/x.md / context/repo-src/docs/y.md', kept: 'b', dropped: 'a' },
    ]);
  });

  it('is idempotent — folding the same rows twice writes the same document', () => {
    const stored = decisions({
      manualIncludes: ['docs/keep.md'],
      instructions: ['one'],
      scopeVerdicts: [
        { path: 'docs', verdict: 'keep', reason: 'specs', decidedAt: '2026-01-01T00:00:00Z' },
      ],
    });
    const once = foldRepoDecisions(null, stored, INPUT);
    const twice = foldRepoDecisions(once.decisions, stored, INPUT);
    expect(twice.decisions).toEqual(once.decisions);
    expect(twice.changed).toBe(false);
  });
});
