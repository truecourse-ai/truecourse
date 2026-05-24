import { describe, it, expect } from 'vitest';
import { compareQueryRule } from '../../packages/contract-verifier/src/comparator/query-rule.js';
import type {
  ArtifactRef,
  ContractDrift,
  QueryRuleContract,
} from '../../packages/contract-verifier/src/types/index.js';
import type { ExtractedQuery } from '../../packages/contract-verifier/src/extractor/query/types.js';

const RULE_REF: ArtifactRef = {
  type: 'QueryRule',
  identity: 'noPaymentCollected.warranty-flag-rule',
  quoted: false,
};

const ENTITY_REF: ArtifactRef = {
  type: 'Entity',
  identity: 'core.jobs',
  quoted: false,
};

function mkQuery(overrides: Partial<ExtractedQuery>): ExtractedQuery {
  return {
    entity: { table: 'jobs', alias: 'j' },
    predicates: [],
    unparseable: [],
    source: {
      filePath: '/repo/backend/src/data/noPaymentCollected.ts',
      lineStart: 28,
      lineEnd: 28,
    },
    adapter: 'knex',
    ...overrides,
  };
}

function mkRule(overrides: Partial<QueryRuleContract>): QueryRuleContract {
  return {
    entity: ENTITY_REF,
    required: [],
    forbidden: [],
    ...overrides,
  };
}

function obligations(drifts: ContractDrift[]): string[] {
  return drifts.map((d) => d.obligationKey).sort();
}

