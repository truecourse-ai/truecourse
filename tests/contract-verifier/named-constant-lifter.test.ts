import { describe, it, expect } from 'vitest';
import { parseFile } from '../../packages/contract-verifier/src/parser/index.js';
import { resolve } from '../../packages/contract-verifier/src/resolver/index.js';
import type { NamedConstantContract } from '../../packages/contract-verifier/src/types/index.js';

function lift(src: string): NamedConstantContract {
  const r = resolve([parseFile('c.tc', src)]);
  if (r.errors.length > 0) throw new Error(r.errors.map((e) => e.message).join('; '));
  return r.index.values().next().value!.contract as NamedConstantContract;
}

describe('NamedConstant lifter', () => {
  it('lifts a string-typed constant', () => {
    const c = lift(`constant LLM_MODEL {
      type string
      expected-value "claude-sonnet-4-6"
    }`);
    expect(c).toEqual({ type: 'string', expectedValue: 'claude-sonnet-4-6' });
  });

  it('lifts a number-typed constant', () => {
    const c = lift(`constant MAX_RETRY {
      type number
      expected-value 5
    }`);
    expect(c).toEqual({ type: 'number', expectedValue: 5 });
  });

  it('lifts a boolean-typed constant', () => {
    const c = lift(`constant DEBUG {
      type boolean
      expected-value true
    }`);
    expect(c).toEqual({ type: 'boolean', expectedValue: true });
  });

  it('lifts an array-typed constant', () => {
    const c = lift(`constant ALLOWED_STATUS {
      type array
      expected-value [active, pending, archived]
    }`);
    expect(c.type).toBe('array');
    expect(c.expectedValue).toEqual(['active', 'pending', 'archived']);
  });

  it('lifts an object-typed constant from a block expected-value', () => {
    const c = lift(`constant TIER_WEIGHTS {
      type object
      expected-value {
        Critical: 3
        Significant: 2
        Noticeable: 1
        Moderate: 1
        Minor: 1
        "Out of Tech Control": 0.5
      }
    }`);
    expect(c.type).toBe('object');
    expect(c.expectedValue).toEqual({
      Critical: 3,
      Significant: 2,
      Noticeable: 1,
      Moderate: 1,
      Minor: 1,
      'Out of Tech Control': 0.5,
    });
  });

  it('defaults type to string when omitted', () => {
    const c = lift(`constant MODEL {
      expected-value "claude-sonnet-4-6"
    }`);
    expect(c.type).toBe('string');
    expect(c.expectedValue).toBe('claude-sonnet-4-6');
  });
});
