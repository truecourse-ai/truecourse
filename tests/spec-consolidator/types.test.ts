import { describe, it, expect } from 'vitest';
import {
  StatusSchema,
  DocKindSchema,
  RelationSchema,
  RelationTypeSchema,
  ManualAreaSchema,
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

describe('RelationTypeSchema / RelationSchema (the three doc→doc verbs)', () => {
  it('accepts the three relation verbs', () => {
    for (const t of ['replace', 'precedence', 'keep-both']) {
      expect(RelationTypeSchema.parse(t)).toBe(t);
    }
  });

  it('rejects an unknown relation verb', () => {
    expect(() => RelationTypeSchema.parse('supersede')).toThrow();
  });

  it('round-trips a scoped relation', () => {
    const rel = {
      type: 'precedence' as const,
      older: 'docs/0003.md',
      newer: 'docs/0008.md',
      scope: 'core/users-entity',
      detectedFrom: 'manual' as const,
      note: '0008 refines the auth0 column',
    };
    expect(RelationSchema.parse(rel)).toEqual(rel);
  });

  it('allows a bare (unscoped) relation', () => {
    const rel = { type: 'replace' as const, older: 'a-v1.md', newer: 'a-v2.md' };
    expect(RelationSchema.parse(rel)).toEqual(rel);
  });
});

describe('ManualAreaSchema (per-doc area override)', () => {
  it('round-trips a doc → areas override', () => {
    const ma = { doc: 'docs/0003.md', areas: ['core/users-entity', 'core/auth'] };
    expect(ManualAreaSchema.parse(ma)).toEqual(ma);
  });
});

describe('DecisionsFileSchema (corpus curation intent)', () => {
  it('defaults the optional arrays when absent', () => {
    const parsed = DecisionsFileSchema.parse({ version: 1 });
    expect(parsed.manualIncludes).toEqual([]);
    expect(parsed.relations).toEqual([]);
    expect(parsed.manualAreas).toEqual([]);
  });

  it('round-trips relations + manualAreas + manualIncludes', () => {
    const file = {
      version: 1 as const,
      manualIncludes: ['docs/keep.md'],
      relations: [{ type: 'keep-both' as const, older: 'a.md', newer: 'b.md' }],
      manualAreas: [{ doc: 'a.md', areas: ['core/auth'] }],
    };
    const parsed = DecisionsFileSchema.parse(file);
    expect(parsed.relations).toHaveLength(1);
    expect(parsed.manualAreas).toHaveLength(1);
    expect(parsed.manualIncludes).toEqual(['docs/keep.md']);
  });

  it('rejects the wrong version literal — bumping is intentional', () => {
    expect(() => DecisionsFileSchema.parse({ version: 2 })).toThrow();
  });
});
