/**
 * Lift the body of a `query-rule …` declaration into a typed
 * QueryRuleContract.
 *
 * Syntax (see PLAN_GAP_1_QUERY_RULE.md for full design notes):
 *
 *   query-rule <identity> {
 *     origin SOURCE "section" lines..      // handled by resolver, ignored here
 *     bound-to Operation:"METHOD /path"
 *     entity Entity:<identity>
 *     required {
 *       is-null table.column
 *       is-not-null table.column
 *       eq table.column "value" | 42 | true | null | NOW()
 *       neq table.column …
 *       in table.column [v1, v2, …]
 *       not-in table.column [v1, …]
 *       gt | gte | lt | lte table.column 42
 *       between table.column 1 100
 *       like | ilike table.column "pattern"
 *       raw "SELECT … sub-query …"
 *     }
 *     forbidden { … same predicate vocabulary … }
 *     date-range-binding column table.column
 *   }
 *
 * Column form: `<table>.<column>` (split on the LAST dot — schema-qualified
 * tables like `compliance.infraction_summary.score` become
 * `{table: "compliance.infraction_summary", column: "score"}`).
 *
 * Unrecognized predicate keywords become opaque `raw` predicates so the
 * .tc author doesn't lose information silently (per Q2 decision —
 * unparseable surfaces, never drops).
 */

import type { StatementNode, HeadToken } from '../../parser/index.js';
import type {
  ArtifactRef,
  LiteralValue,
  Predicate,
  QualifiedColumn,
  QueryRuleContract,
} from '../../types/index.js';

export function liftQueryRule(body: StatementNode[]): QueryRuleContract {
  let boundToOperation: ArtifactRef | undefined;
  let entity: ArtifactRef | undefined;
  let dateRangeBinding: QueryRuleContract['dateRangeBinding'];
  const required: Predicate[] = [];
  const forbidden: Predicate[] = [];

  for (const stmt of body) {
    const h = stmt.head;
    if (h.length === 0 || h[0].kind !== 'ident') continue;
    const k = h[0].value;

    if (k === 'bound-to' && h[1]?.kind === 'reference') {
      boundToOperation = refFromToken(h[1]);
      continue;
    }
    if (k === 'entity' && h[1]?.kind === 'reference') {
      entity = refFromToken(h[1]);
      continue;
    }
    if (k === 'required' && stmt.block) {
      for (const p of liftPredicateBlock(stmt.block)) required.push(p);
      continue;
    }
    if (k === 'forbidden' && stmt.block) {
      for (const p of liftPredicateBlock(stmt.block)) forbidden.push(p);
      continue;
    }
    if (k === 'date-range-binding' && h[1]?.kind === 'ident' && h[1].value === 'column' && h[2]?.kind === 'ident') {
      dateRangeBinding = { column: parseColumn(h[2].value) };
      continue;
    }
  }

  return {
    boundToOperation,
    entity: entity ?? { type: 'Entity', identity: '', quoted: false },
    required,
    forbidden,
    dateRangeBinding,
  };
}

// ---------------------------------------------------------------------------
// Predicate block lifter
// ---------------------------------------------------------------------------

function liftPredicateBlock(stmts: StatementNode[]): Predicate[] {
  const out: Predicate[] = [];
  for (const stmt of stmts) {
    const p = liftPredicate(stmt);
    if (p) out.push(p);
  }
  return out;
}

