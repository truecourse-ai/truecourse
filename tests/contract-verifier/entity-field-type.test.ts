/**
 * Entity field types: the closed format/primitive sets (`uuid`, `integer`, …) don't
 * name every scalar the prose uses — `timestamp`, `datetime`, etc. The grammar must
 * accept a plain type identifier for an entity field (as operation fields already do),
 * otherwise one unlisted type token makes the WHOLE entity fail to parse and get
 * silently dropped — leaving every `Entity:X.field` reference unresolved.
 */

import { describe, it, expect } from 'vitest';
import { parseTcFile } from '../../packages/contract-verifier/src/parser-ohm/index.js';
import { resolve } from '../../packages/contract-verifier/src/resolver/index.js';
import type { EntityContract } from '../../packages/contract-verifier/src/types/index.js';

const entity = (fields: string) =>
  `entity Order {\n  origin "p.md" "Order" 1..2\n${fields}\n}\n`;

describe('entity field types — strict grammar accepts descriptive scalars', () => {
  it('parses and resolves an entity with `timestamp` fields (the regression case)', () => {
    const tc = entity(
      [
        '  field id: uuid { immutable }',
        '  field totalCents: integer >= 0 { immutable }',
        '  field placedAt: timestamp { immutable }',
        '  field updatedAt: timestamp',
      ].join('\n'),
    );
    const r = resolve([parseTcFile('order.tc', tc)]);
    expect(r.errors).toHaveLength(0);
    expect(r.index.has('Entity:Order')).toBe(true);

    // Surviving isn't enough — the `timestamp` fields must actually be CAPTURED,
    // not silently skipped by the lifter. All four fields are present, and the
    // descriptive `timestamp` type is recorded (format sugar on a string primitive,
    // same shape as iso-8601).
    const fields = (r.index.get('Entity:Order')?.contract as EntityContract | undefined)?.fields ?? {};
    expect(Object.keys(fields).sort()).toEqual(['id', 'placedAt', 'totalCents', 'updatedAt']);
    expect(fields.placedAt?.type).toEqual({ kind: 'format', primitive: 'string', format: 'timestamp' });
    expect(fields.updatedAt?.type).toEqual({ kind: 'format', primitive: 'string', format: 'timestamp' });
  });

  it('still accepts the known formats/primitives and references', () => {
    const tc = entity(
      [
        '  field id: uuid',
        '  field email: email',
        '  field createdAt: iso-8601',
        '  field count: integer',
        '  field customerId: uuid references Entity:Customer',
      ].join('\n'),
    );
    // Customer isn't in the corpus, so its reference is the only unresolved ref —
    // the point is the entity itself parses and is indexed.
    const r = resolve([parseTcFile('order.tc', tc)]);
    expect(r.errors).toHaveLength(0);
    expect(r.index.has('Entity:Order')).toBe(true);
  });
});

describe('entity field modifiers — strict grammar accepts the clauses the prompt mandates', () => {
  it('accepts `computed-at` on a field (prompt: emit BOTH computed-at AND immutable)', () => {
    // The generator emits `computed-at order-creation` on computed fields exactly
    // as the extraction prompt instructs. `computed-at` existed in the grammar for
    // formulas but not for entity fields, so one such field made the WHOLE entity
    // fail to parse → dropped → every `Entity:Order.<field>` reference unresolved.
    const tc = entity(
      [
        '  field id: uuid { immutable }',
        '  field discountCents: integer {',
        '    computed-at order-creation',
        '    immutable',
        '  }',
        '  field taxCents: integer { computed-at order-creation immutable }',
      ].join('\n'),
    );
    const r = resolve([parseTcFile('order.tc', tc)]);
    expect(r.errors).toHaveLength(0);
    const fields = (r.index.get('Entity:Order')?.contract as EntityContract | undefined)?.fields ?? {};
    expect(Object.keys(fields).sort()).toEqual(['discountCents', 'id', 'taxCents']);
    // The field survives with its other modifiers intact (computed-at is advisory
    // metadata the comparator doesn't diff, so it's parsed-and-ignored).
    expect(fields.discountCents?.type).toEqual({ kind: 'primitive', primitive: 'integer' });
    expect(fields.discountCents?.mutability).toBe('immutable');
    expect(fields.taxCents?.mutability).toBe('immutable');
  });
});
