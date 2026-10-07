/**
 * The single "is a conflict resolved?" derivation — ONE copy in
 * @truecourse/shared, imported by the guard-generate gate (core), the
 * dashboard server and the dashboard client alike. A conflict is two
 * sentences, identified by their doc and sentence key; it resolves ONLY via a
 * matching verdict (pick-a-side / dismissal) or a covering force-exclude.
 */
import { describe, it, expect } from 'vitest';
import {
  buildCorpusConflicts,
  conflictId,
  conflictKey,
  conflictSides,
  conflictVerdictFor,
  dedupeCrossAreaConflicts,
  dormantResolutionForPair,
  isConflictId,
  normalizeQuote,
  openConflicts,
  orphanedConflictResolutions,
  resolutionConflictKey,
  resolutionForConflict,
  resolveConflictId,
  sameSentence,
  sentenceKey,
  suppressedClaims,
  verdictNamesOneSentence,
  type ConflictResolutionLike,
  type ConflictSideLike,
} from '../../packages/shared/src/spec/conflict-resolution.js';

/** A side: a doc, the heading its sentence sits under, the words, and the key of those words. */
const at = (doc: string, heading: string | null, text: string, repeat = 0): ConflictSideLike => ({
  doc,
  heading,
  quote: text,
  sentence: sentenceKey(text, repeat),
});

const README = 'README.md';
const SPEC = 'docs/SPEC.md';
const rmSides = [at(README, 'taskline', 'rm permanently deletes the task.'), at(SPEC, 'rm <id>', 'rm archives the task, keeping history.')];
const RM = { docs: [README, SPEC] as [string, string], note: 'rm permanent vs archived', sections: rmSides };

/** One area, the conflicts given — the base fixture. */
function corpus(conflicts: Array<{ docs: [string, string]; note?: string; sections: readonly ConflictSideLike[] }>) {
  return {
    areas: [
      { id: 'core/persistence', conflicts },
      { id: 'core/auth', conflicts: [] },
    ],
  };
}

const verdictOn = (
  sections: readonly ConflictSideLike[],
  a: string,
  b: string,
  verdict: 'a' | 'b' | 'dismissed',
): ConflictResolutionLike => ({ ...conflictVerdictFor({ sections }, a, b, verdict), resolvedAt: '2026-07-10T00:00:00Z' });

describe('sentenceKey', () => {
  it('is a short hash of the normalized words, blind to case, spacing and markup', () => {
    expect(sentenceKey('Returns 20 expenses per page.')).toMatch(/^[0-9a-f]{8}$/);
    expect(sentenceKey('Returns **20**  expenses\nper page.')).toBe(sentenceKey('returns 20 expenses per page.'));
    expect(sentenceKey('Returns 25 expenses per page.')).not.toBe(sentenceKey('Returns 20 expenses per page.'));
  });

  it('tells the repeats of one text apart, and the first repeat keys as the text alone', () => {
    expect(sentenceKey('Returns 200.', 0)).toBe(sentenceKey('Returns 200.'));
    expect(sentenceKey('Returns 200.', 1)).not.toBe(sentenceKey('Returns 200.'));
    expect(sentenceKey('Returns 200.', 1)).not.toBe(sentenceKey('Returns 200.', 2));
  });

  it('normalizeQuote folds markdown markers + whitespace', () => {
    expect(normalizeQuote('  `rm`  Deletes\nthe  task. ')).toBe('rm deletes the task.');
  });
});

describe('buildCorpusConflicts / openConflicts', () => {
  it('a conflict with no verdict and no exclude is OPEN', () => {
    const conflicts = buildCorpusConflicts(corpus([RM]), {});
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ area: 'core/persistence', a: README, b: SPEC, note: RM.note, resolved: false });
    expect(openConflicts(corpus([RM]), {})).toHaveLength(1);
  });

  it('a force-exclude on either side RESOLVES the conflict', () => {
    const decisions = { manualExcludes: [README] };
    const conflicts = buildCorpusConflicts(corpus([RM]), decisions);
    expect(conflicts[0].resolved).toBe(true);
    expect(conflicts[0].excludedRef).toBe(README);
    expect(openConflicts(corpus([RM]), decisions)).toEqual([]);
    expect(openConflicts(corpus([RM]), { manualExcludes: [SPEC] })).toEqual([]);
  });

  it('carries the record itself: note, sides and whatever the corpus adds', () => {
    const withReview = { ...RM, review: { explanation: 'x' } };
    const [row] = buildCorpusConflicts({ areas: [{ id: 'core/persistence', conflicts: [withReview] }] }, {});
    expect(row.sections).toBe(rmSides);
    expect(row.review).toEqual({ explanation: 'x' });
    expect(row.docs).toEqual([README, SPEC]);
  });
});

