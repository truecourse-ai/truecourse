import { describe, it, expect } from 'vitest';
import {
  StatusSchema,
  DocKindSchema,
  ManualAreaSchema,
  ConflictResolutionSchema,
  DecisionsFileSchema,
} from '../../packages/spec-consolidator/src/index.js';

/**
 * Schema-level tests for the spec-consolidator core types (corpus path).
 * These lock the shared contracts the curate pipeline + `decisions.json`
 * talk through.
 */

describe('StatusSchema (status travels spec → IL → verifier)', () => {
  it('covers the full lifecycle the verifier needs to honor', () => {
    const all = ['shipped', 'planned', 'deferred', 'deprecated', 'out-of-scope'];
    for (const s of all) {
      expect(StatusSchema.parse(s)).toBe(s);
    }
  });

  it('rejects unknown statuses — the verifier branches on this enum', () => {
    expect(() => StatusSchema.parse('todo')).toThrow();
    expect(() => StatusSchema.parse('in-progress')).toThrow();
  });
});

describe('DocKindSchema (signal, not gate)', () => {
  it('parses the kinds the discovery stage emits', () => {
    for (const k of ['prd', 'adr', 'rfc', 'spec', 'runbook', 'design-note', 'readme', 'unknown']) {
      expect(DocKindSchema.parse(k)).toBe(k);
    }
  });
});

describe('ManualAreaSchema (per-doc area override)', () => {
  it('round-trips a doc → areas override', () => {
    const ma = { doc: 'docs/0003.md', areas: ['core/users-entity', 'core/auth'] };
    expect(ManualAreaSchema.parse(ma)).toEqual(ma);
  });
});

describe('ConflictResolutionSchema (section-scoped conflict verdicts)', () => {
  it('round-trips a pick-a-side verdict with anchors + quotes', () => {
    const r = {
      docA: 'README.md',
      anchorA: 'taskline',
      quoteA: 'rm permanently deletes the task.',
      docB: 'docs/SPEC.md',
      anchorB: 'rm <id>',
      quoteB: 'rm archives the task.',
      verdict: 'a' as const,
      resolvedAt: '2026-07-10T00:00:00Z',
      note: 'README is authoritative',
    };
    expect(ConflictResolutionSchema.parse(r)).toEqual(r);
  });

  it('allows null anchors (preamble/lead) and omitted quotes', () => {
    const parsed = ConflictResolutionSchema.parse({
      docA: 'README.md',
      anchorA: null,
      docB: 'docs/SPEC.md',
      anchorB: null,
      verdict: 'dismissed',
      resolvedAt: '',
    });
    expect(parsed.anchorA).toBeNull();
    expect(parsed.quoteA).toBeUndefined();
  });

  it('rejects an unknown verdict', () => {
    expect(() =>
      ConflictResolutionSchema.parse({ docA: 'a', anchorA: null, docB: 'b', anchorB: null, verdict: 'maybe', resolvedAt: '' }),
    ).toThrow();
  });
});

describe('DecisionsFileSchema (corpus curation intent)', () => {
  it('defaults the optional arrays when absent', () => {
    const parsed = DecisionsFileSchema.parse({ version: 1 });
    expect(parsed.manualIncludes).toEqual([]);
    expect(parsed.manualAreas).toEqual([]);
    expect(parsed.conflictResolutions).toEqual([]);
  });

  it('parses an OLD decisions file — missing arrays default, an unknown relations field is dropped', () => {
    const old = {
      version: 1 as const,
      manualIncludes: ['docs/keep.md'],
      manualExcludes: [],
      relations: [{ type: 'keep-both' as const, older: 'a.md', newer: 'b.md' }],
      manualAreas: [],
    };
    const parsed = DecisionsFileSchema.parse(old);
    expect(parsed.conflictResolutions).toEqual([]);
    expect((parsed as Record<string, unknown>).relations).toBeUndefined();
  });

  it('round-trips manualAreas + manualIncludes + conflictResolutions', () => {
    const file = {
      version: 1 as const,
      manualIncludes: ['docs/keep.md'],
      manualAreas: [{ doc: 'a.md', areas: ['core/auth'] }],
      conflictResolutions: [
        { docA: 'a.md', anchorA: 'x', docB: 'b.md', anchorB: 'y', verdict: 'b' as const, resolvedAt: '2026-07-10T00:00:00Z' },
      ],
    };
    const parsed = DecisionsFileSchema.parse(file);
    expect(parsed.manualAreas).toHaveLength(1);
    expect(parsed.manualIncludes).toEqual(['docs/keep.md']);
    expect(parsed.conflictResolutions).toHaveLength(1);
    expect(parsed.conflictResolutions[0].verdict).toBe('b');
  });

  // v2 added the scan orchestrator's scope verdicts + standing
  // instructions. BOTH versions parse — a v1 file simply has neither and gets the
  // defaults — while every writer stamps 2. Any OTHER version literal is still a
  // deliberate bump nobody has made, so it must fail loud.
  it('parses a v2 file with scope verdicts and standing instructions', () => {
    const parsed = DecisionsFileSchema.parse({
      version: 2,
      scopeVerdicts: [
        { path: 'docs/archive', verdict: 'exclude', reason: 'superseded', decidedAt: '2026-08-19T00:00:00Z' },
        { path: 'docs', verdict: 'keep', reason: 'our specs', decidedAt: '2026-08-19T00:00:00Z', resolvedBy: 'auto' },
      ],
      instructions: ['the English tree under docs/en is canonical'],
    });
    expect(parsed.scopeVerdicts).toHaveLength(2);
    expect(parsed.scopeVerdicts[0].resolvedBy).toBeUndefined(); // absent = a human wrote it
    expect(parsed.scopeVerdicts[1].resolvedBy).toBe('auto');
    expect(parsed.instructions).toEqual(['the English tree under docs/en is canonical']);
  });

  it('defaults the v2 fields on a v1 file', () => {
    const parsed = DecisionsFileSchema.parse({ version: 1 });
    expect(parsed.scopeVerdicts).toEqual([]);
    expect(parsed.instructions).toEqual([]);
  });

  it('rejects a scope verdict with an unknown verdict word', () => {
    expect(() =>
      DecisionsFileSchema.parse({
        version: 2,
        scopeVerdicts: [{ path: 'docs', verdict: 'maybe', reason: 'r', decidedAt: 'now' }],
      }),
    ).toThrow();
  });

  it('rejects a version literal nobody bumped to — bumping is intentional', () => {
    expect(() => DecisionsFileSchema.parse({ version: 3 })).toThrow();
    expect(() => DecisionsFileSchema.parse({ version: 0 })).toThrow();
  });
});
