import { describe, it, expect } from 'vitest';
import {
  decideGate,
  decideCodeQuality,
  type GateDecision,
} from '../../ee/packages/github-app/src/index';

function violation(severity: string, over: Record<string, unknown> = {}): any {
  return { id: 'v', ruleKey: 'r', severity, title: 't', filePath: 'f.ts', ...over };
}

function drift(obligationKey: string, over: Record<string, unknown> = {}): any {
  return {
    id: `id-${obligationKey}`,
    artifactRef: { type: 'Operation', identity: 'GET /a' },
    obligationKey,
    severity: 'high',
    filePath: 'src/a.ts',
    lineStart: 10,
    lineEnd: 12,
    message: `drift ${obligationKey}`,
    ...over,
  };
}

describe('decideGate', () => {
  it('passes when no new drift is introduced', () => {
    const d: GateDecision = decideGate([drift('a')], [drift('a')], { blocking: true });
    expect(d.conclusion).toBe('success');
    expect(d.added).toHaveLength(0);
  });

  it('fails (blocking) when the PR introduces new drift', () => {
    const d = decideGate([drift('a')], [drift('a'), drift('b')], { blocking: true });
    expect(d.conclusion).toBe('failure');
    expect(d.added.map((x) => x.obligationKey)).toEqual(['b']);
  });

  it('is neutral (advisory) for new drift when blocking is off', () => {
    const d = decideGate([], [drift('b')], { blocking: false });
    expect(d.conclusion).toBe('neutral');
    expect(d.added).toHaveLength(1);
    expect(d.neutralReason).toBeUndefined();
  });

  it('reports resolved drift and still passes', () => {
    const d = decideGate([drift('a'), drift('b')], [drift('a')], { blocking: true });
    expect(d.conclusion).toBe('success');
    expect(d.resolved.map((x) => x.obligationKey)).toEqual(['b']);
  });

  it('is neutral with no-contracts reason when the head has no contracts', () => {
    const d = decideGate([drift('a')], null, { blocking: true });
    expect(d.conclusion).toBe('neutral');
    expect(d.neutralReason).toBe('no-contracts');
  });

  it('is neutral (no-baseline) when the base has no contracts', () => {
    const d = decideGate(null, [drift('a')], { blocking: true });
    expect(d.conclusion).toBe('neutral');
    expect(d.neutralReason).toBe('no-baseline');
    expect(d.added).toHaveLength(0);
  });

  it('FAILS (blocking) when the head spec has open conflicts', () => {
    const d = decideGate([], [drift('b')], { blocking: true, unresolvedConflicts: 2 });
    expect(d.conclusion).toBe('failure'); // blocking repo: unresolved conflicts block the PR
    expect(d.neutralReason).toBe('unresolved-conflicts');
    expect(d.unresolvedConflicts).toBe(2);
    expect(d.added).toHaveLength(0); // not gated on drift — the spec is ambiguous
  });

  it('is neutral (advisory) for open conflicts when blocking is off', () => {
    const d = decideGate([], [drift('b')], { blocking: false, unresolvedConflicts: 2 });
    expect(d.conclusion).toBe('neutral');
    expect(d.neutralReason).toBe('unresolved-conflicts');
  });

  it('prioritizes unresolved-conflicts over a no-baseline reason', () => {
    // Even with no base to diff, an unresolved spec is the more actionable reason.
    const d = decideGate(null, [drift('b')], { blocking: true, unresolvedConflicts: 1 });
    expect(d.neutralReason).toBe('unresolved-conflicts');
    expect(d.conclusion).toBe('failure');
  });

  it('ignores a zero conflict count (normal gating proceeds)', () => {
    const d = decideGate([drift('a')], [drift('a'), drift('b')], {
      blocking: true,
      unresolvedConflicts: 0,
    });
    expect(d.conclusion).toBe('failure');
    expect(d.neutralReason).toBeUndefined();
  });

  it('honors the severity threshold', () => {
    const base: any[] = [];
    const head = [drift('low1', { severity: 'low' }), drift('crit', { severity: 'critical' })];
    const d = decideGate(base, head, { blocking: true, minSeverity: 'high' });
    expect(d.conclusion).toBe('failure');
    expect(d.added.map((x) => x.obligationKey)).toEqual(['crit']);
    expect(d.belowThreshold.map((x) => x.obligationKey)).toEqual(['low1']);
  });

  it('passes when all new drift is below the threshold', () => {
    const d = decideGate([], [drift('low1', { severity: 'low' })], {
      blocking: true,
      minSeverity: 'high',
    });
    expect(d.conclusion).toBe('success');
    expect(d.belowThreshold).toHaveLength(1);
  });
});

describe('decideCodeQuality', () => {
  it('neutral (no-baseline) when there is no baseline analysis (null or undefined)', () => {
    expect(decideCodeQuality(null, { blocking: true }).conclusion).toBe('neutral');
    expect(decideCodeQuality(null, { blocking: true }).neutralReason).toBe('no-baseline');
    expect(decideCodeQuality(undefined, { blocking: true }).conclusion).toBe('neutral');
  });

  it('success when the PR introduces no new violations', () => {
    expect(decideCodeQuality([], { blocking: true }).conclusion).toBe('success');
  });

  it('fails (blocking) on new violations at/above the default high threshold', () => {
    const d = decideCodeQuality([violation('high'), violation('critical')], { blocking: true });
    expect(d.conclusion).toBe('failure');
    expect(d.added).toHaveLength(2);
    expect(d.total).toBe(2);
  });

  it('new violations below the threshold count but do not fail', () => {
    const d = decideCodeQuality([violation('low'), violation('medium')], { blocking: true });
    expect(d.conclusion).toBe('success');
    expect(d.added).toHaveLength(0);
    expect(d.belowThreshold).toHaveLength(2);
    expect(d.total).toBe(2);
  });

  it('honours a custom minSeverity', () => {
    expect(decideCodeQuality([violation('medium')], { blocking: true, minSeverity: 'medium' }).conclusion).toBe('failure');
    expect(decideCodeQuality([violation('low')], { blocking: true, minSeverity: 'medium' }).conclusion).toBe('success');
  });

  it('advisory (non-blocking) reports neutral instead of failure', () => {
    expect(decideCodeQuality([violation('critical')], { blocking: false }).conclusion).toBe('neutral');
  });
});