describe('cross-area dedup', () => {
  // The same two sentences flagged in two shared areas, quoted differently.
  const twoAreas = () => ({
    areas: [
      { id: 'core/persistence', conflicts: [RM] },
      {
        id: 'core/tasks-entity',
        conflicts: [
          {
            docs: [SPEC, README] as [string, string],
            note: 'rm deletes permanently vs archives',
            sections: [{ ...rmSides[1]!, quote: 'rm archives the task' }, { ...rmSides[0]!, heading: null }],
          },
        ],
      },
    ],
  });

  it('collapses the same two sentences flagged in two shared areas to ONE conflict spanning both', () => {
    const conflicts = buildCorpusConflicts(twoAreas(), {});
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ a: README, b: SPEC, resolved: false });
    // Representative = the record with the fewest preamble sides.
    expect(conflicts[0].area).toBe('core/persistence');
    expect(conflicts[0].areas).toEqual(['core/persistence', 'core/tasks-entity']);
  });

  it('returns every member, the representative first', () => {
    const merged = dedupeCrossAreaConflicts([
      { area: 'core/persistence', conflict: RM },
      { area: 'core/tasks-entity', conflict: twoAreas().areas[1]!.conflicts[0]! },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.members).toHaveLength(2);
    expect(merged[0]!.members[0]).toBe(merged[0]!.conflict);
    expect(merged[0]!.conflict).toBe(RM);
  });

  it('a force-exclude of either doc resolves the merged conflict once', () => {
    expect(openConflicts(twoAreas(), { manualExcludes: [README] })).toEqual([]);
    expect(openConflicts(twoAreas(), { manualExcludes: [SPEC] })).toEqual([]);
  });

  it('a VERDICT matched to the merged conflict resolves it everywhere', () => {
    expect(openConflicts(twoAreas(), { conflictResolutions: [verdictOn(rmSides, README, SPEC, 'b')] })).toEqual([]);
  });

  it('keeps TWO records for two conflicts on the same pair', () => {
    const login = [at(README, 'taskline', 'Login needs a token.'), at(SPEC, 'Login', 'Login needs a password.')];
    const two = {
      areas: [
        { id: 'core/persistence', conflicts: [RM] },
        { id: 'core/auth', conflicts: [{ docs: [README, SPEC] as [string, string], note: 'login flow', sections: login }] },
      ],
    };
    expect(buildCorpusConflicts(two, {})).toHaveLength(2);
    const stillOpen = openConflicts(two, { conflictResolutions: [verdictOn(rmSides, README, SPEC, 'b')] });
    expect(stillOpen).toHaveLength(1);
    expect(stillOpen[0].area).toBe('core/auth');
  });
});

