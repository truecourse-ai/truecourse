import { describe, it, expect } from 'vitest';
import { compareArchitectureDecision } from '../../packages/contract-verifier/src/comparator/architecture-decision.js';
import type { ArtifactRef, ArchitectureDecisionContract } from '../../packages/contract-verifier/src/types/index.js';
import type { DetectedArchitectureChoice, DetectionSignal } from '../../packages/contract-verifier/src/extractor/architecture/types.js';

const CODE_DIR = '/fake/code';

function ref(identity: string): ArtifactRef {
  return { type: 'ArchitectureDecision', identity, quoted: false };
}

function sig(detail: string): DetectionSignal {
  return { kind: 'package', source: { filePath: '/fake/code/package.json', lineStart: 0, lineEnd: 0 }, detail };
}

function compare(
  identity: string,
  contract: ArchitectureDecisionContract,
  detected: DetectedArchitectureChoice,
) {
  return compareArchitectureDecision({ ref: ref(identity), origin: null, contract, detected, codeDir: CODE_DIR });
}

describe('ArchitectureDecision comparator', () => {
  it('emits unmet-choice when the chosen value is not observed (absence sentinel)', () => {
    const drifts = compare(
      'messaging.kafka',
      { category: 'messaging', chosen: 'kafka', reason: 'replay required' },
      { category: 'messaging', observed: [{ value: 'none', signals: [] }], confidence: 'high' },
    );
    expect(drifts.map((d) => d.obligationKey)).toEqual(['architecture.messaging.unmet-choice']);
    expect(drifts[0].severity).toBe('critical');
    // The 'none' sentinel must NOT also be flagged as a forbidden alternative.
    expect(drifts.some((d) => d.obligationKey.endsWith('forbidden-alternative'))).toBe(false);
  });

  it('emits forbidden-alternative when a signal-backed alternative is in use', () => {
    const drifts = compare(
      'data-store.postgres',
      { category: 'data-store', chosen: 'postgres', reason: 'tsvector search' },
      {
        category: 'data-store',
        observed: [
          { value: 'postgres', signals: [sig('pg (dependencies)')] },
          { value: 'mongodb', signals: [sig('mongoose (dependencies)')] },
        ],
        confidence: 'high',
      },
    );
    expect(drifts.map((d) => d.obligationKey)).toEqual(['architecture.data-store.forbidden-alternative']);
    expect(drifts[0].codeSide).toContain('mongodb');
  });

  it('emits an info inconclusive drift when there is no signal either way', () => {
    const drifts = compare(
      'build-system.vite',
      { category: 'build-system', chosen: 'vite', reason: 'HMR' },
      { category: 'build-system', observed: [], confidence: 'inconclusive' },
    );
    expect(drifts.map((d) => d.obligationKey)).toEqual(['architecture.build-system.inconclusive']);
    expect(drifts[0].severity).toBe('info');
  });

  it('emits NO drift when the chosen value is observed and no alternatives are', () => {
    const drifts = compare(
      'communication.rest',
      { category: 'communication-pattern', chosen: 'rest', reason: 'client reuse' },
      { category: 'communication-pattern', observed: [{ value: 'rest', signals: [sig('express (dependencies)')] }], confidence: 'high' },
    );
    expect(drifts).toEqual([]);
  });

  it('emits BOTH unmet-choice and forbidden-alternative when only an alternative is present', () => {
    const drifts = compare(
      'data-store.postgres',
      { category: 'data-store', chosen: 'postgres', reason: 'r' },
      { category: 'data-store', observed: [{ value: 'mongodb', signals: [sig('mongoose (dependencies)')] }], confidence: 'high' },
    );
    expect(drifts.map((d) => d.obligationKey).sort()).toEqual([
      'architecture.data-store.forbidden-alternative',
      'architecture.data-store.unmet-choice',
    ]);
  });

  it('collapses multiple forbidden alternatives into one drift (no per-value suffix)', () => {
    const drifts = compare(
      'data-store.postgres',
      { category: 'data-store', chosen: 'postgres', reason: 'r' },
      {
        category: 'data-store',
        observed: [
          { value: 'postgres', signals: [sig('pg')] },
          { value: 'mongodb', signals: [sig('mongoose')] },
          { value: 'mysql', signals: [sig('mysql2')] },
        ],
        confidence: 'high',
      },
    );
    expect(drifts.filter((d) => d.obligationKey === 'architecture.data-store.forbidden-alternative')).toHaveLength(1);
  });
});
