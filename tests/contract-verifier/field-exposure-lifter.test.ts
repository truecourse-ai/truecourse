import { describe, it, expect } from 'vitest';
import { parseTcFile as parseFile } from '../../packages/contract-verifier/src/parser-ohm/index.js';
import { resolve } from '../../packages/contract-verifier/src/resolver/index.js';
import type { FieldExposureContract } from '../../packages/contract-verifier/src/types/index.js';

function lift(src: string): FieldExposureContract {
  const file = parseFile('fe.tc', src);
  const r = resolve([file]);
  if (r.errors.length > 0) {
    throw new Error(`resolve errors: ${r.errors.map((e) => e.message).join('; ')}`);
  }
  const first = r.index.values().next().value!;
  expect(first.ref.type).toBe('FieldExposure');
  return first.contract as FieldExposureContract;
}

describe('FieldExposure lifter — .tc grammar', () => {
  it('lifts a full entity-field exposure with both channels and an operation binding', () => {
    const c = lift(`
field-exposure order.total-cents-exposed {
  origin SPEC.md "Order read API" 40..48
  field Entity:Order.totalCents
  via query-select
  via api-response
  in Operation:"GET /api/orders/{id}"
}
`);
    expect(c).toEqual({
      target: {
        entity: { type: 'Entity', identity: 'Order', quoted: false },
        field: 'totalCents',
      },
      exposedVia: ['query-select', 'api-response'],
      through: { type: 'Operation', identity: 'GET /api/orders/{id}', quoted: true },
    });
  });

  it('lifts a bare-field target (no entity binding) with no `in`', () => {
    const c = lift(`
field-exposure name-exposed {
  field displayName
  via api-response
}
`);
    expect(c.target).toEqual({ field: 'displayName' });
    expect(c.target.entity).toBeUndefined();
    expect(c.exposedVia).toEqual(['api-response']);
    expect(c.through).toBeUndefined();
  });

  it('accepts a bare ident as the `in` binding', () => {
    const c = lift(`
field-exposure x {
  field Entity:Order.status
  via query-select
  in getOrderById
}
`);
    expect(c.through).toEqual({ ident: 'getOrderById' });
  });

  it('dedupes a channel declared twice', () => {
    const c = lift(`field-exposure x { field Entity:Order.id via query-select via query-select }`);
    expect(c.exposedVia).toEqual(['query-select']);
  });

  it('keeps only the field segment of a dotted bare target', () => {
    const c = lift(`field-exposure y { field row.email via query-select }`);
    expect(c.target).toEqual({ field: 'email' });
  });

  it('preserves authored channel order', () => {
    const c = lift(`field-exposure z { field Entity:O.f via api-response via query-select }`);
    expect(c.exposedVia).toEqual(['api-response', 'query-select']);
  });

  it('never drops a channel-less exposure (surfaces empty exposedVia)', () => {
    const c = lift(`field-exposure w { field Entity:Order.id }`);
    expect(c.exposedVia).toEqual([]);
  });
});