describe('conflict resolutions — matching, verdicts, claim suppression', () => {
  const pickReadme = verdictOn(rmSides, README, SPEC, 'a');

  it('a side verdict RESOLVES the conflict and carries the verdict on the conflict', () => {
    const decisions = { conflictResolutions: [pickReadme] };
    const conflicts = buildCorpusConflicts(corpus([RM]), decisions);
    expect(conflicts[0].resolved).toBe(true);
    expect(conflicts[0].resolution?.verdict).toBe('a');
    expect(openConflicts(corpus([RM]), decisions)).toEqual([]);
  });

  it('a dismissal RESOLVES the conflict but suppresses nothing', () => {
    const decisions = { conflictResolutions: [{ ...pickReadme, verdict: 'dismissed' as const }] };
    expect(buildCorpusConflicts(corpus([RM]), decisions)[0].resolution?.verdict).toBe('dismissed');
    expect(openConflicts(corpus([RM]), decisions)).toEqual([]);
    expect(suppressedClaims(corpus([RM]), decisions)).toEqual([]);
  });

  it('suppressedClaims names the LOSER’s quote for a side verdict', () => {
    expect(suppressedClaims(corpus([RM]), { conflictResolutions: [pickReadme] })).toEqual([
      { doc: SPEC, anchor: 'rm <id>', quote: 'rm archives the task, keeping history.', sentence: rmSides[1]!.sentence },
    ]);
    expect(suppressedClaims(corpus([RM]), { conflictResolutions: [{ ...pickReadme, verdict: 'b' }] })).toEqual([
      { doc: README, anchor: 'taskline', quote: 'rm permanently deletes the task.', sentence: rmSides[0]!.sentence },
    ]);
  });

  it('suppresses the words and heading the CURRENT scan carries, not the ones the verdict recorded', () => {
    const rescanned = corpus([{ ...RM, sections: [rmSides[0]!, { ...rmSides[1]!, heading: 'Removing', quote: 'rm archives the task, keeping' }] }]);
    expect(suppressedClaims(rescanned, { conflictResolutions: [pickReadme] })).toEqual([
      { doc: SPEC, anchor: 'Removing', quote: 'rm archives the task, keeping', sentence: rmSides[1]!.sentence },
    ]);
  });

  it('matches by SENTENCE whatever the quotes and headings say', () => {
    const drifted: ConflictResolutionLike = { ...pickReadme, anchorA: 'Taskline (v2)', quoteA: 'other words', anchorB: null, quoteB: undefined };
    const decisions = { conflictResolutions: [drifted] };
    expect(openConflicts(corpus([RM]), decisions)).toEqual([]);
    expect(buildCorpusConflicts(corpus([RM]), decisions)[0].resolution?.verdict).toBe('a');
  });

  it('does NOT match a reworded sentence: a new key is a new conflict, and the verdict is orphaned', () => {
    const reworded: ConflictResolutionLike = { ...pickReadme, sentenceA: sentenceKey('rm deletes the task for good.') };
    const decisions = { conflictResolutions: [reworded] };
    expect(openConflicts(corpus([RM]), decisions)).toHaveLength(1);
    expect(orphanedConflictResolutions(corpus([RM]), decisions)).toEqual([reworded]);
    expect(suppressedClaims(corpus([RM]), decisions)).toEqual([]);
  });

  it('conflictKey is the two sides as doc and sentence, in either order', () => {
    expect(conflictKey(README, SPEC, rmSides)).toBe(conflictKey(SPEC, README, [...rmSides].reverse()));
    expect(conflictKey(README, SPEC, rmSides)).toBe(
      conflictKey(README, SPEC, [{ ...rmSides[0]!, heading: null, quote: undefined }, { ...rmSides[1]!, heading: 'Other' }]),
    );
    expect(conflictKey(README, SPEC, rmSides)).not.toBe(conflictKey(README, SPEC, [rmSides[0]!, at(SPEC, 'rm <id>', 'rm archives nothing.')]));
    expect(resolutionConflictKey(pickReadme)).toBe(conflictKey(README, SPEC, rmSides));
  });

  it('a matched resolution is NOT orphaned', () => {
    expect(orphanedConflictResolutions(corpus([RM]), { conflictResolutions: [pickReadme] })).toEqual([]);
  });

  describe('dormantResolutionForPair — the reapply hint for a verdict that matches no current conflict', () => {
    const hint = (resolutions: ConflictResolutionLike[]) => {
      const decisions = { conflictResolutions: resolutions };
      const conflicts = buildCorpusConflicts(corpus([RM]), decisions);
      return dormantResolutionForPair(decisions, conflicts, conflicts[0].a, conflicts[0].b);
    };

    it('finds a same-pair verdict on other sentences (does not match the conflict)', () => {
      const moved: ConflictResolutionLike = { ...pickReadme, sentenceA: sentenceKey('rm deletes the task for good.') };
      expect(openConflicts(corpus([RM]), { conflictResolutions: [moved] })).toHaveLength(1);
      expect(hint([moved])).toBe(moved);
    });

    it('matches the pair in EITHER doc order', () => {
      const moved: ConflictResolutionLike = {
        ...pickReadme,
        docA: SPEC,
        sentenceA: sentenceKey('rm archives nothing.'),
        docB: README,
        sentenceB: rmSides[0]!.sentence,
      };
      expect(hint([moved])).toBe(moved);
    });

    it('returns nothing when the resolution MATCHES the conflict (it resolves, no hint)', () => {
      expect(hint([pickReadme])).toBeUndefined();
    });

    it('returns nothing for a different doc pair', () => {
      expect(hint([{ ...pickReadme, docB: 'docs/OTHER.md' }])).toBeUndefined();
    });
  });
});

