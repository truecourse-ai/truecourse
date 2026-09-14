/**
 * `mergeDecisions` folds one decisions layer over another — the overlay wins on
 * every dimension. It is what the workspace-inheritance fold is built on.
 */
import { describe, it, expect } from 'vitest';
import { mergeDecisions } from '../../packages/core/src/commands/spec-in-process';
import type { DecisionsFile } from '@truecourse/spec-consolidator';

const empty: DecisionsFile = {
  version: 1,
  manualIncludes: [],
  manualExcludes: [],
  manualAreas: [],
};

const decisions = (over: Partial<DecisionsFile>): DecisionsFile => ({ ...empty, ...over });

describe('mergeDecisions — includes/excludes (overlay verb wins per path)', () => {
  it('unions includes and excludes across scopes', () => {
    const base = decisions({ manualIncludes: ['a.md'], manualExcludes: ['b.md'] });
    const overlay = decisions({ manualIncludes: ['c.md'], manualExcludes: ['d.md'] });
    const merged = mergeDecisions(base, overlay);
    expect(merged.manualIncludes.sort()).toEqual(['a.md', 'c.md']);
    expect(merged.manualExcludes.sort()).toEqual(['b.md', 'd.md']);
  });

  it('overlay exclude wins over a base include for the same path', () => {
    const base = decisions({ manualIncludes: ['x.md'] });
    const overlay = decisions({ manualExcludes: ['x.md'] });
    const merged = mergeDecisions(base, overlay);
    expect(merged.manualExcludes).toEqual(['x.md']);
    expect(merged.manualIncludes).not.toContain('x.md');
  });

  it('overlay include wins over a base exclude for the same path', () => {
    const base = decisions({ manualExcludes: ['x.md'] });
    const overlay = decisions({ manualIncludes: ['x.md'] });
    const merged = mergeDecisions(base, overlay);
    expect(merged.manualIncludes).toEqual(['x.md']);
    expect(merged.manualExcludes).not.toContain('x.md');
  });

  it('dedups a path present in both base and overlay', () => {
    const base = decisions({ manualIncludes: ['x.md'] });
    const overlay = decisions({ manualIncludes: ['x.md'] });
    expect(mergeDecisions(base, overlay).manualIncludes).toEqual(['x.md']);
  });
});

describe('mergeDecisions — manualAreas (overlay wins per doc)', () => {
  it('overlay override replaces the base area for that doc; other docs survive', () => {
    const base = decisions({
      manualAreas: [
        { doc: 'a.md', areas: ['core/x'] },
        { doc: 'b.md', areas: ['core/y'] },
      ],
    });
    const overlay = decisions({ manualAreas: [{ doc: 'a.md', areas: ['core/z'] }] });
    const merged = mergeDecisions(base, overlay);
    expect(merged.manualAreas).toContainEqual({ doc: 'a.md', areas: ['core/z'] });
    expect(merged.manualAreas).toContainEqual({ doc: 'b.md', areas: ['core/y'] });
    expect(merged.manualAreas).toHaveLength(2);
  });
});

describe('mergeDecisions — empty overlay is a no-op', () => {
  it('an empty overlay returns the base content', () => {
    const base = decisions({
      manualIncludes: ['a.md'],
      manualExcludes: ['b.md'],
      manualAreas: [{ doc: 'a.md', areas: ['core/x'] }],
    });
    const merged = mergeDecisions(base, empty);
    expect(merged.manualIncludes).toEqual(['a.md']);
    expect(merged.manualExcludes).toEqual(['b.md']);
    expect(merged.manualAreas).toEqual([{ doc: 'a.md', areas: ['core/x'] }]);
  });
});

// Decisions v2: the overlay wins per SCOPE PATH — normalized,
// so `docs/` and `docs` are one row — and instructions union, base order kept.
// The merge always stamps version 2, whatever the inputs still carry.
describe('mergeDecisions — scope verdicts and instructions (v2)', () => {
  const row = (path: string, verdict: 'keep' | 'exclude', reason: string) => ({
    path,
    verdict,
    reason,
    decidedAt: '2026-01-01T00:00:00Z',
    resolvedBy: 'auto' as const,
  });

  it('the overlay wins per scope path; other base rows survive', () => {
    const base = decisions({
      scopeVerdicts: [row('docs', 'keep', 'base'), row('vendor', 'exclude', 'base')],
    });
    const overlay = decisions({ scopeVerdicts: [row('docs', 'exclude', 'overlay')] });
    const merged = mergeDecisions(base, overlay);
    expect(merged.scopeVerdicts).toEqual([
      row('vendor', 'exclude', 'base'),
      row('docs', 'exclude', 'overlay'),
    ]);
  });

  it('normalizes the path, so `docs/` in the overlay replaces `docs` in the base', () => {
    const merged = mergeDecisions(
      decisions({ scopeVerdicts: [row('docs', 'keep', 'base')] }),
      decisions({ scopeVerdicts: [row('docs/', 'exclude', 'overlay')] }),
    );
    expect(merged.scopeVerdicts).toHaveLength(1);
    expect(merged.scopeVerdicts[0]).toMatchObject({ path: 'docs/', verdict: 'exclude' });
  });

  it('unions instructions, base order first, no duplicates', () => {
    const merged = mergeDecisions(
      decisions({ instructions: ['a', 'b'] }),
      decisions({ instructions: ['b', 'c'] }),
    );
    expect(merged.instructions).toEqual(['a', 'b', 'c']);
  });

  it('always yields version 2, and defaults the v2 fields for a v1 input', () => {
    const merged = mergeDecisions(empty, empty);
    expect(merged.version).toBe(2);
    expect(merged.scopeVerdicts).toEqual([]);
    expect(merged.instructions).toEqual([]);
  });
});
