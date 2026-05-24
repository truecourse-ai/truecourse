import { describe, it, expect, beforeAll } from 'vitest';
import { initParsers, parseFile } from '../../packages/analyzer/src/index.js';
import { extractKnexQueriesFromFile } from '../../packages/contract-verifier/src/extractor/query/knex.js';
import type { ExtractedQuery } from '../../packages/contract-verifier/src/extractor/query/types.js';

beforeAll(async () => {
  await initParsers();
});

function extract(source: string, filePath = '/test/query.ts'): ExtractedQuery[] {
  const tree = parseFile(filePath, source, 'typescript');
  return extractKnexQueriesFromFile(filePath, source, tree);
}

describe('Knex query extractor', () => {
  it('extracts a simple two-arg .where as an eq predicate', () => {
    const q = extract(`
      async function f() {
        return db('jobs').where('status', 'Completed');
      }
    `);
    expect(q).toHaveLength(1);
    expect(q[0].entity).toEqual({ table: 'jobs' });
    expect(q[0].adapter).toBe('knex');
    expect(q[0].predicates).toEqual([
      { kind: 'eq', column: { column: 'status' }, value: { kind: 'string', value: 'Completed' } },
    ]);
    expect(q[0].unparseable).toEqual([]);
  });

  it('extracts table alias `table as t`', () => {
    const q = extract(`db('jobs as j').where('j.status', 'Completed');`);
    expect(q[0].entity).toEqual({ table: 'jobs', alias: 'j' });
    expect(q[0].predicates[0]).toEqual({
      kind: 'eq',
      column: { table: 'j', column: 'status' },
      value: { kind: 'string', value: 'Completed' },
    });
  });

  it('extracts .where(col, op, val) for >=, <, =, !=, <>', () => {
    const q = extract(`
      db('jobs')
        .where('total', '>=', 100)
        .where('total', '<', 1000)
        .where('name', '!=', 'foo')
        .where('archived', '=', false);
    `);
    expect(q).toHaveLength(1);
    const kinds = q[0].predicates.map((p) => p.kind);
    expect(kinds).toEqual(['gte', 'lt', 'neq', 'eq']);
  });

  it('extracts .where({col1: v1, col2: v2}) object form as multiple eq predicates', () => {
    const q = extract(`
      db('jobs').where({status: 'Completed', archived: false});
    `);
    expect(q[0].predicates).toEqual([
      { kind: 'eq', column: { column: 'status' }, value: { kind: 'string', value: 'Completed' } },
      { kind: 'eq', column: { column: 'archived' }, value: { kind: 'boolean', value: false } },
    ]);
  });

  it('extracts .whereIn / .whereNotIn / .whereNull / .whereNotNull', () => {
    const q = extract(`
      db('jobs')
        .whereIn('market_id', [1, 2, 3])
        .whereNotIn('business_unit', ['other', 'door_sales'])
        .whereNull('archived_at')
        .whereNotNull('invoice_id');
    `);
    const preds = q[0].predicates;
    expect(preds[0]).toEqual({
      kind: 'in',
      column: { column: 'market_id' },
      values: [
        { kind: 'number', value: 1 },
        { kind: 'number', value: 2 },
        { kind: 'number', value: 3 },
      ],
    });
    expect(preds[1].kind).toBe('not-in');
    expect(preds[2]).toEqual({ kind: 'is-null', column: { column: 'archived_at' } });
    expect(preds[3]).toEqual({ kind: 'is-not-null', column: { column: 'invoice_id' } });
  });

  it('extracts .whereBetween into between predicate', () => {
    const q = extract(`db('jobs').whereBetween('created_year', [2020, 2026]);`);
    expect(q[0].predicates[0]).toEqual({
      kind: 'between',
      column: { column: 'created_year' },
      low: { kind: 'number', value: 2020 },
      high: { kind: 'number', value: 2026 },
    });
  });

  it('extracts .whereLike / .whereILike', () => {
    const q = extract(`
      db('jobs').whereLike('skuname', 'ARC-%').whereILike('skuname', '%spring%');
    `);
    expect(q[0].predicates[0]).toEqual({
      kind: 'like',
      column: { column: 'skuname' },
      pattern: 'ARC-%',
    });
    expect(q[0].predicates[1].kind).toBe('ilike');
  });

  it('extracts .whereRaw into a raw predicate (opaque)', () => {
    const q = extract(`db('jobs').whereRaw('total > total_paid * 1.1');`);
    expect(q[0].predicates).toEqual([
      { kind: 'raw', sql: "'total > total_paid * 1.1'" },
    ]);
  });

  it('extracts .whereNot positional and object forms', () => {
    const q = extract(`
      db('jobs').whereNot('status', 'Cancelled').whereNot({archived: true});
    `);
    expect(q[0].predicates).toEqual([
      { kind: 'neq', column: { column: 'status' }, value: { kind: 'string', value: 'Cancelled' } },
      { kind: 'neq', column: { column: 'archived' }, value: { kind: 'boolean', value: true } },
    ]);
  });

  it('marks .orWhere as unparseable (OR semantics deferred)', () => {
    const q = extract(`db('jobs').where('a', 1).orWhere('b', 2);`);
    expect(q[0].predicates).toHaveLength(1);
    expect(q[0].unparseable).toHaveLength(1);
    expect(q[0].unparseable[0].reason).toContain('orWhere');
  });

  it('marks callback sub-builder as unparseable', () => {
    const q = extract(`db('jobs').where((qb) => qb.where('a', 1).orWhere('b', 2));`);
    expect(q[0].unparseable.length).toBeGreaterThanOrEqual(1);
  });

  it('recognises db.from("table") root style', () => {
    const q = extract(`db.from('jobs').where('status', 'Completed');`);
    expect(q[0].entity.table).toBe('jobs');
    expect(q[0].predicates).toHaveLength(1);
  });

  it('recognises knex(...) root in addition to db(...)', () => {
    const q = extract(`knex('jobs').where('id', 1);`);
    expect(q[0].entity.table).toBe('jobs');
  });

  it('extracts schema-qualified column references (last-dot split)', () => {
    const q = extract(`db('jobs').where('compliance.audit.score', '>', 0);`);
    expect(q[0].predicates[0]).toMatchObject({
      kind: 'gt',
      column: { table: 'compliance.audit', column: 'score' },
    });
  });

  it('detects date-range binding when a column has both lower and upper bound predicates', () => {
    const q = extract(`
      db('jobs')
        .where('completedon', '>=', startDate)
        .where('completedon', '<', endDate);
    `);
    expect(q[0].dateRangeBinding).toEqual({
      column: { column: 'completedon' },
    });
  });

  it('treats variable identifiers as parameter literals (not unparseable)', () => {
    const q = extract(`db('jobs').where('id', myId);`);
    expect(q[0].predicates[0]).toMatchObject({
      kind: 'eq',
      column: { column: 'id' },
      value: { kind: 'parameter', name: 'myId' },
    });
    expect(q[0].unparseable).toEqual([]);
  });

  it('treats member-expression args (req.query.x) as identifier literals', () => {
    const q = extract(`db('jobs').where('status', req.query.status);`);
    expect(q[0].predicates[0]).toMatchObject({
      kind: 'eq',
      value: { kind: 'identifier', ref: 'req.query.status' },
    });
  });

  it('extracts multiple chains in one file as separate queries', () => {
    const q = extract(`
      async function a() { return db('jobs').where('a', 1); }
      async function b() { return db('invoices').where('b', 2); }
    `);
    expect(q).toHaveLength(2);
    expect(q.map((r) => r.entity.table).sort()).toEqual(['invoices', 'jobs']);
  });

  it('records source location at the outer call line', () => {
    const src = `// line 1
async function f() {
  return db('jobs')
    .where('status', 'Completed')
    .whereNull('archived_at');
}
`;
    const q = extract(src);
    expect(q[0].source.lineStart).toBe(3);
    // outermost call closes on whichever line .whereNull is on
    expect(q[0].source.lineEnd).toBeGreaterThanOrEqual(5);
  });

  it('ignores non-Knex call chains (foo("table").where(…))', () => {
    const q = extract(`foo('jobs').where('a', 1);`);
    expect(q).toEqual([]);
  });

  it('handles .andWhere as alias for .where', () => {
    const q = extract(`db('jobs').where('a', 1).andWhere('b', 2);`);
    expect(q[0].predicates).toEqual([
      { kind: 'eq', column: { column: 'a' }, value: { kind: 'number', value: 1 } },
      { kind: 'eq', column: { column: 'b' }, value: { kind: 'number', value: 2 } },
    ]);
  });

  it('does not double-process inner chain calls (chain consumed once)', () => {
    // Even though the chain has 3 nested call_expression nodes, the
    // extractor produces ONE ExtractedQuery.
    const q = extract(`db('jobs').where('a', 1).whereNull('b').whereNotNull('c');`);
    expect(q).toHaveLength(1);
    expect(q[0].predicates).toHaveLength(3);
  });
});
