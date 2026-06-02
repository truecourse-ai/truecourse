import { describe, it, expect, beforeAll } from 'vitest';
import { initParsers, parseFile } from '../../packages/analyzer/src/index.js';
import { extractPrismaQueriesFromFile } from '../../packages/contract-verifier/src/extractor/query/prisma.js';
import type { ExtractedQuery } from '../../packages/contract-verifier/src/extractor/query/types.js';

beforeAll(async () => {
  await initParsers();
});

function extract(source: string, filePath = '/test/query.ts'): ExtractedQuery[] {
  const tree = parseFile(filePath, source, 'typescript');
  return extractPrismaQueriesFromFile(filePath, source, tree);
}

describe('Prisma query extractor', () => {
  it('extracts findMany with direct-value where as eq predicates', () => {
    const q = extract(`
      async function f() {
        return prisma.user.findMany({where: {status: 'active', verified: true}});
      }
    `);
    expect(q).toHaveLength(1);
    expect(q[0].entity).toEqual({ table: 'user' });
    expect(q[0].adapter).toBe('prisma');
    expect(q[0].predicates).toEqual([
      { kind: 'eq', column: { column: 'status' }, value: { kind: 'string', value: 'active' } },
      { kind: 'eq', column: { column: 'verified' }, value: { kind: 'boolean', value: true } },
    ]);
  });

  it('treats {col: null} as is-null and {col: {not: null}} as is-not-null', () => {
    const q = extract(`
      prisma.user.findMany({where: {deletedAt: null, email: {not: null}}});
    `);
    expect(q[0].predicates).toEqual([
      { kind: 'is-null', column: { column: 'deletedAt' } },
      { kind: 'is-not-null', column: { column: 'email' } },
    ]);
  });

  it('extracts range ops: gt, gte, lt, lte', () => {
    const q = extract(`
      prisma.user.findMany({where: {age: {gte: 18, lt: 65}, score: {gt: 0}}});
    `);
    const kinds = q[0].predicates.map((p) => p.kind).sort();
    expect(kinds).toEqual(['gt', 'gte', 'lt']);
  });

  it('extracts in / notIn', () => {
    const q = extract(`
      prisma.user.findMany({where: {marketId: {in: [1, 2, 3]}, role: {notIn: ['admin']}}});
    `);
    expect(q[0].predicates).toEqual([
      {
        kind: 'in', column: { column: 'marketId' },
        values: [
          { kind: 'number', value: 1 },
          { kind: 'number', value: 2 },
          { kind: 'number', value: 3 },
        ],
      },
      {
        kind: 'not-in', column: { column: 'role' },
        values: [{ kind: 'string', value: 'admin' }],
      },
    ]);
  });

  it('extracts contains/startsWith/endsWith into like patterns', () => {
    const q = extract(`
      prisma.user.findMany({where: {
        name: {contains: 'foo'},
        email: {startsWith: 'admin@'},
        slug: {endsWith: '-archived'},
      }});
    `);
    expect(q[0].predicates).toEqual([
      { kind: 'like', column: { column: 'name' }, pattern: '%foo%' },
      { kind: 'like', column: { column: 'email' }, pattern: 'admin@%' },
      { kind: 'like', column: { column: 'slug' }, pattern: '%-archived' },
    ]);
  });

  it('upgrades contains to ilike when mode: "insensitive" is set', () => {
    const q = extract(`
      prisma.user.findMany({where: {name: {contains: 'foo', mode: 'insensitive'}}});
    `);
    expect(q[0].predicates).toEqual([
      { kind: 'ilike', column: { column: 'name' }, pattern: '%foo%' },
    ]);
  });

  it('flattens AND arrays', () => {
    const q = extract(`
      prisma.user.findMany({where: {
        AND: [
          {status: 'active'},
          {verified: true},
        ],
      }});
    `);
    expect(q[0].predicates).toEqual([
      { kind: 'eq', column: { column: 'status' }, value: { kind: 'string', value: 'active' } },
      { kind: 'eq', column: { column: 'verified' }, value: { kind: 'boolean', value: true } },
    ]);
  });

  it('marks OR / NOT clauses as unparseable', () => {
    const q = extract(`
      prisma.user.findMany({where: {
        OR: [{status: 'active'}, {role: 'admin'}],
        NOT: {archived: true},
      }});
    `);
    expect(q[0].predicates).toEqual([]);
    expect(q[0].unparseable.length).toBeGreaterThanOrEqual(2);
  });

  it('treats unknown operator as unparseable', () => {
    const q = extract(`
      prisma.user.findMany({where: {createdAt: {hasSome: [1, 2]}}});
    `);
    expect(q[0].unparseable[0].reason).toContain('hasSome');
  });

  it('extracts {col: {not: literal}} as neq', () => {
    const q = extract(`prisma.user.findMany({where: {status: {not: 'archived'}}});`);
    expect(q[0].predicates).toEqual([
      { kind: 'neq', column: { column: 'status' }, value: { kind: 'string', value: 'archived' } },
    ]);
  });

  it('extracts {col: {equals: literal}} as eq', () => {
    const q = extract(`prisma.user.findMany({where: {status: {equals: 'active'}}});`);
    expect(q[0].predicates).toEqual([
      { kind: 'eq', column: { column: 'status' }, value: { kind: 'string', value: 'active' } },
    ]);
  });

  it('recognises db.<model>.findMany pattern (db client name)', () => {
    const q = extract(`db.job.findMany({where: {status: 'Completed'}});`);
    expect(q[0].entity.table).toBe('job');
  });

  it('recognises this.prisma.<model>.findMany', () => {
    const q = extract(`this.prisma.job.findMany({where: {id: 1}});`);
    expect(q[0].entity.table).toBe('job');
  });

  it('emits one query per call (no chain semantics)', () => {
    const q = extract(`
      prisma.user.findMany({where: {a: 1}});
      prisma.job.findUnique({where: {id: 42}});
    `);
    expect(q).toHaveLength(2);
    expect(q.map((r) => r.entity.table).sort()).toEqual(['job', 'user']);
  });

  it('handles every query method (findMany, findFirst, findUnique, count, ...)', () => {
    const q = extract(`
      prisma.user.findFirst({where: {id: 1}});
      prisma.user.findUnique({where: {id: 2}});
      prisma.user.count({where: {id: 3}});
      prisma.user.aggregate({where: {id: 4}});
      prisma.user.groupBy({where: {id: 5}});
      prisma.user.deleteMany({where: {id: 6}});
      prisma.user.updateMany({where: {id: 7}});
    `);
    expect(q).toHaveLength(7);
  });

  it('detects date-range binding when both lower and upper bound present', () => {
    const q = extract(`
      prisma.job.findMany({where: {completedOn: {gte: startDate, lt: endDate}}});
    `);
    expect(q[0].dateRangeBinding).toEqual({
      column: { column: 'completedOn' },
    });
  });

  it('ignores non-prisma chains (foo.user.findMany)', () => {
    const q = extract(`foo.user.findMany({where: {id: 1}});`);
    expect(q).toEqual([]);
  });

  it('handles findMany with no where (full-table scan) — empty predicates', () => {
    const q = extract(`prisma.user.findMany({orderBy: {id: 'asc'}});`);
    expect(q).toHaveLength(1);
    expect(q[0].predicates).toEqual([]);
  });
});
