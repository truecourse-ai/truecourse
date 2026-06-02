import { describe, it, expect } from 'vitest';
import { compareEnum } from '../../packages/contract-verifier/src/comparator/enum.js';
import type {
  ArtifactRef,
  ContractDrift,
  EnumContract,
} from '../../packages/contract-verifier/src/types/index.js';
import type { ExtractedEnum } from '../../packages/contract-verifier/src/extractor/enum/types.js';

const ENUM_REF: ArtifactRef = {
  type: 'Enum',
  identity: 'SignatureClassification',
  quoted: false,
};

function mkExtracted(overrides: Partial<ExtractedEnum>): ExtractedEnum {
  return {
    name: 'SignatureClassification',
    values: [],
    shape: 'zod-enum',
    source: { filePath: '/repo/x.ts', lineStart: 10, lineEnd: 10 },
    ...overrides,
  };
}

function obligationsOf(drifts: ContractDrift[]): string[] {
  return drifts.map((d) => d.obligationKey).sort();
}

describe('Enum comparator', () => {
  it('emits no drift when spec and code values match exactly', () => {
    const drifts = compareEnum({
      ref: ENUM_REF,
      origin: null,
      contract: {
        representation: 'string-literal',
        closed: true,
        values: ['PASS', 'MISSING', 'INVALID', 'SUSPECT', 'OUTLIER'],
      },
      codeEnums: [mkExtracted({ values: ['PASS', 'MISSING', 'INVALID', 'SUSPECT', 'OUTLIER'] })],
    });
    expect(drifts).toEqual([]);
  });

  it('fires missing-value when spec has a value code lacks', () => {
    // The canonical Compliance audit shape: spec lists PARTIAL, code has INVALID instead.
    const drifts = compareEnum({
      ref: ENUM_REF,
      origin: null,
      contract: {
        representation: 'string-literal',
        closed: true,
        values: ['PASS', 'MISSING', 'PARTIAL', 'SUSPECT', 'OUTLIER'],
      },
      codeEnums: [mkExtracted({ values: ['PASS', 'MISSING', 'INVALID', 'SUSPECT', 'OUTLIER'] })],
    });
    expect(obligationsOf(drifts)).toEqual([
      'enum.SignatureClassification.extra-value.INVALID',
      'enum.SignatureClassification.missing-value.PARTIAL',
    ]);
    const missing = drifts.find((d) => d.obligationKey.endsWith('.PARTIAL'))!;
    expect(missing.severity).toBe('high');
    const extra = drifts.find((d) => d.obligationKey.endsWith('.INVALID'))!;
    expect(extra.severity).toBe('medium');
  });

  it('emits no-code-counterpart when no enum matches by name', () => {
    const drifts = compareEnum({
      ref: ENUM_REF,
      origin: null,
      contract: {
        representation: 'string-literal',
        closed: true,
        values: ['A', 'B'],
      },
      codeEnums: [mkExtracted({ name: 'UnrelatedThing', values: ['X', 'Y'] })],
    });
    expect(drifts).toHaveLength(1);
    expect(drifts[0].obligationKey).toBe('enum.SignatureClassification.no-code-counterpart');
    expect(drifts[0].severity).toBe('info');
  });

  it('matches by loose name normalization (Status ↔ STATUS_VALUES ↔ status_enum)', () => {
    const drifts = compareEnum({
      ref: { type: 'Enum', identity: 'Status', quoted: false },
      origin: null,
      contract: { representation: 'string-literal', closed: true, values: ['a', 'b'] },
      codeEnums: [
        mkExtracted({ name: 'STATUS_VALUES', values: ['a', 'b'] }),
      ],
    });
    expect(drifts).toEqual([]);
  });

  it('diffs each matching code-side enum independently (divergent code IS a drift)', () => {
    // Two code-side enums both claim to represent Status but diverge.
    const drifts = compareEnum({
      ref: { type: 'Enum', identity: 'Status', quoted: false },
      origin: null,
      contract: { representation: 'string-literal', closed: true, values: ['a', 'b', 'c'] },
      codeEnums: [
        mkExtracted({ name: 'Status', values: ['a', 'b'] }),         // missing 'c'
        mkExtracted({ name: 'StatusType', values: ['a', 'b', 'd'] }), // missing 'c', extra 'd'
      ],
    });
    const keys = obligationsOf(drifts);
    expect(keys).toContain('enum.Status.missing-value.c');
    expect(keys).toContain('enum.Status.extra-value.d');
  });

  it('diffs trigger subsets against matching code-side sets', () => {
    // Spec says flagging = [MISSING, INVALID, SUSPECT, OUTLIER]
    // Code has NON_PASS_SET = [MISSING, INVALID, SUSPECT]   ← OUTLIER dropped
    const drifts = compareEnum({
      ref: ENUM_REF,
      origin: null,
      contract: {
        representation: 'string-literal',
        closed: true,
        values: ['PASS', 'MISSING', 'INVALID', 'SUSPECT', 'OUTLIER'],
        triggerSubsets: [
          { name: 'non-pass', values: ['MISSING', 'INVALID', 'SUSPECT', 'OUTLIER'] },
        ],
      },
      codeEnums: [
        mkExtracted({ values: ['PASS', 'MISSING', 'INVALID', 'SUSPECT', 'OUTLIER'] }),
        mkExtracted({ name: 'NON_PASS_SET', values: ['MISSING', 'INVALID', 'SUSPECT'], shape: 'set-literal' }),
      ],
    });
    const keys = obligationsOf(drifts);
    expect(keys).toContain('enum.SignatureClassification.subset.non-pass.missing-value.OUTLIER');
    const flag = drifts.find((d) => d.obligationKey.endsWith('.OUTLIER') && d.obligationKey.includes('subset'))!;
    expect(flag.severity).toBe('high');
    expect(flag.message).toContain('downstream behavior');
  });

  it('reports no-code-counterpart for missing trigger subset', () => {
    const drifts = compareEnum({
      ref: ENUM_REF,
      origin: null,
      contract: {
        representation: 'string-literal',
        closed: true,
        values: ['a', 'b'],
        triggerSubsets: [{ name: 'flagging', values: ['a'] }],
      },
      codeEnums: [
        mkExtracted({ values: ['a', 'b'] }),
        // No FLAGGING / NON_PASS set in code
      ],
    });
    const subsetDrifts = drifts.filter((d) => d.obligationKey.includes('subset'));
    expect(subsetDrifts).toHaveLength(1);
    expect(subsetDrifts[0].obligationKey).toBe('enum.SignatureClassification.subset.flagging.no-code-counterpart');
  });

  it('dedupes identical drifts within a single rule run', () => {
    // Multiple code-side enums all named "Status" with identical
    // missing values produce ONE drift entry per (obligationKey, file:line).
    const drifts = compareEnum({
      ref: { type: 'Enum', identity: 'Status', quoted: false },
      origin: null,
      contract: { representation: 'string-literal', closed: true, values: ['a', 'b', 'c'] },
      codeEnums: [
        mkExtracted({ name: 'Status', values: ['a', 'b'], source: { filePath: '/x.ts', lineStart: 10, lineEnd: 10 } }),
        mkExtracted({ name: 'Status', values: ['a', 'b'], source: { filePath: '/x.ts', lineStart: 10, lineEnd: 10 } }),
      ],
    });
    expect(drifts.filter((d) => d.obligationKey === 'enum.Status.missing-value.c')).toHaveLength(1);
  });
});
