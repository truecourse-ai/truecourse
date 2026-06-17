/**
 * column-vs-column predicate kind — covers the lifter, raw-SQL extractor,
 * Knex extractor, and comparator end-to-end.
 *
 * Catches the audit's `techDeletedMaterial` finding shape:
 *   "the deletion timestamp must fall between the assigned tech's
 *    arrival and departure times"
 *   → `gte-col invoiceitems.modifiedon appointmentassignments.arrived_at`
 *     `lte-col invoiceitems.modifiedon appointmentassignments.departed_at`
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { initParsers, parseFile } from '../../packages/analyzer/src/index.js';
import { parseTcFile as parseTc } from '../../packages/contract-verifier/src/parser-ohm/index.js';
import { resolve } from '../../packages/contract-verifier/src/resolver/index.js';
import { extractRawSqlQueriesFromFile } from '../../packages/contract-verifier/src/extractor/query/raw-sql.js';
import { extractKnexQueriesFromFile } from '../../packages/contract-verifier/src/extractor/query/knex.js';
import { compareQueryRule } from '../../packages/contract-verifier/src/comparator/query-rule.js';
import type {
  ArtifactRef,
  QueryRuleContract,
} from '../../packages/contract-verifier/src/types/index.js';

beforeAll(async () => {
  await initParsers();
});

const RULE_REF: ArtifactRef = {
  type: 'QueryRule',
  identity: 'tech-deleted.deletion-in-tech-window',
  quoted: false,
};

describe('column-vs-column predicate', () => {
  describe('lifter (.tc grammar)', () => {
    it('lifts gte-col / lte-col shorthand', () => {
      const tc = `query-rule t {
  entity Entity:core.invoiceitems
  required {
    gte-col invoiceitems.modifiedon appointmentassignments.arrived_at
    lte-col invoiceitems.modifiedon appointmentassignments.departed_at
  }
}`;
      const r = resolve([parseTc('t.tc', tc)]);
      const c = r.index.values().next().value!.contract as QueryRuleContract;
      expect(c.required).toEqual([
        {
          kind: 'column-compare', op: 'gte',
          left: { table: 'invoiceitems', column: 'modifiedon' },
          right: { table: 'appointmentassignments', column: 'arrived_at' },
        },
        {
          kind: 'column-compare', op: 'lte',
          left: { table: 'invoiceitems', column: 'modifiedon' },
          right: { table: 'appointmentassignments', column: 'departed_at' },
        },
      ]);
    });

    it('lifts col-cmp <left> <op> <right> form', () => {
      const tc = `query-rule t {
  entity Entity:core.invoiceitems
  required {
    col-cmp invoiceitems.price > pricebook.list_price
  }
}`;
      const r = resolve([parseTc('t.tc', tc)]);
      const c = r.index.values().next().value!.contract as QueryRuleContract;
      expect(c.required[0]).toEqual({
        kind: 'column-compare', op: 'gt',
        left: { table: 'invoiceitems', column: 'price' },
        right: { table: 'pricebook', column: 'list_price' },
      });
    });

    it('lifts eq-col, neq-col, gt-col, lt-col', () => {
      const tc = `query-rule t {
  entity Entity:x
  required {
    eq-col a.x b.y
    neq-col a.x b.y
    gt-col a.x b.y
    lt-col a.x b.y
  }
}`;
      const r = resolve([parseTc('t.tc', tc)]);
      const c = r.index.values().next().value!.contract as QueryRuleContract;
      const ops = c.required.map((p) => p.kind === 'column-compare' ? p.op : null);
      expect(ops).toEqual(['eq', 'neq', 'gt', 'lt']);
    });
  });

  describe('raw-SQL extractor', () => {
    it('extracts column-vs-column from `WHERE t1.a > t2.b`', () => {
      const src = `db.raw("SELECT * FROM invoiceitems ii JOIN appointmentassignments aa ON ii.invoice_id = aa.invoice_id WHERE ii.modifiedon >= aa.arrived_at AND ii.modifiedon <= aa.departed_at");`;
      const tree = parseFile('q.ts', src, 'typescript');
      const q = extractRawSqlQueriesFromFile('q.ts', src, tree);
      expect(q).toHaveLength(1);
      const colCmps = q[0].predicates.filter((p) => p.kind === 'column-compare');
      expect(colCmps).toHaveLength(2);
      expect(colCmps[0]).toMatchObject({
        kind: 'column-compare', op: 'gte',
        left: { table: 'ii', column: 'modifiedon' },
        right: { table: 'aa', column: 'arrived_at' },
      });
      expect(colCmps[1]).toMatchObject({
        kind: 'column-compare', op: 'lte',
        right: { table: 'aa', column: 'departed_at' },
      });
    });

    it('keeps literal comparisons as literal predicates (not column-compare)', () => {
      const src = `db.raw("SELECT * FROM jobs j WHERE j.status = 'Completed' AND j.total > 0");`;
      const tree = parseFile('q.ts', src, 'typescript');
      const q = extractRawSqlQueriesFromFile('q.ts', src, tree);
      const kinds = q[0].predicates.map((p) => p.kind);
      expect(kinds).toEqual(['eq', 'gt']);
    });

    it('does NOT mis-classify NOW() / CURRENT_DATE as a column ref', () => {
      const src = `db.raw("SELECT * FROM jobs j WHERE j.completedon < NOW()");`;
      const tree = parseFile('q.ts', src, 'typescript');
      const q = extractRawSqlQueriesFromFile('q.ts', src, tree);
      // `NOW()` is a function call — the raw-SQL value parser preserves
      // the parens, so it falls into the literal branch (identifier).
      expect(q[0].predicates[0].kind).toBe('lt');
    });
  });

  describe('Knex extractor', () => {
    it('recognises db.where(col, op, db.ref(col)) as column-compare', () => {
      const src = `db('invoiceitems as ii').where('ii.modifiedon', '>=', db.ref('aa.arrived_at'));`;
      const tree = parseFile('q.ts', src, 'typescript');
      const q = extractKnexQueriesFromFile('q.ts', src, tree);
      expect(q).toHaveLength(1);
      expect(q[0].predicates[0]).toEqual({
        kind: 'column-compare', op: 'gte',
        left: { table: 'ii', column: 'modifiedon' },
        right: { table: 'aa', column: 'arrived_at' },
      });
    });

    it('plain literal arg still produces a literal predicate', () => {
      const src = `db('jobs').where('status', '=', 'Completed');`;
      const tree = parseFile('q.ts', src, 'typescript');
      const q = extractKnexQueriesFromFile('q.ts', src, tree);
      expect(q[0].predicates[0]).toMatchObject({
        kind: 'eq',
        value: { kind: 'string', value: 'Completed' },
      });
    });
  });

  describe('comparator', () => {
    it('emits no drift when code satisfies a column-compare required predicate', () => {
      const drifts = compareQueryRule({
        ref: RULE_REF, origin: null,
        contract: {
          entity: { type: 'Entity', identity: 'core.invoiceitems', quoted: false },
          required: [
            { kind: 'column-compare', op: 'gte',
              left: { table: 'invoiceitems', column: 'modifiedon' },
              right: { table: 'appointmentassignments', column: 'arrived_at' } },
          ],
          forbidden: [],
        },
        codeQueries: [{
          entity: { table: 'invoiceitems', alias: 'ii' },
          predicates: [
            { kind: 'column-compare', op: 'gte',
              left: { alias: 'ii', column: 'modifiedon' },
              right: { alias: 'aa', column: 'arrived_at' } },
          ],
          unparseable: [],
          source: { filePath: '/x.ts', lineStart: 1, lineEnd: 1 },
          adapter: 'raw-sql',
        }],
      });
      expect(drifts).toEqual([]);
    });

    it('emits missing-predicate drift when code lacks the column-compare', () => {
      const drifts = compareQueryRule({
        ref: RULE_REF, origin: null,
        contract: {
          entity: { type: 'Entity', identity: 'core.invoiceitems', quoted: false },
          required: [
            { kind: 'column-compare', op: 'gte',
              left: { table: 'invoiceitems', column: 'modifiedon' },
              right: { table: 'appointmentassignments', column: 'arrived_at' } },
          ],
          forbidden: [],
        },
        codeQueries: [{
          entity: { table: 'invoiceitems', alias: 'ii' },
          predicates: [
            { kind: 'eq', column: { alias: 'ii', column: 'status' }, value: { kind: 'string', value: 'active' } },
          ],
          unparseable: [],
          source: { filePath: '/x.ts', lineStart: 1, lineEnd: 1 },
          adapter: 'raw-sql',
        }],
      });
      expect(drifts.map((d) => d.obligationKey)).toEqual([
        'query.predicate.missing.modifiedon.column-compare',
      ]);
    });

    it('emits value-mismatch when right-hand column differs', () => {
      const drifts = compareQueryRule({
        ref: RULE_REF, origin: null,
        contract: {
          entity: { type: 'Entity', identity: 'core.invoiceitems', quoted: false },
          required: [
            { kind: 'column-compare', op: 'gte',
              left: { column: 'modifiedon' },
              right: { column: 'arrived_at' } },
          ],
          forbidden: [],
        },
        codeQueries: [{
          entity: { table: 'invoiceitems' },
          predicates: [
            { kind: 'column-compare', op: 'gte',
              left: { column: 'modifiedon' },
              right: { column: 'created_at' } }, // wrong right-side
          ],
          unparseable: [],
          source: { filePath: '/x.ts', lineStart: 1, lineEnd: 1 },
          adapter: 'raw-sql',
        }],
      });
      expect(drifts.map((d) => d.obligationKey)).toEqual([
        'query.predicate.value-mismatch.modifiedon.column-compare',
      ]);
    });
  });
});
