import { describe, it, expect } from 'vitest';
import { mergeFragments, mergeRankedFragments } from '../../packages/contract-extractor/src/merger.js';
import type { Fragment } from '../../packages/contract-extractor/src/types.js';

const make = (kind: string, identity: string, source = 'SPEC.md', lines: [number, number] = [1, 10]): Fragment => ({
  kind,
  identity,
  tcSource: `${kind.toLowerCase()} ${identity} { origin ${source} "x" ${lines[0]}..${lines[1]} }`,
  origin: { source, section: 'x', lines },
  obligationKeys: [],
});

describe('fragment merger (Phase 8 compatibility shim)', () => {
  it('groups fragments by (kind, identity) and picks the first as winner', () => {
    const a = make('Operation', 'POST /api/orders', 'SPEC.md', [10, 20]);
    const b = make('Entity', 'Order');
    const merged = mergeFragments([a, b]);
    expect(merged.artifacts).toHaveLength(2);
    const op = merged.artifacts.find((m) => m.kind === 'Operation')!;
    expect(op.winning).toBe(a);
    expect(op.overridden).toEqual([]);
    expect(op.sameRankConflicts).toEqual([]);
  });

  it('flags two same-(kind,identity) fragments with different bodies as a conflict', () => {
    const a = make('Operation', 'POST /api/orders', 'SPEC.md', [10, 20]);
    const b = { ...make('Operation', 'POST /api/orders', 'docs/rfc.md', [5, 15]), tcSource: 'OPERATION B' };
    const merged = mergeFragments([a, b]);
    expect(merged.artifacts).toHaveLength(1);
    const op = merged.artifacts[0];
    expect(op.winning).toBe(a);
    expect(op.sameRankConflicts).toEqual([b]);
    const conflicts = merged.diagnostics.filter((d) => d.severity === 'error');
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].artifactKey).toBe('Operation:POST /api/orders');
  });

  it('treats different kinds with the same identity as separate artifacts', () => {
    // Real example: `Entity:Order` and `StateMachine:Order` would coincide
    // on identity if we keyed on identity alone — keying on (kind, identity)
    // keeps them distinct.
    const entity = make('Entity', 'Order');
    const machine = make('StateMachine', 'Order.status');
    const merged = mergeFragments([entity, machine]);
    expect(merged.artifacts).toHaveLength(2);
  });

  it('returns an empty result for an empty input', () => {
    const merged = mergeFragments([]);
    expect(merged.artifacts).toEqual([]);
    expect(merged.diagnostics).toEqual([]);
  });

  it('treats two same-(kind,identity) fragments with identical bodies as one', () => {
    // The merger only flags conflicts when the bodies actually differ —
    // duplicate emissions of the same artifact (e.g. an LLM that produced
    // a fragment twice from the same slice) should not raise diagnostics.
    const a = make('Operation', 'POST /api/orders');
    const b = { ...a };
    const merged = mergeFragments([a, b]);
    expect(merged.artifacts).toHaveLength(1);
    expect(merged.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
  });
});

describe('rank-aware merger (Phase 11)', () => {
  function rf(rank: number, kind: string, identity: string, body: string, source = 'SPEC.md'): { fragment: Fragment; rank: number } {
    return {
      rank,
      fragment: {
        kind,
        identity,
        tcSource: body,
        origin: { source, section: 'x', lines: [1, 10] },
        obligationKeys: [],
      },
    };
  }

  it('higher rank wins outright', () => {
    const a = rf(0, 'Operation', 'POST /api/orders', 'BASE', 'SPEC.md');
    const b = rf(2, 'Operation', 'POST /api/orders', 'OVERRIDE', 'rfc.md');
    const merged = mergeRankedFragments([a, b]);
    const op = merged.artifacts[0];
    expect(op.winning.tcSource).toBe('OVERRIDE');
    expect(op.winningRank).toBe(2);
    expect(op.overridden).toEqual([a]);
    expect(merged.diagnostics.some((d) => d.severity === 'info')).toBe(true);
  });

  it('records every lower-rank fragment as overridden, sorted by rank', () => {
    const r0 = rf(0, 'Operation', 'POST /api/orders', 'V0', 'SPEC.md');
    const r1 = rf(1, 'Operation', 'POST /api/orders', 'V1', 'adr.md');
    const r2 = rf(2, 'Operation', 'POST /api/orders', 'V2', 'rfc.md');
    const merged = mergeRankedFragments([r0, r1, r2]);
    const op = merged.artifacts[0];
    expect(op.winning.tcSource).toBe('V2');
    expect(op.overridden.map((rf) => rf.rank)).toEqual([1, 0]);
  });

  it('flags same-rank disagreement as a conflict diagnostic', () => {
    const a = rf(1, 'Operation', 'POST /api/orders', 'A', 'adr-1.md');
    const b = rf(1, 'Operation', 'POST /api/orders', 'B', 'adr-2.md');
    const merged = mergeRankedFragments([a, b]);
    const errs = merged.diagnostics.filter((d) => d.severity === 'error');
    expect(errs).toHaveLength(1);
    expect(errs[0].artifactKey).toBe('Operation:POST /api/orders');
    expect(errs[0].message).toMatch(/Same-rank conflict/);
  });

  it('does not flag a conflict when same-rank fragments agree', () => {
    const a = rf(1, 'Operation', 'POST /api/orders', 'SAME', 'adr-1.md');
    const b = rf(1, 'Operation', 'POST /api/orders', 'SAME', 'adr-2.md');
    const merged = mergeRankedFragments([a, b]);
    expect(merged.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('groups by (kind, identity) — different kinds with same identity stay separate', () => {
    const e = rf(0, 'Entity', 'Order', 'E');
    const sm = rf(0, 'StateMachine', 'Order', 'SM');
    const merged = mergeRankedFragments([e, sm]);
    expect(merged.artifacts).toHaveLength(2);
  });
});