function liftPredicate(stmt: StatementNode): Predicate | null {
  const h = stmt.head;
  if (h.length === 0 || h[0].kind !== 'ident') return null;
  const kw = h[0].value;

  // Opaque raw — `raw "SELECT ..."`
  if (kw === 'raw' && h[1]?.kind === 'string') {
    return { kind: 'raw', sql: h[1].value };
  }

  // Nullary predicates (one column, no value)
  if (kw === 'is-null' && h[1]?.kind === 'ident') {
    return { kind: 'is-null', column: parseColumn(h[1].value) };
  }
  if (kw === 'is-not-null' && h[1]?.kind === 'ident') {
    return { kind: 'is-not-null', column: parseColumn(h[1].value) };
  }

  // Binary predicates with a single value
  if (
    (kw === 'eq' || kw === 'neq' ||
     kw === 'gt' || kw === 'gte' || kw === 'lt' || kw === 'lte') &&
    h[1]?.kind === 'ident' &&
    h[2] !== undefined
  ) {
    const col = parseColumn(h[1].value);
    const val = literalFromToken(h[2]);
    if (val) return { kind: kw, column: col, value: val };
  }

  // List predicates
  if ((kw === 'in' || kw === 'not-in') && h[1]?.kind === 'ident' && h[2]?.kind === 'list') {
    const col = parseColumn(h[1].value);
    const values: LiteralValue[] = [];
    for (const item of h[2].items) {
      const v = literalFromToken(item);
      if (v) values.push(v);
    }
    return { kind: kw, column: col, values };
  }

  // between
  if (kw === 'between' && h[1]?.kind === 'ident' && h[2] && h[3]) {
    const col = parseColumn(h[1].value);
    const low = literalFromToken(h[2]);
    const high = literalFromToken(h[3]);
    if (low && high) return { kind: 'between', column: col, low, high };
  }

  // Pattern predicates
  if ((kw === 'like' || kw === 'ilike') && h[1]?.kind === 'ident' && h[2]?.kind === 'string') {
    return { kind: kw, column: parseColumn(h[1].value), pattern: h[2].value };
  }

  // Cross-column compare: `col-cmp t1.a > t2.b` or shorthand
  // `gt-col t1.a t2.b` (and analogues for eq/neq/gte/lt/lte).
  // The shorthand form is preferred — it keeps the predicate-line shape
  // consistent (kind + columns) with the binary literal predicates.
  if (h[0].kind === 'ident' && /^(eq|neq|gt|gte|lt|lte)-col$/.test(h[0].value) && h[1]?.kind === 'ident' && h[2]?.kind === 'ident') {
    const op = h[0].value.slice(0, -4) as 'eq'|'neq'|'gt'|'gte'|'lt'|'lte';
    return {
      kind: 'column-compare',
      left: parseColumn(h[1].value),
      op,
      right: parseColumn(h[2].value),
    };
  }
  if (kw === 'col-cmp' && h[1]?.kind === 'ident' && h[2]?.kind === 'op' && h[3]?.kind === 'ident') {
    const op = opTokenToCompare(h[2].value);
    if (op) {
      return {
        kind: 'column-compare',
        left: parseColumn(h[1].value),
        op,
        right: parseColumn(h[3].value),
      };
    }
  }

  // Unrecognized — preserve as raw so it surfaces downstream.
  const raw = stmt.head.map((t) => headTokenText(t)).join(' ');
  return { kind: 'raw', sql: raw };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function refFromToken(t: Extract<HeadToken, { kind: 'reference' }>): ArtifactRef {
  return { type: t.refType as ArtifactRef['type'], identity: t.identity, quoted: t.quoted };
}

/**
 * Parse a `table.column` (or `schema.table.column`) string into a
 * QualifiedColumn. Splits on the LAST dot; everything before is the
 * table, last segment is the column. An unqualified single ident
 * becomes a column-only ref (lenient — the comparator will best-effort
 * match).
 */
export function parseColumn(s: string): QualifiedColumn {
  const lastDot = s.lastIndexOf('.');
  if (lastDot < 0) return { column: s };
  return { table: s.slice(0, lastDot), column: s.slice(lastDot + 1) };
}

function opTokenToCompare(op: string): 'eq'|'neq'|'gt'|'gte'|'lt'|'lte' | null {
  switch (op) {
    case '=': case '==': return 'eq';
    case '!=':           return 'neq';
    case '>':            return 'gt';
    case '>=':           return 'gte';
    case '<':            return 'lt';
    case '<=':           return 'lte';
    default:             return null;
  }
}

function literalFromToken(t: HeadToken): LiteralValue | null {
  switch (t.kind) {
    case 'string':
      return { kind: 'string', value: t.value };
    case 'number':
      return { kind: 'number', value: t.value };
    case 'ident': {
      const v = t.value;
      if (v === 'true') return { kind: 'boolean', value: true };
      if (v === 'false') return { kind: 'boolean', value: false };
      if (v === 'null') return { kind: 'null' };
      // Function-call form like `NOW()` is preserved verbatim by the
      // parser (`(args)` folded into the ident); treat as identifier.
      return { kind: 'identifier', ref: v };
    }
    default:
      return null;
  }
}

function headTokenText(t: HeadToken): string {
  switch (t.kind) {
    case 'ident':
    case 'op':
      return t.value;
    case 'string':
      return `"${t.value}"`;
    case 'number':
      return String(t.value);
    case 'range':
      return `${t.start}..${t.end}`;
    case 'reference':
      return `${t.refType}:${t.identity}`;
    case 'list':
      return `[${t.items.map((i) => headTokenText(i)).join(', ')}]`;
  }
}
