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
  openConflicts,
  orphanedConflictResolutions,
  suppressedClaims,
  normalizeQuote,
  type ConflictResolutionLike,
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

describe('section-scoped conflict resolutions (item 31)', () => {
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

  it('matches by NORMALIZED quotes (backticks / whitespace survive a rescan-style rewrite)', () => {
    const reworded: ConflictResolutionLike = {
      ...pickReadme,
      // Same sentences, backtick-styled + line-wrapped as a fresh scan might store.
      quoteA: '`rm`   permanently\ndeletes the task.',
      quoteB: '`rm` archives the task, keeping history.',
      // A stale anchor the rescan renamed — quote identity still matches.
      anchorA: 'Taskline (v2)',
    };
    const decisions = { conflictResolutions: [reworded] };
    expect(openConflicts(disputed(), decisions)).toEqual([]);
    expect(buildCorpusConflicts(disputed(), decisions)[0].resolution?.verdict).toBe('a');
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
});
