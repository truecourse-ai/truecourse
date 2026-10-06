/**
 * The single "is a within-area overlap resolved?" derivation — ONE copy in
 * @truecourse/shared, imported by the guard-generate gate (core), the CLI
 * (`spec conflicts` / `spec status`), and the dashboard client alike. A conflict
 * resolves ONLY via a matching section-scoped verdict (pick-a-side / dismissal)
 * or a covering force-exclude; doc→doc relations are lifecycle/precedence
 * metadata and NEVER resolve a conflict.
 */
import { describe, it, expect } from 'vitest';
import {
  buildCorpusConflicts,
  conflictId,
  conflictVerdictFor,
  dedupeCrossAreaOverlaps,
  disputeSides,
  dormantResolutionForPair,
  openConflicts,
  orphanedConflictResolutions,
  suppressedClaims,
  normalizeQuote,
  disputeKey,
  passageKey,
  resolutionDisputeKey,
  resolutionForConflict,
  resolveConflictId,
  isConflictId,
  samePassage,
  verdictNamesOnePassage,
  type ConflictResolutionLike,
  type OverlapSectionLike,
} from '../../packages/shared/src/spec/overlap-resolution.js';

interface Rel {
  type: 'replace' | 'precedence' | 'keep-both';
  older: string;
  newer: string;
  scope?: string;
}

/** One area, one flagged overlap between two docs — the base fixture. */
function corpus(overlaps: Array<{ docs: [string, string]; note?: string }>) {
  return {
    areas: [
      { id: 'booking/appointments', overlaps },
      { id: 'booking/auth', overlaps: [] },
    ],
  };
}

const OV = { docs: ['docs/v1.md', 'docs/v2.md'] as [string, string], note: '24h vs 48h cancellation' };

describe('buildCorpusConflicts / openConflicts', () => {
  it('an overlap with no verdict and no exclude is OPEN', () => {
    const conflicts = buildCorpusConflicts(corpus([OV]), {});
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      area: 'booking/appointments',
      a: 'docs/v1.md',
      b: 'docs/v2.md',
      note: '24h vs 48h cancellation',
      resolved: false,
    });
    expect(openConflicts(corpus([OV]), {})).toHaveLength(1);
  });

  it('a covering doc relation does NOT resolve the overlap — relations are lifecycle, not resolution', () => {
    // Covering relations of every shape: scoped, unscoped, each type.
    const relationDecisions = {
      relations: [
        { type: 'precedence', older: 'docs/v1.md', newer: 'docs/v2.md', scope: 'booking/appointments' },
        { type: 'replace', older: 'docs/v1.md', newer: 'docs/v2.md' },
        { type: 'keep-both', older: 'docs/v1.md', newer: 'docs/v2.md' },
      ] as Rel[],
    };
    const conflicts = buildCorpusConflicts(corpus([OV]), relationDecisions);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].resolved).toBe(false);
    expect(openConflicts(corpus([OV]), relationDecisions)).toHaveLength(1);
  });

  it('a force-exclude on either side RESOLVES the overlap (exclude-resolved)', () => {
    const decisions = { manualExcludes: ['docs/v1.md'] };
    const conflicts = buildCorpusConflicts(corpus([OV]), decisions);
    expect(conflicts[0].resolved).toBe(true);
    expect(conflicts[0].excludedRef).toBe('docs/v1.md');
    expect(openConflicts(corpus([OV]), decisions)).toEqual([]);

    // The OTHER side excluded resolves it too.
    expect(openConflicts(corpus([OV]), { manualExcludes: ['docs/v2.md'] })).toEqual([]);
  });

  it('does NOT synthesize conflict rows from user relations — no flagged overlap, no row', () => {
    const relationDecisions = {
      relations: [{ type: 'precedence', older: 'docs/v1.md', newer: 'docs/v2.md', scope: 'booking/appointments' }] as Rel[],
    };
    expect(buildCorpusConflicts(corpus([]), relationDecisions)).toEqual([]);
    expect(openConflicts(corpus([]), relationDecisions)).toEqual([]);
  });
});

