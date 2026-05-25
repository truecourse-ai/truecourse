import { describe, it, expect } from 'vitest';
import { compareNamedConstant } from '../../packages/contract-verifier/src/comparator/named-constant.js';
import type {
  ArtifactRef,
  NamedConstantContract,
} from '../../packages/contract-verifier/src/types/index.js';
import type { ExtractedConstant } from '../../packages/contract-verifier/src/extractor/constant/types.js';

function mkExtracted(overrides: Partial<ExtractedConstant>): ExtractedConstant {
  return {
    name: 'X',
    value: '',
    shape: 'const-literal',
    source: { filePath: '/x.ts', lineStart: 1, lineEnd: 1 },
    ...overrides,
  };
}

describe('NamedConstant comparator', () => {
  it('no drift on exact value match', () => {
    const drifts = compareNamedConstant({
      ref: { type: 'NamedConstant', identity: 'LLM_MODEL', quoted: false },
      origin: null,
      contract: { type: 'string', expectedValue: 'claude-sonnet-4-6' },
      codeConstants: [mkExtracted({ name: 'LLM_MODEL', value: 'claude-sonnet-4-6' })],
    });
    expect(drifts).toEqual([]);
  });

  it('fires value-mismatch when string differs', () => {
    const drifts = compareNamedConstant({
      ref: { type: 'NamedConstant', identity: 'LLM_MODEL', quoted: false },
      origin: null,
      contract: { type: 'string', expectedValue: 'claude-sonnet-4-6' },
      codeConstants: [mkExtracted({ name: 'LLM_MODEL', value: 'google/gemini-3-flash-preview' })],
    });
    expect(drifts).toHaveLength(1);
    expect(drifts[0].obligationKey).toBe('constant.LLM_MODEL.value-mismatch');
    expect(drifts[0].severity).toBe('critical'); // MODEL pattern → critical
    expect(drifts[0].codeSide).toContain('google/gemini');
  });

  it('matches by case-normalized name (TIER_WEIGHTS ↔ tierWeights ↔ tier-weights)', () => {
    const drifts = compareNamedConstant({
      ref: { type: 'NamedConstant', identity: 'TIER_WEIGHTS', quoted: false },
      origin: null,
      contract: { type: 'object', expectedValue: { Critical: 3 } },
      codeConstants: [
        mkExtracted({ name: 'tierWeights', value: { Critical: 3 } }),
        mkExtracted({ name: 'tier-weights', value: { Critical: 3 } }),
        mkExtracted({ name: 'tier_weights', value: { Critical: 3 } }),
      ],
    });
    expect(drifts).toEqual([]);
  });

  it('fires value-mismatch when object value differs', () => {
    const drifts = compareNamedConstant({
      ref: { type: 'NamedConstant', identity: 'TIER_WEIGHTS', quoted: false },
      origin: null,
      contract: {
        type: 'object',
        expectedValue: { Critical: 3, Significant: 2, Noticeable: 1, Moderate: 1, Minor: 1, 'Out of Tech Control': 0.5 },
      },
      codeConstants: [mkExtracted({
        name: 'TIER_WEIGHTS',
        value: { Critical: 16, Significant: 8, Noticeable: 4, Moderate: 2, Minor: 1, 'Out of Tech Control': 0 },
      })],
    });
    expect(drifts).toHaveLength(1);
    expect(drifts[0].obligationKey).toBe('constant.TIER_WEIGHTS.value-mismatch');
    expect(drifts[0].severity).toBe('critical');
  });

  it('allows extra keys in code-side object (allowExtraCodeKeys=true)', () => {
    const drifts = compareNamedConstant({
      ref: { type: 'NamedConstant', identity: 'CFG', quoted: false },
      origin: null,
      contract: { type: 'object', expectedValue: { host: 'x' } },
      codeConstants: [mkExtracted({ name: 'CFG', value: { host: 'x', port: 5432 } })],
    });
    expect(drifts).toEqual([]);
  });

  it('fires info-level no-code-counterpart when no name match', () => {
    const drifts = compareNamedConstant({
      ref: { type: 'NamedConstant', identity: 'NEVER_HEARD', quoted: false },
      origin: null,
      contract: { type: 'string', expectedValue: 'x' },
      codeConstants: [mkExtracted({ name: 'SOMETHING_ELSE', value: 'y' })],
    });
    expect(drifts).toHaveLength(1);
    expect(drifts[0].obligationKey).toBe('constant.NEVER_HEARD.no-code-counterpart');
    expect(drifts[0].severity).toBe('info');
  });

  it('fires value-mismatch for each divergent code-side instance', () => {
    const drifts = compareNamedConstant({
      ref: { type: 'NamedConstant', identity: 'X', quoted: false },
      origin: null,
      contract: { type: 'string', expectedValue: 'expected' },
      codeConstants: [
        mkExtracted({ name: 'X', value: 'wrong1', source: { filePath: '/a.ts', lineStart: 1, lineEnd: 1 } }),
        mkExtracted({ name: 'X', value: 'wrong2', source: { filePath: '/b.ts', lineStart: 2, lineEnd: 2 } }),
      ],
    });
    expect(drifts).toHaveLength(2);
    expect(drifts.map((d) => d.filePath).sort()).toEqual(['/a.ts', '/b.ts']);
  });

  it('handles array equality', () => {
    const drifts = compareNamedConstant({
      ref: { type: 'NamedConstant', identity: 'STATUSES', quoted: false },
      origin: null,
      contract: { type: 'array', expectedValue: ['active', 'pending'] },
      codeConstants: [mkExtracted({ name: 'STATUSES', value: ['active', 'pending'] })],
    });
    expect(drifts).toEqual([]);
  });

  it('fires for array ordering / content difference', () => {
    const drifts = compareNamedConstant({
      ref: { type: 'NamedConstant', identity: 'STATUSES', quoted: false },
      origin: null,
      contract: { type: 'array', expectedValue: ['a', 'b', 'c'] },
      codeConstants: [mkExtracted({ name: 'STATUSES', value: ['a', 'b'] })],
    });
    expect(drifts).toHaveLength(1);
    expect(drifts[0].obligationKey).toBe('constant.STATUSES.value-mismatch');
  });

  it('non-MODEL/TIER_WEIGHTS names default to high severity', () => {
    const drifts = compareNamedConstant({
      ref: { type: 'NamedConstant', identity: 'MAX_RETRY', quoted: false },
      origin: null,
      contract: { type: 'number', expectedValue: 5 },
      codeConstants: [mkExtracted({ name: 'MAX_RETRY', value: 10 })],
    });
    expect(drifts[0].severity).toBe('high');
  });
});
