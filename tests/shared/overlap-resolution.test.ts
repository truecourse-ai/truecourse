/**
 * The single "is a within-area overlap resolved?" derivation — ONE copy in
 * @truecourse/shared, imported by the guard-generate gate (core), the CLI
 * (`spec conflicts` / `spec status`), and the dashboard client alike. Covers the
 * three resolutions the surfaces recognise: open, relation-resolved,
 * exclude-resolved — plus scoping, synthesis, and dedup.
 */
import { describe, it, expect } from 'vitest';
import {
  coveringRelation,
  buildCorpusConflicts,
  openConflicts,
  type RelationLike,
} from '../../packages/shared/src/spec/overlap-resolution.js';

interface Rel extends RelationLike {
  type: 'replace' | 'precedence' | 'keep-both';
}

/** One area, one flagged overlap between two docs — the base fixture. */
function corpus(overlaps: Array<{ docs: [string, string]; note?: string }>, relations: Rel[] = []) {
  return {
    areas: [
      { id: 'booking/appointments', overlaps },
      { id: 'booking/auth', overlaps: [] },
    ],
    relations,
  };
}

const OV = { docs: ['docs/v1.md', 'docs/v2.md'] as [string, string], note: '24h vs 48h cancellation' };

describe('coveringRelation', () => {
  const rels: Rel[] = [{ type: 'precedence', older: 'docs/v1.md', newer: 'docs/v2.md' }];

  it('matches the pair in either order', () => {
    expect(coveringRelation(rels, 'docs/v1.md', 'docs/v2.md', 'booking/appointments')).toBe(rels[0]);
    expect(coveringRelation(rels, 'docs/v2.md', 'docs/v1.md', 'booking/appointments')).toBe(rels[0]);
  });

  it('an unscoped relation covers any area; a scoped one only its own', () => {
    expect(coveringRelation(rels, 'docs/v1.md', 'docs/v2.md', 'anything')).toBe(rels[0]);
    const scoped: Rel[] = [{ type: 'precedence', older: 'docs/v1.md', newer: 'docs/v2.md', scope: 'booking/appointments' }];
    expect(coveringRelation(scoped, 'docs/v1.md', 'docs/v2.md', 'booking/appointments')).toBe(scoped[0]);
    expect(coveringRelation(scoped, 'docs/v1.md', 'docs/v2.md', 'booking/other')).toBeUndefined();
  });
});

describe('buildCorpusConflicts / openConflicts', () => {
  it('an overlap with no relation and no exclude is OPEN', () => {
    const conflicts = buildCorpusConflicts(corpus([OV]), {});
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      area: 'booking/appointments',
      a: 'docs/v1.md',
      b: 'docs/v2.md',
      note: '24h vs 48h cancellation',
      resolved: false,
      synthesized: false,
    });
    expect(openConflicts(corpus([OV]), {})).toHaveLength(1);
  });

  it('a covering relation RESOLVES the overlap (relation-resolved)', () => {
    const decisions = { relations: [{ type: 'precedence' as const, older: 'docs/v1.md', newer: 'docs/v2.md', scope: 'booking/appointments' }] };
    const conflicts = buildCorpusConflicts(corpus([OV]), decisions);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].resolved).toBe(true);
    expect(conflicts[0].relation).toEqual(decisions.relations[0]);
    expect(conflicts[0].userRelation).toEqual(decisions.relations[0]);
    expect(openConflicts(corpus([OV]), decisions)).toEqual([]);
  });

  it('a force-exclude on either side RESOLVES the overlap (exclude-resolved)', () => {
    const decisions = { manualExcludes: ['docs/v1.md'] };
    const conflicts = buildCorpusConflicts(corpus([OV]), decisions);
    expect(conflicts[0].resolved).toBe(true);
    expect(conflicts[0].excludedRef).toBe('docs/v1.md');
    expect(conflicts[0].relation).toBeUndefined();
    expect(openConflicts(corpus([OV]), decisions)).toEqual([]);

    // The OTHER side excluded resolves it too.
    expect(openConflicts(corpus([OV]), { manualExcludes: ['docs/v2.md'] })).toEqual([]);
  });

  it('an auto (corpus) relation resolves it just like a user one, but is not the userRelation', () => {
    const autoCorpus = corpus([OV], [{ type: 'replace', older: 'docs/v1.md', newer: 'docs/v2.md' }]);
    const conflicts = buildCorpusConflicts(autoCorpus, {});
    expect(conflicts[0].resolved).toBe(true);
    expect(conflicts[0].relation).toBeDefined();
    expect(conflicts[0].userRelation).toBeUndefined();
  });

  it('SYNTHESIZES a resolved entry for a user relation the corpus no longer flags', () => {
    const decisions = { relations: [{ type: 'precedence' as const, older: 'docs/v1.md', newer: 'docs/v2.md', scope: 'booking/appointments' }] };
    // No flagged overlaps (a fresh scan dropped the covered pair).
    const conflicts = buildCorpusConflicts(corpus([]), decisions);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ area: 'booking/appointments', a: 'docs/v1.md', b: 'docs/v2.md', resolved: true, synthesized: true });
    expect(openConflicts(corpus([]), decisions)).toEqual([]);
  });

  it('does NOT synthesize a second row for a relation that already covers a flagged overlap', () => {
    const decisions = { relations: [{ type: 'precedence' as const, older: 'docs/v1.md', newer: 'docs/v2.md', scope: 'booking/appointments' }] };
    const conflicts = buildCorpusConflicts(corpus([OV]), decisions);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].synthesized).toBe(false);
  });
});

describe('cross-area dedup', () => {
  // The live taskline shape: README + SPEC's `rm` dispute flagged in two shared
  // areas. The SPEC side points at the SAME heading in both; the README side
  // differs (a heading vs the preamble/null). Older corpora persisted BOTH
  // per-area records; the read layer collapses them to one.
  const taskline = (relations: Rel[] = []) => ({
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
    relations,
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

  it('a single doc-pair relation scoped to EITHER spanned area (or unscoped) resolves it everywhere', () => {
    for (const scope of ['core/persistence', 'core/tasks-entity', undefined]) {
      const decisions = {
        relations: [{ type: 'replace' as const, older: 'docs/SPEC.md', newer: 'README.md', ...(scope ? { scope } : {}) }],
      };
      const conflicts = buildCorpusConflicts(taskline(), decisions);
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].resolved).toBe(true);
      expect(openConflicts(taskline(), decisions)).toEqual([]);
    }
  });

  it('a force-exclude of either doc resolves the merged dispute once', () => {
    expect(openConflicts(taskline(), { manualExcludes: ['README.md'] })).toEqual([]);
    expect(openConflicts(taskline(), { manualExcludes: ['docs/SPEC.md'] })).toEqual([]);
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
      relations: [] as Rel[],
    };
    expect(buildCorpusConflicts(twoDisputes, {})).toHaveLength(2);
    // A relation scoped to ONE dispute's area resolves only that one.
    const resolvePersistence = {
      relations: [{ type: 'replace' as const, older: 'docs/SPEC.md', newer: 'README.md', scope: 'core/persistence' }],
    };
    const stillOpen = openConflicts(twoDisputes, resolvePersistence);
    expect(stillOpen).toHaveLength(1);
    expect(stillOpen[0].area).toBe('core/auth');
  });
});