describe('cross-area dedup', () => {
  // The live taskline shape: README + SPEC's `rm` dispute flagged in two shared
  // areas. The SPEC side points at the SAME heading in both; the README side
  // differs (a heading vs the preamble/null). Older corpora persisted BOTH
  // per-area records; the read layer collapses them to one.
  const taskline = () => ({
    areas: [
      {
        id: 'core/persistence',
        overlaps: [
          {
            docs: ['README.md', 'docs/SPEC.md'] as [string, string],
            note: 'rm permanent vs archived',
            sections: [
              { doc: 'README.md', heading: 'taskline' },
              { doc: 'docs/SPEC.md', heading: 'rm <id>' },
            ],
          },
        ],
      },
      {
        id: 'core/tasks-entity',
        overlaps: [
          {
            docs: ['README.md', 'docs/SPEC.md'] as [string, string],
            note: 'rm deletes permanently vs archives',
            sections: [
              { doc: 'README.md', heading: null },
              { doc: 'docs/SPEC.md', heading: 'rm <id>' },
            ],
          },
        ],
      },
    ],
  });

  it('collapses the same dispute flagged in two shared areas to ONE conflict spanning both', () => {
    const conflicts = buildCorpusConflicts(taskline(), {});
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ a: 'README.md', b: 'docs/SPEC.md', resolved: false });
    // Representative = the fewest-null (most bandable) side's area.
    expect(conflicts[0].area).toBe('core/persistence');
    expect(conflicts[0].areas).toEqual(['core/persistence', 'core/tasks-entity']);
    expect(openConflicts(taskline(), {})).toHaveLength(1);
  });

  it('a doc-pair relation leaves the merged dispute OPEN, whatever its scope', () => {
    for (const scope of ['core/persistence', 'core/tasks-entity', undefined]) {
      const relationDecisions = {
        relations: [{ type: 'replace', older: 'docs/SPEC.md', newer: 'README.md', ...(scope ? { scope } : {}) }] as Rel[],
      };
      expect(openConflicts(taskline(), relationDecisions)).toHaveLength(1);
    }
  });

  it('a force-exclude of either doc resolves the merged dispute once', () => {
    expect(openConflicts(taskline(), { manualExcludes: ['README.md'] })).toEqual([]);
    expect(openConflicts(taskline(), { manualExcludes: ['docs/SPEC.md'] })).toEqual([]);
  });

  it('a VERDICT matched to the merged dispute resolves it everywhere', () => {
    const decisions = {
      conflictResolutions: [
        {
          docA: 'README.md',
          anchorA: 'taskline',
          docB: 'docs/SPEC.md',
          anchorB: 'rm <id>',
          verdict: 'b' as const,
          resolvedAt: '',
        },
      ],
    };
    expect(openConflicts(taskline(), decisions)).toEqual([]);
  });

  it('keeps TWO records for two genuine disputes on the same pair (disjoint sections)', () => {
    const twoDisputes = {
      areas: [
        {
          id: 'core/persistence',
          overlaps: [
            {
              docs: ['README.md', 'docs/SPEC.md'] as [string, string],
              note: 'rm semantics',
              sections: [{ doc: 'docs/SPEC.md', heading: 'rm <id>' }],
            },
          ],
        },
        {
          id: 'core/auth',
          overlaps: [
            {
              docs: ['README.md', 'docs/SPEC.md'] as [string, string],
              note: 'login flow',
              sections: [{ doc: 'docs/SPEC.md', heading: 'Login' }],
            },
          ],
        },
      ],
    };
    expect(buildCorpusConflicts(twoDisputes, {})).toHaveLength(2);
    // A verdict keyed to ONE dispute's anchors resolves only that one.
    const resolvePersistence = {
      conflictResolutions: [
        { docA: 'README.md', anchorA: null, docB: 'docs/SPEC.md', anchorB: 'rm <id>', verdict: 'b' as const, resolvedAt: '' },
      ],
    };
    const stillOpen = openConflicts(twoDisputes, resolvePersistence);
    expect(stillOpen).toHaveLength(1);
    expect(stillOpen[0].area).toBe('core/auth');
  });
});