describe('QueryRule comparator', () => {
  it('emits no drift when code satisfies all required predicates', () => {
    const drifts = compareQueryRule({
      ref: RULE_REF,
      origin: null,
      contract: mkRule({
        required: [
          { kind: 'is-not-null', column: { table: 'jobs', column: 'invoice_id' } },
          { kind: 'eq', column: { table: 'jobs', column: 'status' }, value: { kind: 'string', value: 'Completed' } },
        ],
      }),
      codeQueries: [
        mkQuery({
          predicates: [
            { kind: 'is-not-null', column: { alias: 'j', column: 'invoice_id' } },
            { kind: 'eq', column: { alias: 'j', column: 'status' }, value: { kind: 'string', value: 'Completed' } },
          ],
        }),
      ],
    });
    expect(drifts).toEqual([]);
  });

  it('flags a missing required predicate', () => {
    const drifts = compareQueryRule({
      ref: RULE_REF,
      origin: null,
      contract: mkRule({
        required: [
          { kind: 'is-not-null', column: { table: 'jobs', column: 'invoice_id' } },
        ],
      }),
      codeQueries: [mkQuery({ predicates: [] })],
    });
    expect(obligations(drifts)).toEqual(['query.predicate.missing.invoice_id.is-not-null']);
    expect(drifts[0].severity).toBe('high');
    expect(drifts[0].filePath).toContain('noPaymentCollected.ts');
  });

  it('flags value-mismatch when same column+kind has wrong value', () => {
    const drifts = compareQueryRule({
      ref: RULE_REF,
      origin: null,
      contract: mkRule({
        required: [
          { kind: 'eq', column: { table: 'jobs', column: 'status' }, value: { kind: 'string', value: 'Completed' } },
        ],
      }),
      codeQueries: [
        mkQuery({
          predicates: [
            { kind: 'eq', column: { alias: 'j', column: 'status' }, value: { kind: 'string', value: 'Cancelled' } },
          ],
        }),
      ],
    });
    expect(obligations(drifts)).toEqual(['query.predicate.value-mismatch.status.eq']);
    expect(drifts[0].specSide).toContain("'Completed'");
    expect(drifts[0].codeSide).toContain("'Cancelled'");
  });

  it('flags a forbidden predicate present in code', () => {
    // The "noPaymentCollected excludes warranty jobs" finding from
    // a1_questions audit, expressed as a forbidden predicate.
    const drifts = compareQueryRule({
      ref: RULE_REF,
      origin: null,
      contract: mkRule({
        forbidden: [
          { kind: 'is-null', column: { table: 'jobs', column: 'warranty_id' } },
        ],
      }),
      codeQueries: [
        mkQuery({
          predicates: [
            { kind: 'is-null', column: { alias: 'j', column: 'warranty_id' } },
          ],
          source: {
            filePath: '/repo/backend/src/data/noPaymentCollected.ts',
            lineStart: 31,
            lineEnd: 31,
          },
        }),
      ],
    });
    expect(obligations(drifts)).toEqual(['query.predicate.forbidden-present.warranty_id.is-null']);
    expect(drifts[0].lineStart).toBe(31);
  });

  it('matches predicates leniently across alias/table differences (same bare column)', () => {
    // Spec uses `jobs.status`, code uses alias `j.status` — should still match.
    const drifts = compareQueryRule({
      ref: RULE_REF,
      origin: null,
      contract: mkRule({
        required: [
          { kind: 'eq', column: { table: 'jobs', column: 'status' }, value: { kind: 'string', value: 'Completed' } },
        ],
      }),
      codeQueries: [
        mkQuery({
          predicates: [
            { kind: 'eq', column: { alias: 'j', column: 'status' }, value: { kind: 'string', value: 'Completed' } },
          ],
        }),
      ],
    });
    expect(drifts).toEqual([]);
  });

  it('matches `in` predicates regardless of value order', () => {
    const drifts = compareQueryRule({
      ref: RULE_REF,
      origin: null,
      contract: mkRule({
        required: [{
          kind: 'in',
          column: { table: 'jobs', column: 'market_id' },
          values: [{ kind: 'number', value: 1 }, { kind: 'number', value: 2 }, { kind: 'number', value: 3 }],
        }],
      }),
      codeQueries: [
        mkQuery({
          predicates: [{
            kind: 'in',
            column: { alias: 'j', column: 'market_id' },
            values: [{ kind: 'number', value: 3 }, { kind: 'number', value: 1 }, { kind: 'number', value: 2 }],
          }],
        }),
      ],
    });
    expect(drifts).toEqual([]);
  });

  it('flags value-mismatch when `in` value sets differ', () => {
    const drifts = compareQueryRule({
      ref: RULE_REF,
      origin: null,
      contract: mkRule({
        required: [{
          kind: 'in',
          column: { table: 'jobs', column: 'market_id' },
          values: [{ kind: 'number', value: 1 }, { kind: 'number', value: 2 }],
        }],
      }),
      codeQueries: [
        mkQuery({
          predicates: [{
            kind: 'in',
            column: { alias: 'j', column: 'market_id' },
            values: [{ kind: 'number', value: 1 }, { kind: 'number', value: 2 }, { kind: 'number', value: 3 }],
          }],
        }),
      ],
    });
    expect(obligations(drifts)).toEqual(['query.predicate.value-mismatch.market_id.in']);
  });

  it('flags date-range column mismatch (the DISCOVERY date-anchor cluster shape)', () => {
    // Spec: date range applies to `invoices.createdon`. Code applies it
    // to `jobs.completedon` — the canonical Compliance date-anchor drift.
    const drifts = compareQueryRule({
      ref: RULE_REF,
      origin: null,
      contract: mkRule({
        dateRangeBinding: { column: { table: 'invoices', column: 'createdon' } },
      }),
      codeQueries: [
        mkQuery({
          dateRangeBinding: { column: { alias: 'j', column: 'completedon' } },
        }),
      ],
    });
    expect(obligations(drifts)).toEqual(['query.date-binding.column-mismatch']);
    expect(drifts[0].severity).toBe('medium');
    expect(drifts[0].specSide).toBe('invoices.createdon');
    expect(drifts[0].codeSide).toBe('j.completedon');
  });

  it('surfaces unparseable code clauses as info drifts', () => {
    const drifts = compareQueryRule({
      ref: RULE_REF,
      origin: null,
      contract: mkRule({
        required: [{ kind: 'is-not-null', column: { table: 'jobs', column: 'invoice_id' } }],
      }),
      codeQueries: [
        mkQuery({
          predicates: [
            { kind: 'is-not-null', column: { alias: 'j', column: 'invoice_id' } },
          ],
          unparseable: [
            { reason: 'sub-query', raw: 'EXISTS (SELECT 1 FROM x WHERE …)' },
          ],
        }),
      ],
    });
    expect(obligations(drifts)).toEqual(['query.unparseable']);
    expect(drifts[0].severity).toBe('info');
    expect(drifts[0].codeSide).toContain('EXISTS');
  });

  it('handles zero code queries by emitting missing drifts citing the rule', () => {
    const drifts = compareQueryRule({
      ref: RULE_REF,
      origin: null,
      contract: mkRule({
        required: [{ kind: 'is-not-null', column: { table: 'jobs', column: 'invoice_id' } }],
      }),
      codeQueries: [],
    });
    expect(obligations(drifts)).toEqual(['query.predicate.missing.invoice_id.is-not-null']);
    expect(drifts[0].codeSide).toBe('<no queries found>');
  });

  it('does not flag a required `eq` whose value happens to differ in column case (column match is exact)', () => {
    // Sanity: column name match is case-sensitive (DB-style).
    const drifts = compareQueryRule({
      ref: RULE_REF,
      origin: null,
      contract: mkRule({
        required: [
          { kind: 'eq', column: { table: 'jobs', column: 'status' }, value: { kind: 'string', value: 'Completed' } },
        ],
      }),
      codeQueries: [
        mkQuery({
          predicates: [
            { kind: 'eq', column: { alias: 'j', column: 'STATUS' }, value: { kind: 'string', value: 'Completed' } },
          ],
        }),
      ],
    });
    // STATUS != status (case-sensitive) → missing
    expect(obligations(drifts)).toEqual(['query.predicate.missing.status.eq']);
  });

  it('does not double-flag forbidden when same column+kind has different value', () => {
    // Spec: forbidden `is-null warranty_id`. Code has `is-not-null warranty_id`.
    // Different kind → forbidden does NOT fire.
    const drifts = compareQueryRule({
      ref: RULE_REF,
      origin: null,
      contract: mkRule({
        forbidden: [{ kind: 'is-null', column: { table: 'jobs', column: 'warranty_id' } }],
      }),
      codeQueries: [
        mkQuery({
          predicates: [{ kind: 'is-not-null', column: { alias: 'j', column: 'warranty_id' } }],
        }),
      ],
    });
    expect(drifts).toEqual([]);
  });

  it('cites the FIRST matching code query for value-mismatch (deterministic location)', () => {
    const drifts = compareQueryRule({
      ref: RULE_REF,
      origin: null,
      contract: mkRule({
        required: [
          { kind: 'eq', column: { table: 'jobs', column: 'status' }, value: { kind: 'string', value: 'Completed' } },
        ],
      }),
      codeQueries: [
        mkQuery({
          predicates: [
            { kind: 'eq', column: { alias: 'j', column: 'status' }, value: { kind: 'string', value: 'Wrong1' } },
          ],
          source: { filePath: '/a.ts', lineStart: 10, lineEnd: 10 },
        }),
        mkQuery({
          predicates: [
            { kind: 'eq', column: { alias: 'j', column: 'status' }, value: { kind: 'string', value: 'Wrong2' } },
          ],
          source: { filePath: '/b.ts', lineStart: 20, lineEnd: 20 },
        }),
      ],
    });
    expect(drifts).toHaveLength(1);
    expect(drifts[0].filePath).toBe('/a.ts');
    expect(drifts[0].lineStart).toBe(10);
  });
});
