import { describe, it, expect } from 'vitest';
import { decideCodeQuality } from '../../ee/packages/github-app/src/index';

function violation(severity: string, over: Record<string, unknown> = {}): any {
  return { id: 'v', ruleKey: 'r', severity, title: 't', filePath: 'f.ts', ...over };
}

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
