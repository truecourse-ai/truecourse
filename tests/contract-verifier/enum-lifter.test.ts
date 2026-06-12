import { describe, it, expect } from 'vitest';
import { parseFile } from '../../packages/contract-verifier/src/parser/index.js';
import { resolve } from '../../packages/contract-verifier/src/resolver/index.js';
import type { EnumContract } from '../../packages/contract-verifier/src/types/index.js';

function lift(src: string): EnumContract {
  const r = resolve([parseFile('e.tc', src)]);
  if (r.errors.length > 0) throw new Error(r.errors.map((e) => e.message).join('; '));
  return r.index.values().next().value!.contract as EnumContract;
}

describe('Enum lifter', () => {
  it('lifts a minimal enum with just values', () => {
    const c = lift(`enum X { values [a, b, c] }`);
    expect(c.values).toEqual(['a', 'b', 'c']);
    expect(c.representation).toBe('string-literal');
    expect(c.closed).toBe(true);
    expect(c.triggerSubsets).toBeUndefined();
  });

  it('lifts trigger-subset declarations', () => {
    const c = lift(`enum SignatureClassification {
      values [PASS, MISSING, PARTIAL, SUSPECT, OUTLIER]
      trigger-subset flagging [MISSING, PARTIAL, SUSPECT, OUTLIER]
      trigger-subset non-pass [MISSING, PARTIAL, SUSPECT, OUTLIER]
    }`);
    expect(c.values).toEqual(['PASS', 'MISSING', 'PARTIAL', 'SUSPECT', 'OUTLIER']);
    expect(c.triggerSubsets).toEqual([
      { name: 'flagging', values: ['MISSING', 'PARTIAL', 'SUSPECT', 'OUTLIER'] },
      { name: 'non-pass', values: ['MISSING', 'PARTIAL', 'SUSPECT', 'OUTLIER'] },
    ]);
  });

  it('respects representation integer + open', () => {
    const c = lift(`enum N {
      representation integer
      open
      values [1, 2, 3]
    }`);
    expect(c.representation).toBe('integer');
    expect(c.closed).toBe(false);
  });

  it('accepts quoted string values in lists', () => {
    const c = lift(`enum S { values ["with space", "another"] }`);
    expect(c.values).toEqual(['with space', 'another']);
  });

  it('lifts per-value labels', () => {
    const c = lift(`enum CancellationReasonRequirement {
      values [MANDATORY_BOTH, MANDATORY_HOST_ONLY, MANDATORY_ATTENDEE_ONLY, OPTIONAL_BOTH]
      value MANDATORY_BOTH "Mandatory for both"
      value MANDATORY_HOST_ONLY "Mandatory for host only"
      value MANDATORY_ATTENDEE_ONLY "Mandatory for attendee only"
      value OPTIONAL_BOTH "Optional for both"
    }`);
    expect(c.values).toEqual([
      'MANDATORY_BOTH',
      'MANDATORY_HOST_ONLY',
      'MANDATORY_ATTENDEE_ONLY',
      'OPTIONAL_BOTH',
    ]);
    expect(c.valueLabels).toEqual({
      MANDATORY_BOTH: 'Mandatory for both',
      MANDATORY_HOST_ONLY: 'Mandatory for host only',
      MANDATORY_ATTENDEE_ONLY: 'Mandatory for attendee only',
      OPTIONAL_BOTH: 'Optional for both',
    });
  });

  it('adds a labeled value missing from the values list', () => {
    const c = lift(`enum X {
      values [a]
      value b "Bee"
    }`);
    expect(c.values).toEqual(['a', 'b']);
    expect(c.valueLabels).toEqual({ b: 'Bee' });
  });

  it('omits valueLabels when no value clause is present', () => {
    const c = lift(`enum X { values [a, b] }`);
    expect(c.valueLabels).toBeUndefined();
  });

  it('coexists with trigger-subset declarations', () => {
    const c = lift(`enum S {
      values [PASS, MISSING]
      value MISSING "Signature missing"
      trigger-subset flagging [MISSING]
    }`);
    expect(c.valueLabels).toEqual({ MISSING: 'Signature missing' });
    expect(c.triggerSubsets).toEqual([{ name: 'flagging', values: ['MISSING'] }]);
  });
});