describe('conflict identity — the addressable id the surfaces key rows on', () => {
  const API = 'knowledge/708837377.md';
  const APP = 'knowledge/894959617.md';
  /** Two conflicts on the SAME pair in the SAME area, under the same headings. */
  const samePairTwoPoints = () => ({
    areas: [
      {
        id: 'core/affiliate-channels',
        conflicts: [
          {
            docs: [API, APP] as [string, string],
            note: 'two endpoints both documented as "retrieve the list of source channels"',
            sections: [at(API, '3. API Description', 'GET /channels lists the source channels.'), at(APP, '3. API Description', 'GET /sources lists the source channels.')],
          },
          {
            docs: [API, APP] as [string, string],
            note: 'channel key named affiliateChannelKey vs ChannelKey',
            sections: [at(API, '3. API Description', 'The key is affiliateChannelKey.'), at(APP, '3. API Description', 'The key is ChannelKey.')],
          },
        ],
      },
    ],
  });

  it('gives two same-pair/same-area conflicts DISTINCT ids', () => {
    const conflicts = buildCorpusConflicts(samePairTwoPoints(), {});
    expect(conflicts).toHaveLength(2);
    expect(conflicts[0].id).not.toBe(conflicts[1].id);
    for (const c of conflicts) expect(c.id.startsWith(`conflict::core/affiliate-channels::${API}::${APP}::`)).toBe(true);
  });

  it('keys the id on the identity the dedup merges on — stable across re-derivation', () => {
    const first = buildCorpusConflicts(samePairTwoPoints(), {}).map((c) => c.id);
    const again = buildCorpusConflicts(samePairTwoPoints(), {}).map((c) => c.id);
    expect(first.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
    expect(again).toEqual(first);
    expect(conflictId('x', API, APP, samePairTwoPoints().areas[0]!.conflicts[0]!)).toBe(
      conflictId('x', API, APP, { ...samePairTwoPoints().areas[0]!.conflicts[0]!, note: 'other note' }),
    );
  });

  it('resolveConflictId returns the conflict the id addresses, not the first on the pair', () => {
    const conflicts = buildCorpusConflicts(samePairTwoPoints(), {});
    expect(resolveConflictId(conflicts, conflicts[1].id)).toBe(conflicts[1]);
    expect(resolveConflictId(conflicts, `conflict::core/affiliate-channels::${API}::${APP}`)).toBeUndefined();
  });

  it('isConflictId separates a conflict id from a plain doc ref', () => {
    const conflicts = buildCorpusConflicts(samePairTwoPoints(), {});
    expect(isConflictId(conflicts[0].id)).toBe(true);
    expect(isConflictId('docs/SPEC.md')).toBe(false);
  });
});

describe('a contradiction inside one document', () => {
  const DOC = 'DESIGN.md';
  const press = at(DOC, 'Buttons', 'A press translates the button down 1px.');
  const motion = at(DOC, 'Motion', 'A press scales the button to 0.97.');
  const inside = (sections: readonly ConflictSideLike[] = [press, motion]) => ({
    areas: [{ id: 'core/design', conflicts: [{ docs: [DOC, DOC] as [string, string], note: 'press is a translate and a scale', sections }] }],
  });

  it('reads its sides by position: the first side is side a, the second side b', () => {
    expect(conflictSides(DOC, DOC, [press, motion])).toEqual([[press], [motion]]);
    // Two docs keep reading each doc's own sides, whatever order they came in.
    const other = at('GUIDE.md', 'Press', 'q');
    expect(conflictSides(DOC, 'GUIDE.md', [other, press])).toEqual([[press], [other]]);
  });

  it('keys the conflict on both sentences, in either order, apart from every other conflict on the doc', () => {
    const key = conflictKey(DOC, DOC, [press, motion]);
    expect(conflictKey(DOC, DOC, [motion, press])).toBe(key);
    expect(conflictKey(DOC, DOC, [press, at(DOC, 'Motion', 'A press scales the button to 0.98.')])).not.toBe(key);
    expect(conflictKey(DOC, 'GUIDE.md', [press, { ...motion, doc: 'GUIDE.md' }])).not.toBe(key);
  });

  it('stays one open conflict beside a two-doc conflict on the same doc, and a verdict resolves it', () => {
    const corpus = inside();
    corpus.areas[0].conflicts.push({
      docs: [DOC, 'GUIDE.md'],
      note: 'radius 4 vs 6',
      sections: [at(DOC, 'Corners', 'Radius is 4px.'), at('GUIDE.md', 'Corners', 'Radius is 6px.')],
    });
    const conflicts = buildCorpusConflicts(corpus, {});
    expect(conflicts.map((c) => [c.a, c.b])).toEqual([
      [DOC, DOC],
      [DOC, 'GUIDE.md'],
    ]);
    const self = conflicts[0];
    const verdict = conflictVerdictFor(self, self.a, self.b, 'b');
    expect(verdict).toMatchObject({ docA: DOC, anchorA: 'Buttons', sentenceA: press.sentence, docB: DOC, anchorB: 'Motion', sentenceB: motion.sentence, verdict: 'b' });
    const decisions = { conflictResolutions: [{ ...verdict, resolvedAt: '' }] };
    expect(openConflicts(corpus, decisions).map((c) => c.a === c.b)).toEqual([false]);
  });

  it('suppresses the losing sentence, never the winning one on the same doc, whatever order the next scan lists them in', () => {
    const a = verdictOn([press, motion], DOC, DOC, 'a');
    expect(suppressedClaims(inside(), { conflictResolutions: [a] })).toEqual([{ doc: DOC, anchor: 'Motion', quote: motion.quote, sentence: motion.sentence }]);
    expect(suppressedClaims(inside(), { conflictResolutions: [{ ...a, verdict: 'b' }] })).toEqual([{ doc: DOC, anchor: 'Buttons', quote: press.quote, sentence: press.sentence }]);
    expect(suppressedClaims(inside([motion, press]), { conflictResolutions: [a] })).toEqual([{ doc: DOC, anchor: 'Motion', quote: motion.quote, sentence: motion.sentence }]);
  });

  it('under one heading, two sentences are two sides, and two repeats of one text are too', () => {
    const first = at(DOC, 'Providers', 'The provider is tested when you save it.');
    const second = at(DOC, 'Providers', 'Run the Test step to check the provider.');
    const pickFirst = verdictOn([first, second], DOC, DOC, 'a');
    expect(suppressedClaims(inside([second, first]), { conflictResolutions: [pickFirst] })).toEqual([
      { doc: DOC, anchor: 'Providers', quote: second.quote, sentence: second.sentence },
    ]);
    const once = at(DOC, 'Status', 'Returns 200.');
    const twice = at(DOC, 'Errors', 'Returns 200.', 1);
    expect(sameSentence(once, twice)).toBe(false);
    expect(buildCorpusConflicts(inside([once, twice]), {})).toHaveLength(1);
  });

  it('sameSentence and verdictNamesOneSentence read the key alone', () => {
    expect(sameSentence(press, motion)).toBe(false);
    expect(sameSentence(press, { ...press, heading: 'Other', quote: 'a different window of the same sentence' })).toBe(true);
    expect(sameSentence(press, { ...press, doc: 'GUIDE.md' })).toBe(false);
    expect(verdictNamesOneSentence({ docA: DOC, sentenceA: press.sentence, docB: DOC, sentenceB: press.sentence })).toBe(true);
    expect(verdictNamesOneSentence({ docA: DOC, sentenceA: press.sentence, docB: DOC, sentenceB: motion.sentence })).toBe(false);
    expect(verdictNamesOneSentence({ docA: DOC, sentenceA: press.sentence, docB: 'GUIDE.md', sentenceB: press.sentence })).toBe(false);
  });
});

describe('several conflicts between the same two sections', () => {
  const API = 'docs/api.md';
  const APP = 'docs/app.md';
  const pageSize = [at(API, 'Expense list', 'Returns 20 expenses per page.'), at(APP, 'Expense list', 'The list shows 50 expenses per page.')];
  const sortOrder = [at(API, 'Expense list', 'Expenses are sorted newest first.'), at(APP, 'Expense list', 'Expenses are sorted oldest first.')];
  const emptyText = [at(API, 'Expense list', 'An empty list returns an empty array.'), at(APP, 'Expense list', 'An empty list says "No expenses yet".')];
  const POINTS = [pageSize, sortOrder, emptyText];
  const corpusOf = (lists: ReadonlyArray<readonly ConflictSideLike[]>, area = 'core/expenses') => ({
    areas: [{ id: area, conflicts: lists.map((sections, i) => ({ docs: [API, APP] as [string, string], note: `point ${i}`, sections })) }],
  });

  it('are as many conflicts, with as many ids and keys', () => {
    const conflicts = buildCorpusConflicts(corpusOf(POINTS), {});
    expect(conflicts).toHaveLength(3);
    expect(new Set(conflicts.map((c) => c.id)).size).toBe(3);
    expect(new Set(conflicts.map((c) => conflictKey(c.a, c.b, c.sections))).size).toBe(3);
    expect(conflicts.map((c) => c.note).sort()).toEqual(['point 0', 'point 1', 'point 2']);
    for (const c of conflicts) expect(resolveConflictId(conflicts, c.id)).toBe(c);
  });

  it('two records naming the same two sentences are one conflict, in either doc order and across areas', () => {
    const reversed = { docs: [APP, API] as [string, string], note: 'page size again', sections: [...pageSize].reverse() };
    const merged = dedupeCrossAreaConflicts([
      { area: 'core/expenses', conflict: { docs: [API, APP] as [string, string], note: 'page size', sections: pageSize } },
      { area: 'core/lists', conflict: reversed },
      { area: 'core/expenses', conflict: { docs: [API, APP] as [string, string], note: 'sort order', sections: sortOrder } },
    ]);
    expect(merged.map((m) => [m.conflict.note, m.areas, m.members.map((o) => o.note)])).toEqual([
      ['page size', ['core/expenses', 'core/lists'], ['page size', 'page size again']],
      ['sort order', ['core/expenses'], ['sort order']],
    ]);
  });

  it('a verdict resolves only the conflict on its two sentences', () => {
    const verdict = verdictOn(sortOrder, API, APP, 'b');
    expect(verdict).toMatchObject({ sentenceA: sortOrder[0]!.sentence, sentenceB: sortOrder[1]!.sentence });
    const decisions = { conflictResolutions: [verdict] };
    expect(buildCorpusConflicts(corpusOf(POINTS), decisions).map((c) => [c.note, c.resolved])).toEqual([
      ['point 0', false],
      ['point 1', true],
      ['point 2', false],
    ]);
    expect(resolutionForConflict([verdict], API, APP, sortOrder)).toBe(verdict);
    expect(resolutionForConflict([verdict], API, APP, pageSize)).toBeUndefined();
    expect(orphanedConflictResolutions(corpusOf(POINTS), decisions)).toEqual([]);
  });

  it('offers as a hint only a verdict that matches no current conflict', () => {
    const inForce = verdictOn(pageSize, API, APP, 'a');
    const old = verdictOn([at(API, 'Expense list', 'Pages hold ten.'), at(APP, 'Expense list', 'Pages hold twelve.')], API, APP, 'b');
    const decisions = { conflictResolutions: [inForce] };
    expect(dormantResolutionForPair(decisions, buildCorpusConflicts(corpusOf(POINTS), decisions), API, APP)).toBeUndefined();
    const withOld = { conflictResolutions: [inForce, old] };
    expect(dormantResolutionForPair(withOld, buildCorpusConflicts(corpusOf(POINTS), withOld), APP, API)).toBe(old);
  });

  it('suppresses the losing quote of the conflict each verdict is on, never another point on the same sections', () => {
    const decisions = { conflictResolutions: [verdictOn(pageSize, API, APP, 'a'), verdictOn(emptyText, API, APP, 'b')] };
    expect(suppressedClaims(corpusOf(POINTS), decisions)).toEqual([
      { doc: APP, anchor: 'Expense list', quote: pageSize[1]!.quote, sentence: pageSize[1]!.sentence },
      { doc: API, anchor: 'Expense list', quote: emptyText[0]!.quote, sentence: emptyText[0]!.sentence },
    ]);
  });
});
