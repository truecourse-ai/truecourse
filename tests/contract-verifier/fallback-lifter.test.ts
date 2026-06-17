import { describe, it, expect } from 'vitest';
import { parseTcFile as parseFile } from '../../packages/contract-verifier/src/parser-ohm/index.js';
import { resolve } from '../../packages/contract-verifier/src/resolver/index.js';
import type { FallbackContract } from '../../packages/contract-verifier/src/types/index.js';

function lift(src: string): FallbackContract {
  const file = parseFile('fb.tc', src);
  const r = resolve([file]);
  if (r.errors.length > 0) {
    throw new Error(`resolve errors: ${r.errors.map((e) => e.message).join('; ')}`);
  }
  const first = r.index.values().next().value!;
  expect(first.ref.type).toBe('Fallback');
  return first.contract as FallbackContract;
}

describe('Fallback lifter — .tc grammar', () => {
  it('lifts a full entity-field fallback with a string default', () => {
    const c = lift(`
fallback reservation.currency-default {
  origin SPEC.md "Reservation defaults" 30..36
  target Entity:Reservation.currency
  when null-or-absent
  default "USD"
}
`);
    expect(c).toEqual({
      target: {
        entity: { type: 'Entity', identity: 'Reservation', quoted: false },
        field: 'currency',
      },
      trigger: 'null-or-absent',
      defaultValue: { kind: 'string', value: 'USD' },
    });
  });

  it('lifts a bare-input target (no entity binding)', () => {
    const c = lift(`
fallback locale-default {
  target locale
  when absent
  default "en-US"
}
`);
    expect(c.target).toEqual({ field: 'locale' });
    expect(c.target.entity).toBeUndefined();
    expect(c.trigger).toBe('absent');
    expect(c.defaultValue).toEqual({ kind: 'string', value: 'en-US' });
  });

  it('defaults trigger to null-or-absent when when-clause omitted', () => {
    const c = lift(`fallback x { target partySize default 2 }`);
    expect(c.trigger).toBe('null-or-absent');
    expect(c.defaultValue).toEqual({ kind: 'number', value: 2 });
  });

  it('honors the null and absent triggers', () => {
    expect(lift(`fallback a { target x when null default 0 }`).trigger).toBe('null');
    expect(lift(`fallback b { target x when absent default 0 }`).trigger).toBe('absent');
  });

  it('parses boolean, number, null, and identifier defaults', () => {
    expect(lift(`fallback a { target x default true }`).defaultValue).toEqual({
      kind: 'boolean',
      value: true,
    });
    expect(lift(`fallback b { target x default 42 }`).defaultValue).toEqual({
      kind: 'number',
      value: 42,
    });
    expect(lift(`fallback c { target x default null }`).defaultValue).toEqual({ kind: 'null' });
    // A bare identifier default is a named-constant / enum-member reference.
    expect(lift(`fallback d { target x default DEFAULT_TIMEZONE }`).defaultValue).toEqual({
      kind: 'identifier',
      ref: 'DEFAULT_TIMEZONE',
    });
  });

  it('keeps only the field segment of a dotted bare target', () => {
    const c = lift(`fallback e { target input.reason default "n/a" }`);
    expect(c.target).toEqual({ field: 'reason' });
  });

  it('never drops a default-less fallback (surfaces explicit null)', () => {
    const c = lift(`fallback f { target x when null }`);
    expect(c.defaultValue).toEqual({ kind: 'null' });
  });
});
