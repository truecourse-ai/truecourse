import { describe, it, expect } from 'vitest';
import {
  existingChainPairKeys,
  selectRecheckPairs,
  type ChainRecheckCandidatePair,
} from '../../packages/spec-consolidator/src/chain-recheck.js';
import type { VersionChain } from '../../packages/spec-consolidator/src/version-chain.js';
import type { Conflict } from '../../packages/spec-consolidator/src/types.js';
import type { DocCandidate } from '../../packages/spec-consolidator/src/discovery.js';

function doc(p: string, opts: Partial<DocCandidate> = {}): DocCandidate {
  return {
    path: p,
    absPath: '/abs/' + p,
    kind: opts.kind ?? 'prd',
    preview: opts.preview ?? '',
    lastTouched: opts.lastTouched ?? '2025-01-01T00:00:00Z',
    contentHash: opts.contentHash ?? 'h',
    size: opts.size ?? 100,
  };
}

function conflict(
  subject: string,
  candidateFiles: Array<{ file: string; docKind?: string }>,
): Conflict {
  return {
    id: `c-${subject}`,
    topic: 'auth',
    subject,
    candidates: candidateFiles.map((c, i) => ({
      index: i,
      weight: 'newest' as const,
      claim: {
        id: `claim-${i}`,
        topic: 'auth',
        subject,
        content: {},
        provenance: { file: c.file, line: 1, quote: '' },
        metadata: { docKind: (c.docKind ?? 'unknown') as DocCandidate['kind'], lastTouched: '2025-01-01T00:00:00Z' },
      },
    })),
    defaultPick: 0,
  };
}

describe('selectRecheckPairs — pair selection for chain re-check', () => {
  it('picks pairs of PRD candidates from different files on cross-cutting subjects', () => {
    const docs = [
      doc('docs/PRDs/v1.md'),
      doc('docs/PRDs/v2.md'),
      doc('docs/notes.md', { kind: 'unknown' }),
    ];
    const conflicts = [
      conflict('auth scheme', [
        { file: 'docs/PRDs/v1.md', docKind: 'prd' },
        { file: 'docs/PRDs/v2.md', docKind: 'prd' },
        { file: 'docs/notes.md', docKind: 'unknown' },
      ]),
    ];
    const pairs = selectRecheckPairs(conflicts, docs, new Set());
    expect(pairs).toHaveLength(1);
    expect(pairs[0].older.path).toBe('docs/PRDs/v1.md');
    expect(pairs[0].newer.path).toBe('docs/PRDs/v2.md');
  });

  it('skips non-fundamental subjects (per-endpoint, per-entity)', () => {
    const docs = [doc('docs/PRDs/v1.md'), doc('docs/PRDs/v2.md')];
    const conflicts = [
      conflict('GET /api/orders', [
        { file: 'docs/PRDs/v1.md', docKind: 'prd' },
        { file: 'docs/PRDs/v2.md', docKind: 'prd' },
      ]),
      conflict('core.invoiceitems / fields', [
        { file: 'docs/PRDs/v1.md', docKind: 'prd' },
        { file: 'docs/PRDs/v2.md', docKind: 'prd' },
      ]),
    ];
    const pairs = selectRecheckPairs(conflicts, docs, new Set());
    expect(pairs).toEqual([]);
  });

  it('skips conflicts with fewer than 2 PRD candidates', () => {
    const docs = [doc('docs/PRDs/v1.md'), doc('docs/notes.md', { kind: 'unknown' })];
    const conflicts = [
      conflict('auth scheme', [
        { file: 'docs/PRDs/v1.md', docKind: 'prd' },
        { file: 'docs/notes.md', docKind: 'unknown' },
      ]),
    ];
    expect(selectRecheckPairs(conflicts, docs, new Set())).toEqual([]);
  });

  it('skips pairs already covered by an existing chain', () => {
    const docs = [doc('docs/PRDs/v1.md'), doc('docs/PRDs/v2.md')];
    const conflicts = [
      conflict('auth scheme', [
        { file: 'docs/PRDs/v1.md', docKind: 'prd' },
        { file: 'docs/PRDs/v2.md', docKind: 'prd' },
      ]),
    ];
    const existing = existingChainPairKeys([
      { id: 'x', detectedFrom: 'filename', docs },
    ]);
    expect(selectRecheckPairs(conflicts, docs, existing)).toEqual([]);
  });

  it('orders the pair oldest → newest by lastTouched', () => {
    const docs = [
      doc('docs/PRDs/foo.md', { lastTouched: '2026-04-01T00:00:00Z' }),
      doc('docs/PRDs/bar.md', { lastTouched: '2025-01-01T00:00:00Z' }),
    ];
    const conflicts = [
      conflict('auth scheme', [
        { file: 'docs/PRDs/foo.md', docKind: 'prd' },
        { file: 'docs/PRDs/bar.md', docKind: 'prd' },
      ]),
    ];
    const pairs = selectRecheckPairs(conflicts, docs, new Set());
    expect(pairs).toHaveLength(1);
    // older (smaller lastTouched) first
    expect(pairs[0].older.path).toBe('docs/PRDs/bar.md');
    expect(pairs[0].newer.path).toBe('docs/PRDs/foo.md');
  });
});

describe('existingChainPairKeys — key derivation', () => {
  it('encodes both directions of each chain edge', () => {
    const docs = [doc('a.md'), doc('b.md')];
    const chain: VersionChain = { id: 'x', detectedFrom: 'filename', docs };
    const keys = existingChainPairKeys([chain]);
    expect(keys.has('a.md|b.md')).toBe(true);
    expect(keys.has('b.md|a.md')).toBe(true);
  });
});