describe('section-scoped conflict resolutions — dispute matching, verdicts, claim suppression', () => {
  // One flagged dispute carrying section pointers + verbatim quotes on both sides.
  const disputed = () => ({
    areas: [
      {
        id: 'core/persistence',
        overlaps: [
          {
            docs: ['README.md', 'docs/SPEC.md'] as [string, string],
            note: 'rm permanent vs archived',
            sections: [
              { doc: 'README.md', heading: 'taskline', quote: 'rm permanently deletes the task.' },
              { doc: 'docs/SPEC.md', heading: 'rm <id>', quote: 'rm archives the task, keeping history.' },
            ],
          },
        ],
      },
    ],
  });

  const pickReadme: ConflictResolutionLike = {
    docA: 'README.md',
    anchorA: 'taskline',
    quoteA: 'rm permanently deletes the task.',
    docB: 'docs/SPEC.md',
    anchorB: 'rm <id>',
    quoteB: 'rm archives the task, keeping history.',
    verdict: 'a',
    resolvedAt: '2026-07-10T00:00:00Z',
  };

  it('a side verdict RESOLVES the dispute and carries the verdict on the conflict', () => {
    const decisions = { conflictResolutions: [pickReadme] };
    const conflicts = buildCorpusConflicts(disputed(), decisions);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].resolved).toBe(true);
    expect(conflicts[0].resolution?.verdict).toBe('a');
    expect(openConflicts(disputed(), decisions)).toEqual([]);
  });

  it('a dismissal RESOLVES the dispute but suppresses nothing', () => {
    const decisions = { conflictResolutions: [{ ...pickReadme, verdict: 'dismissed' as const }] };
    const conflicts = buildCorpusConflicts(disputed(), decisions);
    expect(conflicts[0].resolved).toBe(true);
    expect(conflicts[0].resolution?.verdict).toBe('dismissed');
    expect(openConflicts(disputed(), decisions)).toEqual([]);
    expect(suppressedClaims(disputed(), decisions)).toEqual([]);
  });

  it('suppressedClaims names the LOSER’s quote for a side verdict', () => {
    // verdict 'a' → README wins, SPEC's sentence is stale.
    expect(suppressedClaims(disputed(), { conflictResolutions: [pickReadme] })).toEqual([
      { doc: 'docs/SPEC.md', anchor: 'rm <id>', quote: 'rm archives the task, keeping history.' },
    ]);
    // verdict 'b' → SPEC wins, README's sentence is stale.
    expect(
      suppressedClaims(disputed(), { conflictResolutions: [{ ...pickReadme, verdict: 'b' }] }),
    ).toEqual([{ doc: 'README.md', anchor: 'taskline', quote: 'rm permanently deletes the task.' }]);
  });

  it('suppresses the sentence the CURRENT scan quoted, not the one the verdict recorded', () => {
    const rescanned = disputed();
    rescanned.areas[0].overlaps[0].sections[1].quote = 'rm archives the task; three hours of history are kept.';
    expect(suppressedClaims(rescanned, { conflictResolutions: [pickReadme] })).toEqual([
      { doc: 'docs/SPEC.md', anchor: 'rm <id>', quote: 'rm archives the task; three hours of history are kept.' },
    ]);
  });

  it('matches by ANCHORS whatever the quotes say (the session re-excerpts a dispute on every scan)', () => {
    const drifted: ConflictResolutionLike = {
      ...pickReadme,
      quoteA: 'rm permanently deletes the task. Restore is not possible.',
      quoteB: 'rm archives the task.',
    };
    const decisions = { conflictResolutions: [drifted] };
    expect(openConflicts(disputed(), decisions)).toEqual([]);
    expect(buildCorpusConflicts(disputed(), decisions)[0].resolution?.verdict).toBe('a');
  });

  it('does NOT match a renamed anchor: quotes are evidence, never identity', () => {
    const renamed: ConflictResolutionLike = { ...pickReadme, anchorA: 'Taskline (v2)' };
    const decisions = { conflictResolutions: [renamed] };
    expect(openConflicts(disputed(), decisions)).toHaveLength(1);
    expect(orphanedConflictResolutions(disputed(), decisions)).toEqual([renamed]);
  });

  it('disputeKey is the unordered pair plus each side\'s folded anchor (null = the lead)', () => {
    const sections = [
      { doc: 'README.md', heading: '`Taskline`' },
      { doc: 'docs/SPEC.md', heading: 'rm <id>' },
    ];
    expect(disputeKey('README.md', 'docs/SPEC.md', sections)).toBe(
      disputeKey('docs/SPEC.md', 'README.md', [...sections].reverse()),
    );
    expect(disputeKey('README.md', 'docs/SPEC.md', sections)).toBe(
      disputeKey('README.md', 'docs/SPEC.md', [{ doc: 'README.md', heading: 'taskline' }, sections[1]]),
    );
    // A doc with no pointer is its lead, the same as an explicit null heading.
    expect(disputeKey('README.md', 'docs/SPEC.md', undefined)).toBe(
      disputeKey('README.md', 'docs/SPEC.md', [{ doc: 'README.md', heading: null }, { doc: 'docs/SPEC.md', heading: null }]),
    );
    expect(disputeKey('README.md', 'docs/SPEC.md', sections)).not.toBe(disputeKey('README.md', 'docs/SPEC.md', undefined));
    // Delimiters inside a heading never fold two disputes into one, and an
    // empty heading is not the lead.
    expect(disputeKey('a.md', 'b.md', [{ doc: 'a.md', heading: 'x|b.md#y' }, { doc: 'b.md', heading: 'z' }])).not.toBe(
      disputeKey('a.md', 'b.md', [{ doc: 'a.md', heading: 'x' }, { doc: 'b.md', heading: 'y|b.md#z' }]),
    );
    expect(disputeKey('a.md', 'b.md', [{ doc: 'a.md', heading: '' }])).not.toBe(disputeKey('a.md', 'b.md', undefined));
  });

  it('matches by ANCHOR when a side has no quote', () => {
    const noQuotes: ConflictResolutionLike = {
      docA: 'README.md',
      anchorA: 'taskline',
      docB: 'docs/SPEC.md',
      anchorB: 'rm <id>',
      verdict: 'b',
      resolvedAt: '',
    };
    expect(openConflicts(disputed(), { conflictResolutions: [noQuotes] })).toEqual([]);
  });

  it('surfaces an ORPHANED resolution (matches no current dispute) and honors nothing', () => {
    const orphan: ConflictResolutionLike = {
      docA: 'README.md',
      anchorA: 'gone',
      quoteA: 'a sentence the docs no longer contain',
      docB: 'docs/OTHER.md',
      anchorB: 'gone',
      verdict: 'a',
      resolvedAt: '',
    };
    const decisions = { conflictResolutions: [orphan] };
    // The real dispute stays OPEN (the orphan doesn't match it)…
    expect(openConflicts(disputed(), decisions)).toHaveLength(1);
    // …and the orphan is surfaced, never silently honored (no suppression).
    expect(orphanedConflictResolutions(disputed(), decisions)).toEqual([orphan]);
    expect(suppressedClaims(disputed(), decisions)).toEqual([]);
  });

  it('a matched resolution is NOT orphaned', () => {
    expect(orphanedConflictResolutions(disputed(), { conflictResolutions: [pickReadme] })).toEqual([]);
  });

  it('normalizeQuote folds markdown markers + whitespace', () => {
    expect(normalizeQuote('  `rm`  Deletes\nthe  task. ')).toBe('rm deletes the task.');
  });

  describe('dormantResolutionForPair — the reapply hint for a verdict that matches no current conflict', () => {
    const hint = (resolutions: ConflictResolutionLike[]) => {
      const decisions = { conflictResolutions: resolutions };
      const conflicts = buildCorpusConflicts(disputed(), decisions);
      return dormantResolutionForPair(decisions, conflicts, conflicts[0].a, conflicts[0].b);
    };

    it('finds a same-pair verdict whose anchors differ (does not match the dispute)', () => {
      const moved: ConflictResolutionLike = {
        ...pickReadme,
        // The dispute was re-flagged under a renamed heading — same pair, other key.
        anchorA: 'Taskline (v2)',
      };
      // Not resolved (anchor identity is precise, deliberately)…
      expect(openConflicts(disputed(), { conflictResolutions: [moved] })).toHaveLength(1);
      // …but surfaced as the pair's dormant verdict.
      expect(hint([moved])).toBe(moved);
    });

    it('matches the pair in EITHER doc order', () => {
      const moved: ConflictResolutionLike = {
        ...pickReadme,
        docA: 'docs/SPEC.md',
        anchorA: 'rm <id> (old)',
        docB: 'README.md',
        anchorB: 'taskline',
      };
      expect(hint([moved])).toBe(moved);
    });

    it('returns nothing when the resolution MATCHES the dispute (it resolves, no hint)', () => {
      expect(hint([pickReadme])).toBeUndefined();
    });

    it('returns nothing for a different doc pair', () => {
      expect(hint([{ ...pickReadme, docB: 'docs/OTHER.md' }])).toBeUndefined();
    });
  });
});

