# PLAN — Gap 1: QueryRule artifact (SQL where/filter modeling)

Status: IN PROGRESS (started 2026-05-24, il-framework branch).
Tracking: tasks #6–#15. Fixture set: `docs/contracts/audit-findings-by-engine-gap.json` → `sql-where-filter` bucket (36 findings, 1 critical / 35 high — largest single source of missed audit drifts).

## Goal

Extend the verifier so it can model and check the predicates a spec requires/forbids on data-fetching queries, regardless of how those queries are expressed in code.

## Scope decisions (locked)

- **v1 code-side adapters (JS/TS only):** Knex, Prisma, raw SQL string literals. Python / SQLAlchemy deferred until verifier gains generic Python parsing (see [[feedback_engine_general_not_target_specific]] — engine work designs for general case, not the current audit target).
- **Unparseable queries:** extract as opaque `{kind: 'raw', sql}` predicate, mark on `ExtractedQuery.unparseable[]`, surface in dashboard. Never silently drop.
- **Column-alias resolution:** lenient. Extractor stores `{table?, alias?, column}` triple. Comparator does best-effort match; strict schema-based resolution is a later optimization once entity-IL coverage is reliable.

## IL artifact shape

New `ArtifactKind` value: `'QueryRule'`.

```ts
export interface QueryRuleContract {
  /** Optional: bind this rule to a specific Operation by identity. If
   *  unbound, applies to any query against `entity`. */
  boundToOperation?: ArtifactRef;
  /** The entity (logical table) being queried. */
  entity: ArtifactRef;
  /** Predicates the query MUST include. */
  required: Predicate[];
  /** Predicates the query MUST NOT include. */
  forbidden: Predicate[];
  /** Optional: which column the date-range filter is anchored on. */
  dateRangeBinding?: { column: QualifiedColumn };
}

export type Predicate =
  | { kind: 'eq';            column: QualifiedColumn; value: LiteralValue }
  | { kind: 'neq';           column: QualifiedColumn; value: LiteralValue }
  | { kind: 'in';            column: QualifiedColumn; values: LiteralValue[] }
  | { kind: 'not-in';        column: QualifiedColumn; values: LiteralValue[] }
  | { kind: 'is-null';       column: QualifiedColumn }
  | { kind: 'is-not-null';   column: QualifiedColumn }
  | { kind: 'gt'|'gte'|'lt'|'lte'; column: QualifiedColumn; value: LiteralValue }
  | { kind: 'between';       column: QualifiedColumn; low: LiteralValue; high: LiteralValue }
  | { kind: 'like'|'ilike';  column: QualifiedColumn; pattern: string }
  | { kind: 'raw';           sql: string };           // opaque escape hatch

export interface QualifiedColumn {
  table?: string;   // canonical table name, if resolvable
  alias?: string;   // SQL alias used in source (e.g. 'j' for 'jobs')
  column: string;
}

export type LiteralValue =
  | { kind: 'string';     value: string }
  | { kind: 'number';     value: number }
  | { kind: 'boolean';    value: boolean }
  | { kind: 'null' }
  | { kind: 'identifier'; ref: string }              // NOW(), CURRENT_DATE
  | { kind: 'parameter';  index?: number; name?: string };
```

`ExtractedQuery` (code-side output) shares the same `Predicate` algebra so the comparator does set diff:

```ts
export interface ExtractedQuery {
  operationBinding?: ArtifactRef;     // routed back from handler chain
  entity: { table?: string; alias?: string };
  predicates: Predicate[];
  dateRangeBinding?: { column: QualifiedColumn };
  unparseable: { reason: string; raw: string }[];
  source: SourceLocation;
  adapter: 'knex' | 'prisma' | 'raw-sql';
}
```

## .tc grammar sketch

```
QueryRule "noPaymentCollected.warranty-flag-rule"
  boundToOperation: Operation:"GET /api/v1/infractions/no-payment-collected"
  entity: Entity:core.jobs
  required:
    - is-not-null jobs.invoice.balance
  forbidden:
    - is-null jobs.warranty_id     // spec: warranty jobs MUST be flagged, not excluded
  dateRangeBinding:
    column: invoices.createdon
```

Block syntax modelled after existing artifact files; predicate lines parse with a small DSL. Concrete grammar nailed down in task #9.

## Comparator drift kinds

```
query.predicate.missing.${entity}.${column}.${pkind}
query.predicate.forbidden-present.${entity}.${column}.${pkind}
query.predicate.value-mismatch.${entity}.${column}
query.date-binding.column-mismatch.${entity}
query.unparseable.${operation.identity}        // info-level, surfaces coverage gap
```

Severity: `high` for missing/forbidden/value-mismatch on required filters that change result rows; `medium` for date-binding mismatch (only matters if a date filter is applied); `info` for unparseable.

## Adapter v1 surface

| Adapter | Recognises | AST tool | Notes |
|---|---|---|---|
| Knex | `db('table').where({...})`, `.where('col', op, val)`, `.whereIn`, `.whereNull`, `.whereRaw`, chained | tree-sitter-typescript (already in repo) | `.whereRaw('sql')` → push raw SQL adapter through |
| Prisma | `prisma.<model>.findMany({where:{...}})`, `.findUnique`, `.findFirst`, nested `AND/OR/NOT`, `gt/gte/lt/lte/in/notIn/contains/startsWith/endsWith` | tree-sitter-typescript | Predicate algebra maps almost 1:1 |
| Raw SQL | String literals passed to `db.raw(...)`, `pool.query(...)`, `client.query(...)`, tagged-template `sql\`...\`` | `libpg_query` via `pg-query-emscripten` | Walk `WHERE` AST, normalize to `Predicate` |

Adapter contract:
```ts
export interface QueryExtractorAdapter {
  name: 'knex' | 'prisma' | 'raw-sql';
  /** Run against one file's AST/source; return all queries found. */
  extract(ctx: ExtractorContext): ExtractedQuery[];
}
```

Each adapter pushes into a single `ExtractedQuery[]` per file. Adapters never share state. Adding a 4th (Drizzle, TypeORM, …) means a new adapter, no comparator changes.

## Implementation order

Bottom-up, one merge-safe step at a time:

1. ✅ Plan (this doc) — task #6
2. IL types — task #7 (no behaviour, just shapes)
3. Stub files + registry wiring — task #8 (all 4 surfaces register an empty implementation so the verifier still builds)
4. `.tc` grammar — task #9 (parser produces `QueryRuleContract` values)
5. Comparator — task #13 (works against in-memory fixtures, no extractor yet)
6. Knex adapter — task #10
7. Prisma adapter — task #11
8. Raw SQL adapter — task #12
9. LLM prompt — task #14
10. End-to-end on Compliance — task #15

Tests added alongside each step (per `feedback_strict_fixture_first` — fixture-first cycle). Fixture set seeded from `audit-findings-by-engine-gap.json` `sql-where-filter` bucket; aim for full green on 14+ DISCOVERY date-anchor findings as the v1 coverage bar.

## Out of scope (explicitly)

- SQLAlchemy / Python (defer to gap that adds Python verifier coverage)
- Drizzle, TypeORM, Sequelize, Django, ActiveRecord (adapter slots exist; bodies later)
- Strict schema-based column resolution (lenient match suffices for v1)
- Sub-queries, CTEs, window functions in raw SQL (mark unparseable, don't try)
- Comparing query result shape against response body shape (separate concern, already partially covered by Operation comparator)
- Query performance / index advice (not a drift; out of audit scope)
