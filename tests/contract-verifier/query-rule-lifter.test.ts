import { describe, it, expect } from 'vitest';
import { parseTcFile as parseFile } from '../../packages/contract-verifier/src/parser-ohm/index.js';
import { resolve } from '../../packages/contract-verifier/src/resolver/index.js';
import type { QueryRuleContract } from '../../packages/contract-verifier/src/types/index.js';

function lift(src: string): QueryRuleContract {
  const file = parseFile('test.tc', src);
  const r = resolve([file]);
  if (r.errors.length > 0) {
    throw new Error(`resolve errors: ${r.errors.map((e) => e.message).join('; ')}`);
  }
  const first = r.index.values().next().value!;
  expect(first.ref.type).toBe('QueryRule');
  return first.contract as QueryRuleContract;
}

describe('QueryRule lifter — .tc grammar', () => {
  it('lifts a minimal rule with entity + one required null predicate', () => {
    const c = lift(`
query-rule warranty.must-flag {
  entity Entity:core.jobs
  required {
    is-not-null jobs.warranty_id
  }
}
`);
    expect(c.entity.identity).toBe('core.jobs');
    expect(c.required).toHaveLength(1);
    expect(c.required[0]).toEqual({
      kind: 'is-not-null',
      column: { table: 'jobs', column: 'warranty_id' },
    });
    expect(c.forbidden).toHaveLength(0);
  });

  it('parses every predicate kind into the right Predicate shape', () => {
    const c = lift(`
query-rule all-predicates {
  entity Entity:core.jobs
  required {
    is-null jobs.deleted_at
    is-not-null jobs.invoice_id
    eq jobs.status "Completed"
    neq jobs.archived true
    gt jobs.total_cents 0
    gte jobs.total_cents 100
    lt jobs.total_cents 1000000
    lte jobs.total_cents 999999
    in jobs.market_id [1, 2, 3]
    not-in jobs.business_unit ["other", "door_sales"]
    between jobs.created_year 2020 2026
    like jobs.skuname "ARC-%"
    ilike jobs.skuname "%spring%"
    raw "EXISTS (SELECT 1 FROM ...)"
  }
}
`);
    const kinds = c.required.map((p) => p.kind);
    expect(kinds).toEqual([
      'is-null', 'is-not-null', 'eq', 'neq', 'gt', 'gte', 'lt', 'lte',
      'in', 'not-in', 'between', 'like', 'ilike', 'raw',
    ]);

    const eqStatus = c.required.find((p) => p.kind === 'eq')!;
    expect(eqStatus).toMatchObject({
      kind: 'eq',
      column: { table: 'jobs', column: 'status' },
      value: { kind: 'string', value: 'Completed' },
    });

    const neqArchived = c.required.find((p) => p.kind === 'neq')!;
    expect((neqArchived as { value: { kind: string; value: boolean } }).value).toEqual({
      kind: 'boolean',
      value: true,
    });

    const inMarket = c.required.find((p) => p.kind === 'in')!;
    expect((inMarket as { values: { kind: string; value: number }[] }).values).toEqual([
      { kind: 'number', value: 1 },
      { kind: 'number', value: 2 },
      { kind: 'number', value: 3 },
    ]);

    const between = c.required.find((p) => p.kind === 'between')!;
    expect(between).toMatchObject({
      kind: 'between',
      column: { table: 'jobs', column: 'created_year' },
      low: { kind: 'number', value: 2020 },
      high: { kind: 'number', value: 2026 },
    });

    const ilike = c.required.find((p) => p.kind === 'ilike')!;
    expect(ilike).toMatchObject({
      kind: 'ilike',
      column: { table: 'jobs', column: 'skuname' },
      pattern: '%spring%',
    });

    const raw = c.required.find((p) => p.kind === 'raw')!;
    expect((raw as { sql: string }).sql).toBe('EXISTS (SELECT 1 FROM ...)');
  });

  it('separates required from forbidden blocks', () => {
    const c = lift(`
query-rule split {
  entity Entity:core.jobs
  required {
    eq jobs.status "Completed"
  }
  forbidden {
    is-null jobs.warranty_id
  }
}
`);
    expect(c.required).toHaveLength(1);
    expect(c.forbidden).toHaveLength(1);
    expect(c.required[0].kind).toBe('eq');
    expect(c.forbidden[0].kind).toBe('is-null');
  });

  it('lifts bound-to + date-range-binding', () => {
    const c = lift(`
query-rule bound {
  bound-to Operation:"GET /api/v1/infractions/no-payment-collected"
  entity Entity:core.jobs
  date-range-binding column invoices.createdon
  required {
    is-not-null invoices.balance
  }
}
`);
    expect(c.boundToOperation).toEqual({
      type: 'Operation',
      identity: 'GET /api/v1/infractions/no-payment-collected',
      quoted: true,
    });
    expect(c.dateRangeBinding).toEqual({
      column: { table: 'invoices', column: 'createdon' },
    });
  });

  it('handles schema-qualified column names (last-dot split)', () => {
    const c = lift(`
query-rule schema-qualified {
  entity Entity:compliance.infraction_summary
  required {
    is-not-null compliance.infraction_summary.score
  }
}
`);
    expect(c.required[0]).toEqual({
      kind: 'is-not-null',
      column: { table: 'compliance.infraction_summary', column: 'score' },
    });
  });

  it('handles unqualified column (column-only, no table)', () => {
    const c = lift(`
query-rule unqualified {
  entity Entity:core.jobs
  required {
    is-not-null balance
  }
}
`);
    expect(c.required[0]).toEqual({
      kind: 'is-not-null',
      column: { column: 'balance' },
    });
  });

  it('parses null and identifier literals (NOW(), CURRENT_DATE)', () => {
    const c = lift(`
query-rule literal-shapes {
  entity Entity:core.jobs
  required {
    eq jobs.archived_at null
    gt jobs.completedon NOW()
  }
}
`);
    expect((c.required[0] as { value: { kind: string } }).value).toEqual({ kind: 'null' });
    expect((c.required[1] as { value: { kind: string; ref: string } }).value).toEqual({
      kind: 'identifier',
      ref: 'NOW()',
    });
  });

  it('preserves unrecognized predicate keywords as raw', () => {
    const c = lift(`
query-rule unknown-kw {
  entity Entity:core.jobs
  required {
    overlaps jobs.range "[2020-01-01, 2021-01-01)"
  }
}
`);
    expect(c.required[0].kind).toBe('raw');
    expect((c.required[0] as { sql: string }).sql).toContain('overlaps');
  });
});