describe('conflict identity — the addressable id the surfaces key rows on', () => {
  /** Two genuine disputes on the SAME pair in the SAME area, on disjoint sections. */
  const samePairTwoSections = () => ({
    areas: [
      {
        id: 'core/affiliate-channels',
        overlaps: [
          {
            docs: ['knowledge/708837377.md', 'knowledge/894959617.md'] as [string, string],
            note: 'two endpoints both documented as "retrieve the list of source channels"',
            sections: [
              { doc: 'knowledge/708837377.md', heading: '3. API Description' },
              { doc: 'knowledge/894959617.md', heading: '3. API Description' },
            ],
          },
          {
            docs: ['knowledge/708837377.md', 'knowledge/894959617.md'] as [string, string],
            note: 'channel key named affiliateChannelKey vs ChannelKey',
            sections: [
              { doc: 'knowledge/708837377.md', heading: '**3.2. RESPONSE**' },
              { doc: 'knowledge/894959617.md', heading: '**3.2. RESPONSE**' },
            ],
          },
        ],
      },
    ],
  });

  it('gives two same-pair/same-area disputes on disjoint sections DISTINCT ids', () => {
    const conflicts = buildCorpusConflicts(samePairTwoSections(), {});
    expect(conflicts).toHaveLength(2);
    expect(conflicts[0].id).not.toBe(conflicts[1].id);
  });

  it('gives two SECTIONLESS same-pair/same-area disputes distinct ids', () => {
    const sectionless = {
      areas: [
        {
          id: 'core/auth',
          overlaps: [
            { docs: ['README.md', 'docs/SPEC.md'] as [string, string], note: 'token TTL' },
            { docs: ['README.md', 'docs/SPEC.md'] as [string, string], note: 'refresh rotation' },
          ],
        },
      ],
    };
    const conflicts = buildCorpusConflicts(sectionless, {});
    expect(conflicts).toHaveLength(2);
    expect(conflicts[0].id).not.toBe(conflicts[1].id);
  });

  it('keys the id on the same section identity the dedup merges on — stable across re-derivation', () => {
    const first = buildCorpusConflicts(samePairTwoSections(), {}).map((c) => c.id);
    const again = buildCorpusConflicts(samePairTwoSections(), {}).map((c) => c.id);
    expect(first.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
    expect(again).toEqual(first);
  });

  it('carries the representative overlap so a surface never re-finds it', () => {
    const conflicts = buildCorpusConflicts(samePairTwoSections(), {});
    const byNote = conflicts.map((c) => c.overlap.note);
    expect(byNote).toContain('channel key named affiliateChannelKey vs ChannelKey');
  });

  it('resolveConflictId returns the conflict the id addresses, not the first on the pair', () => {
    const conflicts = buildCorpusConflicts(samePairTwoSections(), {});
    const second = conflicts[1];
    expect(resolveConflictId(conflicts, second.id)).toBe(second);
  });

  it('resolveConflictId still resolves a LEGACY area+pair key (no discriminator)', () => {
    const conflicts = buildCorpusConflicts(samePairTwoSections(), {});
    const legacy = 'overlap::core/affiliate-channels::knowledge/708837377.md::knowledge/894959617.md';
    expect(resolveConflictId(conflicts, legacy)).toBe(conflicts[0]);
  });

  it('isConflictId separates a conflict id from a plain doc ref', () => {
    const conflicts = buildCorpusConflicts(samePairTwoSections(), {});
    expect(isConflictId(conflicts[0].id)).toBe(true);
    expect(isConflictId('docs/SPEC.md')).toBe(false);
  });
});

describe('a contradiction inside one document', () => {
  const DOC = 'DESIGN.md';
  const press = { doc: DOC, heading: 'Buttons', quote: 'A press translates the button down 1px.' };
  const motion = { doc: DOC, heading: 'Motion', quote: 'A press scales the button to 0.97.' };
  const inside = (sections = [press, motion]) => ({
    areas: [
      {
        id: 'core/design',
        overlaps: [{ docs: [DOC, DOC] as [string, string], note: 'press is a translate and a scale', sections }],
      },
    ],
  });

  it('reads its sides by position: the first pointer is side a, the second side b', () => {
    expect(disputeSides(DOC, DOC, [press, motion])).toEqual([[press], [motion]]);
    // Two docs keep reading each doc's own pointers, whatever order they came in.
    const other = { doc: 'GUIDE.md', heading: 'Press', quote: 'q' };
    expect(disputeSides(DOC, 'GUIDE.md', [other, press])).toEqual([[press], [other]]);
  });

  it('keys the dispute on both passages, in either order, apart from every other dispute on the doc', () => {
    const key = disputeKey(DOC, DOC, [press, motion]);
    expect(disputeKey(DOC, DOC, [motion, press])).toBe(key);
    expect(disputeKey(DOC, DOC, [press, { ...motion, heading: 'Focus' }])).not.toBe(key);
    expect(disputeKey(DOC, DOC, undefined)).not.toBe(key);
    expect(disputeKey(DOC, 'GUIDE.md', [press, { doc: 'GUIDE.md', heading: 'Motion' }])).not.toBe(key);
  });

  it('stays one open conflict, survives the dedup beside a two-doc dispute on the same doc, and a verdict resolves it', () => {
    const corpus = inside();
    corpus.areas[0].overlaps.push({
      docs: [DOC, 'GUIDE.md'],
      note: 'radius 4 vs 6',
      sections: [
        { doc: DOC, heading: 'Corners', quote: 'Radius is 4px.' },
        { doc: 'GUIDE.md', heading: 'Corners', quote: 'Radius is 6px.' },
      ],
    });
    const conflicts = buildCorpusConflicts(corpus, {});
    expect(conflicts.map((c) => [c.a, c.b])).toEqual([
      [DOC, DOC],
      [DOC, 'GUIDE.md'],
    ]);
    const self = conflicts[0];
    const verdict = conflictVerdictFor(self.overlap, self.a, self.b, 'b');
    expect(verdict).toMatchObject({ docA: DOC, anchorA: 'Buttons', docB: DOC, anchorB: 'Motion', verdict: 'b' });
    const decisions = { conflictResolutions: [{ ...verdict, resolvedAt: '' }] };
    expect(openConflicts(corpus, decisions).map((c) => c.a === c.b)).toEqual([false]);
  });

  it('suppresses the losing PASSAGE, never the winning one on the same doc', () => {
    const a = { ...conflictVerdictFor(inside().areas[0].overlaps[0], DOC, DOC, 'a'), resolvedAt: '' };
    expect(suppressedClaims(inside(), { conflictResolutions: [a] })).toEqual([
      { doc: DOC, anchor: 'Motion', quote: motion.quote },
    ]);
    const b = { ...a, verdict: 'b' as const };
    expect(suppressedClaims(inside(), { conflictResolutions: [b] })).toEqual([
      { doc: DOC, anchor: 'Buttons', quote: press.quote },
    ]);
    // The next scan may list the passages the other way round: the anchors still say which lost.
    expect(suppressedClaims(inside([motion, press]), { conflictResolutions: [a] })).toEqual([
      { doc: DOC, anchor: 'Motion', quote: motion.quote },
    ]);
  });

  it('under one heading, tells the passages apart by the quote the verdict recorded', () => {
    const first = { doc: DOC, heading: 'Providers', quote: 'The provider is tested when you save it.' };
    const second = { doc: DOC, heading: 'Providers', quote: 'Run the Test step to check the provider.' };
    const pickFirst = { ...conflictVerdictFor({ sections: [first, second] }, DOC, DOC, 'a'), resolvedAt: '' };
    expect(suppressedClaims(inside([second, first]), { conflictResolutions: [pickFirst] })).toEqual([
      { doc: DOC, anchor: 'Providers', quote: second.quote },
    ]);
  });

  it('samePassage tells a real pair of passages from one passage named twice', () => {
    expect(samePassage(press, motion)).toBe(false);
    expect(samePassage(press, { ...press, quote: 'A press translates the button down 1px.  ' })).toBe(true);
    expect(samePassage(press, { ...press, quote: 'Another sentence under Buttons.' })).toBe(false);
    expect(samePassage({ doc: DOC, heading: null }, { doc: DOC, heading: null })).toBe(true);
    expect(samePassage(press, { ...press, doc: 'GUIDE.md' })).toBe(false);
  });
});

describe('a pointer without a passage key keeps the identity it always had', () => {
  const sections = [
    { doc: 'README.md', heading: 'taskline', quote: 'rm permanently deletes the task.' },
    { doc: 'docs/SPEC.md', heading: 'rm <id>', quote: 'rm archives the task, keeping history.' },
  ];
  const overlap = { docs: ['README.md', 'docs/SPEC.md'] as [string, string], note: 'rm permanent vs archived', sections };

  it('keys, ids and verdicts are byte-for-byte what they were', () => {
    expect(conflictId('core/persistence', 'README.md', 'docs/SPEC.md', overlap)).toBe(
      'overlap::core/persistence::README.md::docs/SPEC.md::ed2bf893',
    );
    expect(disputeKey('README.md', 'docs/SPEC.md', sections)).toBe('[["README.md","taskline"],["docs/SPEC.md","rm <id>"]]');
    expect(disputeKey('DESIGN.md', 'DESIGN.md', [{ doc: 'DESIGN.md', heading: 'Motion' }, { doc: 'DESIGN.md', heading: 'Buttons' }])).toBe(
      '[["DESIGN.md","buttons"],["DESIGN.md","motion"]]',
    );
    const verdict = conflictVerdictFor(overlap, 'README.md', 'docs/SPEC.md', 'a');
    expect(Object.keys(verdict).sort()).toEqual(['anchorA', 'anchorB', 'docA', 'docB', 'quoteA', 'quoteB', 'verdict']);
    expect(resolutionDisputeKey(verdict)).toBe(disputeKey('README.md', 'docs/SPEC.md', sections));
  });

  it('still merges two overlaps on a pair that share one section, and returns every member', () => {
    const merged = dedupeCrossAreaOverlaps([
      { area: 'core/a', overlap },
      { area: 'core/b', overlap: { ...overlap, note: 'rm semantics', sections: [sections[0]!, { doc: 'docs/SPEC.md', heading: 'Other' }] } },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.areas).toEqual(['core/a', 'core/b']);
    expect(merged[0]!.members).toHaveLength(2);
    expect(merged[0]!.members[0]).toBe(merged[0]!.overlap);
  });
});

describe('conflicts identified by their passages', () => {
  // Two docs whose "Expense list" sections disagree on three separate points.
  const API = 'docs/api.md';
  const APP = 'docs/app.md';
  const at = (doc: string, heading: string | null, text: string): Required<OverlapSectionLike> => ({
    doc,
    heading,
    quote: text,
    passage: passageKey(text),
  });
  const pageSize = [at(API, 'Expense list', 'Returns 20 expenses per page.'), at(APP, 'Expense list', 'The list shows 50 expenses per page.')];
  const sortOrder = [at(API, 'Expense list', 'Expenses are sorted newest first.'), at(APP, 'Expense list', 'Expenses are sorted oldest first.')];
  const emptyText = [at(API, 'Expense list', 'An empty list returns an empty array.'), at(APP, 'Expense list', 'An empty list says "No expenses yet".')];
  const POINTS = [pageSize, sortOrder, emptyText];
  const corpusOf = (lists: ReadonlyArray<readonly OverlapSectionLike[]>, area = 'core/expenses') => ({
    areas: [{ id: area, overlaps: lists.map((sections, i) => ({ docs: [API, APP] as [string, string], note: `point ${i}`, sections })) }],
  });
  const verdictOn = (sections: readonly OverlapSectionLike[], verdict: 'a' | 'b' | 'dismissed'): ConflictResolutionLike => ({
    ...conflictVerdictFor({ sections }, API, APP, verdict),
    resolvedAt: '',
  });

  it('a passage key is a short hash of the normalized text, blind to case, spacing and markup', () => {
    expect(passageKey('Returns 20 expenses per page.')).toMatch(/^[0-9a-f]{8}$/);
    expect(passageKey('Returns **20**  expenses\nper page.')).toBe(passageKey('returns 20 expenses per page.'));
    expect(passageKey('Returns 25 expenses per page.')).not.toBe(passageKey('Returns 20 expenses per page.'));
  });

  it('three disagreements between the same two sections are three conflicts, with three ids and three dispute keys', () => {
    const conflicts = buildCorpusConflicts(corpusOf(POINTS), {});
    expect(conflicts).toHaveLength(3);
    expect(new Set(conflicts.map((c) => c.id)).size).toBe(3);
    expect(new Set(conflicts.map((c) => disputeKey(c.a, c.b, c.sections))).size).toBe(3);
    expect(conflicts.map((c) => c.note).sort()).toEqual(['point 0', 'point 1', 'point 2']);
    for (const c of conflicts) expect(resolveConflictId(conflicts, c.id)).toBe(c);
  });

  it('two overlaps naming the same two passages are one dispute, in either doc order and across areas', () => {
    const reversed = { docs: [APP, API] as [string, string], note: 'page size again', sections: [...pageSize].reverse() };
    const merged = dedupeCrossAreaOverlaps([
      { area: 'core/expenses', overlap: { docs: [API, APP] as [string, string], note: 'page size', sections: pageSize } },
      { area: 'core/lists', overlap: reversed },
      { area: 'core/expenses', overlap: { docs: [API, APP] as [string, string], note: 'sort order', sections: sortOrder } },
    ]);
    expect(merged.map((m) => [m.overlap.note, m.areas, m.members.map((o) => o.note)])).toEqual([
      ['page size', ['core/expenses', 'core/lists'], ['page size', 'page size again']],
      ['sort order', ['core/expenses'], ['sort order']],
    ]);
  });

  it('never merges a passage-keyed overlap with a passage-less one on the same sections', () => {
    const plain = pageSize.map(({ doc, heading, quote }) => ({ doc, heading, quote }));
    const corpus = corpusOf([pageSize, plain, plain.map((s) => ({ ...s, quote: 'other words' }))]);
    const conflicts = buildCorpusConflicts(corpus, {});
    // The two passage-less records still merge with each other by their shared sections.
    expect(conflicts).toHaveLength(2);
    expect(conflicts.map((c) => c.sections?.some((s) => s.passage !== undefined))).toEqual([true, false]);
  });

  it('a verdict names its passages and resolves only the conflict on them', () => {
    const verdict = verdictOn(sortOrder, 'b');
    expect(verdict).toMatchObject({ passageA: sortOrder[0]!.passage, passageB: sortOrder[1]!.passage });
    const decisions = { conflictResolutions: [verdict] };
    const conflicts = buildCorpusConflicts(corpusOf(POINTS), decisions);
    expect(conflicts.map((c) => [c.note, c.resolved])).toEqual([
      ['point 0', false],
      ['point 1', true],
      ['point 2', false],
    ]);
    expect(resolutionForConflict([verdict], API, APP, sortOrder)).toBe(verdict);
    expect(resolutionForConflict([verdict], API, APP, pageSize)).toBeUndefined();
    expect(orphanedConflictResolutions(corpusOf(POINTS), decisions)).toEqual([]);
  });

  it('a verdict without passages matches only a conflict without them, and one with passages only its own', () => {
    const old: ConflictResolutionLike = { docA: API, anchorA: 'Expense list', docB: APP, anchorB: 'Expense list', verdict: 'a', resolvedAt: '' };
    // Recorded before conflicts had passages: it resolves none of them, and is orphaned.
    expect(openConflicts(corpusOf(POINTS), { conflictResolutions: [old] })).toHaveLength(3);
    expect(orphanedConflictResolutions(corpusOf(POINTS), { conflictResolutions: [old] })).toEqual([old]);
    // A verdict with passages never resolves a passage-less conflict on the same sections.
    const plain = corpusOf([pageSize.map(({ doc, heading, quote }) => ({ doc, heading, quote }))]);
    expect(openConflicts(plain, { conflictResolutions: [verdictOn(pageSize, 'a')] })).toHaveLength(1);
    expect(openConflicts(plain, { conflictResolutions: [old] })).toEqual([]);
  });

  it('offers as a hint only a verdict that matches no current conflict', () => {
    const inForce = verdictOn(pageSize, 'a');
    const old: ConflictResolutionLike = { docA: API, anchorA: 'Expense list', docB: APP, anchorB: 'Expense list', verdict: 'b', resolvedAt: '' };
    const decisions = { conflictResolutions: [inForce] };
    const conflicts = buildCorpusConflicts(corpusOf(POINTS), decisions);
    // The verdict on page size is in force there, so it is no hint on sort order or the empty text.
    expect(dormantResolutionForPair(decisions, conflicts, API, APP)).toBeUndefined();
    const withOld = { conflictResolutions: [inForce, old] };
    expect(dormantResolutionForPair(withOld, buildCorpusConflicts(corpusOf(POINTS), withOld), APP, API)).toBe(old);
  });

  it('suppresses the losing quote of the conflict each verdict is on, never another point on the same sections', () => {
    const decisions = { conflictResolutions: [verdictOn(pageSize, 'a'), verdictOn(emptyText, 'b')] };
    expect(suppressedClaims(corpusOf(POINTS), decisions)).toEqual([
      { doc: APP, anchor: 'Expense list', quote: pageSize[1]!.quote },
      { doc: API, anchor: 'Expense list', quote: emptyText[0]!.quote },
    ]);
  });

  describe('inside one document', () => {
    const DOC = 'docs/expenses.md';
    // Two contradictions between the same two passages' headings, and one between two passages under one heading.
    const first = [at(DOC, 'Paging', 'A page holds 20 expenses.'), at(DOC, 'Limits', 'A page holds 50 expenses.')];
    const second = [at(DOC, 'Paging', 'Pages are numbered from 1.'), at(DOC, 'Limits', 'Pages are numbered from 0.')];
    const oneHeading = [at(DOC, 'Paging', 'Deleted expenses are hidden.'), at(DOC, 'Paging', 'Deleted expenses are listed in grey.')];
    const inside = (lists: ReadonlyArray<readonly OverlapSectionLike[]>) => ({
      areas: [{ id: 'core/expenses', overlaps: lists.map((sections, i) => ({ docs: [DOC, DOC] as [string, string], note: `inside ${i}`, sections })) }],
    });

    it('keeps each contradiction its own conflict, keyed on both passages in either order', () => {
      const conflicts = buildCorpusConflicts(inside([first, second, oneHeading]), {});
      expect(conflicts).toHaveLength(3);
      expect(disputeKey(DOC, DOC, first)).toBe(disputeKey(DOC, DOC, [...first].reverse()));
      expect(disputeKey(DOC, DOC, first)).not.toBe(disputeKey(DOC, DOC, second));
      // Under one heading the passage orders the two sides.
      expect(disputeKey(DOC, DOC, oneHeading)).toBe(disputeKey(DOC, DOC, [...oneHeading].reverse()));
    });

    it('a verdict resolves its own contradiction and suppresses its losing passage, whatever order the next scan lists them in', () => {
      const pickFirst = { ...conflictVerdictFor({ sections: oneHeading }, DOC, DOC, 'a'), resolvedAt: '' };
      const rescanned = inside([first, second, [...oneHeading].reverse()]);
      const decisions = { conflictResolutions: [pickFirst] };
      expect(openConflicts(rescanned, decisions).map((c) => c.note)).toEqual(['inside 0', 'inside 1']);
      expect(suppressedClaims(rescanned, decisions)).toEqual([{ doc: DOC, anchor: 'Paging', quote: oneHeading[1]!.quote }]);
    });

    it('two pointers with passage keys are one passage only when their keys are equal', () => {
      const [hidden, grey] = oneHeading;
      expect(samePassage(hidden!, grey!)).toBe(false);
      expect(samePassage(hidden!, { ...hidden!, quote: 'a different window of the same unit' })).toBe(true);
      expect(samePassage(hidden!, { ...hidden!, passage: grey!.passage })).toBe(false);
      expect(
        verdictNamesOnePassage({ docA: DOC, anchorA: 'Paging', passageA: hidden!.passage, docB: DOC, anchorB: 'Paging', passageB: hidden!.passage }),
      ).toBe(true);
      expect(
        verdictNamesOnePassage({ docA: DOC, anchorA: 'Paging', passageA: hidden!.passage, docB: DOC, anchorB: 'Paging', passageB: grey!.passage }),
      ).toBe(false);
    });
  });
});
