/**
 * QueryRule comparator. Diffs the predicates a spec asserts on a data-
 * fetching query against the predicates an extractor produced from
 * code. Adapter-agnostic — works the same against Knex, Prisma, or
 * raw-SQL extractor output as long as both sides use the shared
 * `Predicate` algebra.
 *
 * Drift kinds emitted (`obligationKey` formats):
 *
 *   query.predicate.missing.${column}.${kind}            — high
 *     Spec requires a predicate; no code query against this entity
 *     includes a predicate of the same kind on the same column.
 *
 *   query.predicate.value-mismatch.${column}.${kind}     — high
 *     Spec requires `eq status="Completed"`; code has `eq status="…"`
 *     with a different value. Code IS filtering on the right column
 *     but with the wrong value.
 *
 *   query.predicate.forbidden-present.${column}.${kind}  — high
 *     Spec marks a predicate `forbidden`; code emits one matching it.
 *
 *   query.date-binding.column-mismatch                   — medium
 *     Spec binds the date range to one column; code binds it to
 *     another (the date-anchor drift cluster from DISCOVERY.md).
 *
 *   query.unparseable                                    — info
 *     A code query contained a clause the extractor couldn't normalize.
 *     Surfaced so coverage gaps are visible, never silently dropped.
 *
 * Match semantics (lenient, per PLAN_GAP_1_QUERY_RULE.md decision Q3):
 *   - Predicates match on `kind` + bare column name (`column.column`).
 *   - Table/alias info is preserved for downstream display but is not
 *     required to match — the comparator best-effort matches on the
 *     unqualified column.
 *   - Multiple code queries can satisfy one spec predicate; AT LEAST
 *     ONE match is enough.
 */

import { randomUUID } from 'node:crypto';
import type {
  ArtifactRef,
  ContractDrift,
  LiteralValue,
  Predicate,
  QualifiedColumn,
  QueryRuleContract,
  SpecOrigin,
} from '../types/index.js';
import type { ExtractedQuery } from '../extractor/query/types.js';

export interface QueryRuleCompareInput {
  ref: ArtifactRef;
  origin: SpecOrigin | null;
  contract: QueryRuleContract;
  /** Code-side queries the orchestrator pre-filtered to this rule's
   *  entity. May be empty (no queries found → required predicates all
   *  flag as missing, pointing at a synthetic "no query found" site). */
  codeQueries: ExtractedQuery[];
}

export function compareQueryRule(input: QueryRuleCompareInput): ContractDrift[] {
  const { ref, contract, codeQueries } = input;
  const drifts: ContractDrift[] = [];

  // Aggregate every code-side predicate across all matching queries
  // into one indexed lookup. We track which query each predicate came
  // from so missing/forbidden drifts can cite a concrete file:line.
  const codePredicates = collectCodePredicates(codeQueries);

  // ---- Required predicates ----
  for (const required of contract.required) {
    if (required.kind === 'raw') continue; // opaque, can't compare structurally
    const matches = lookupByKindAndColumn(codePredicates, required.kind, columnOf(required));

    if (matches.length === 0) {
      drifts.push(missingPredicateDrift(ref, required, codeQueries));
      continue;
    }
    // Code has at least one predicate of the same kind+column. Check
    // value equality if the predicate carries a value.
    if (predicateHasValue(required)) {
      const valueMatch = matches.find((m) => valuesEqual(required, m.predicate));
      if (!valueMatch) {
        drifts.push(valueMismatchDrift(ref, required, matches));
      }
    }
  }

  // ---- Forbidden predicates ----
  for (const forbidden of contract.forbidden) {
    if (forbidden.kind === 'raw') continue;
    const matches = lookupByKindAndColumn(codePredicates, forbidden.kind, columnOf(forbidden));
    // For forbidden, ANY occurrence with the same value (or any
    // occurrence at all for null/not-null) is a drift.
    const offending = predicateHasValue(forbidden)
      ? matches.filter((m) => valuesEqual(forbidden, m.predicate))
      : matches;
    for (const o of offending) {
      drifts.push(forbiddenPresentDrift(ref, forbidden, o));
    }
  }

  // ---- Date-range binding mismatch ----
  if (contract.dateRangeBinding) {
    const specCol = contract.dateRangeBinding.column;
    for (const q of codeQueries) {
      if (!q.dateRangeBinding) continue;
      if (q.dateRangeBinding.column.column !== specCol.column) {
        drifts.push(dateBindingDrift(ref, contract.dateRangeBinding.column, q));
      }
    }
  }

  // ---- Unparseable clauses (info-level coverage gap surfacing) ----
  // An unparseable WHERE clause still leaves the FROM table known, so we
  // attribute the drift to the rule whose entity matches that table —
  // rather than letting every rule emit it and having the orchestrator's
  // cross-rule dedup keep whichever happens to be first in index order
  // (which is non-deterministic across a multi-file generated corpus).
  // When the table is genuinely unknown, fall back to emit-for-all.
  for (const q of codeQueries) {
    if (q.unparseable.length === 0) continue;
    if (q.entity.table && !tableMatchesEntity(q.entity.table, contract.entity.identity)) continue;
    for (const u of q.unparseable) {
      drifts.push({
        id: randomUUID(),
        type: 'contract-drift',
        artifactRef: ref,
        obligationKey: 'query.unparseable',
        severity: 'info',
        filePath: q.source.filePath,
        lineStart: q.source.lineStart,
        lineEnd: q.source.lineEnd,
        message: `Query contains a clause the ${q.adapter} adapter could not normalize (${u.reason}); predicate set may be incomplete.`,
        codeSide: u.raw,
      });
    }
  }

  // Dedupe — raw-SQL CTE splitting + permissive entity matching means
  // the same logical drift can be emitted by several overlapping queries
  // against the same file:line. Collapse on the tuple that humans care
  // about (what + where), keeping the first instance.
  return dedupeDrifts(drifts);
}

/**
 * True when a code query's FROM table refers to the same logical entity
 * as a rule's `entity` identity, tolerant of the table-name ↔ entity-name
 * gap (snake_case plural table vs PascalCase singular entity):
 * `loyalty_tiers` ↔ `LoyaltyTier`, `customers` ↔ `Customer`.
 */
function tableMatchesEntity(table: string, entityIdentity: string): boolean {
  // Compare on the final dotted segment (drop a module/schema qualifier
  // like `core.jobs` → `jobs`), normalized for the snake-plural ↔
  // PascalCase-singular gap.
  const norm = (s: string): string => {
    let n = (s.split('.').pop() ?? s).toLowerCase().replace(/[_-]/g, '');
    if (n.length > 2 && n.endsWith('s')) n = n.slice(0, -1);
    return n;
  };
  return norm(table) === norm(entityIdentity);
}

function dedupeDrifts(drifts: ContractDrift[]): ContractDrift[] {
  const seen = new Set<string>();
  const out: ContractDrift[] = [];
  for (const d of drifts) {
    const key = `${d.obligationKey}|${d.filePath}|${d.lineStart}|${d.codeSide ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Code-predicate indexing
// ---------------------------------------------------------------------------

interface IndexedPredicate {
  predicate: Predicate;
  query: ExtractedQuery;
}

function collectCodePredicates(queries: ExtractedQuery[]): IndexedPredicate[] {
  const out: IndexedPredicate[] = [];
  for (const q of queries) {
    for (const p of q.predicates) {
      out.push({ predicate: p, query: q });
    }
  }
  return out;
}

function lookupByKindAndColumn(
  predicates: IndexedPredicate[],
  kind: Predicate['kind'],
  column: QualifiedColumn,
): IndexedPredicate[] {
  return predicates.filter((ip) => {
    if (ip.predicate.kind !== kind) return false;
    if (ip.predicate.kind === 'raw') return false;
    if (ip.predicate.kind === 'column-compare') {
      // For column-compare, "column" lookup matches against the LEFT
      // operand (the column being constrained). Comparator's value
      // equality covers op + right operand.
      return ip.predicate.left.column === column.column;
    }
    return (ip.predicate as { column: QualifiedColumn }).column.column === column.column;
  });
}

// ---------------------------------------------------------------------------
// Value extraction + equality
// ---------------------------------------------------------------------------

function predicateHasValue(p: Predicate): boolean {
  switch (p.kind) {
    case 'is-null':
    case 'is-not-null':
    case 'raw':
      return false;
    default:
      return true;
  }
}

function valuesEqual(a: Predicate, b: Predicate): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'eq': case 'neq': case 'gt': case 'gte': case 'lt': case 'lte':
      return literalEq(a.value, (b as typeof a).value);
    case 'in': case 'not-in': {
      const av = a.values, bv = (b as typeof a).values;
      if (av.length !== bv.length) return false;
      // Order-insensitive comparison via stable-serialized set.
      const aSet = new Set(av.map(literalKey));
      for (const v of bv) if (!aSet.has(literalKey(v))) return false;
      return true;
    }
    case 'between': {
      const bb = b as typeof a;
      return literalEq(a.low, bb.low) && literalEq(a.high, bb.high);
    }
    case 'like': case 'ilike':
      return a.pattern === (b as typeof a).pattern;
    case 'column-compare': {
      const bb = b as typeof a;
      return a.op === bb.op
        && a.left.column === bb.left.column
        && a.right.column === bb.right.column;
    }
    case 'is-null': case 'is-not-null': case 'raw':
      return true;
  }
}

function literalEq(a: LiteralValue, b: LiteralValue): boolean {
  return literalKey(a) === literalKey(b);
}

function literalKey(v: LiteralValue): string {
  switch (v.kind) {
    case 'string':     return `s:${v.value}`;
    case 'number':     return `n:${v.value}`;
    case 'boolean':    return `b:${v.value}`;
    case 'null':       return 'null';
    case 'identifier': return `id:${v.ref}`;
    case 'parameter':  return `p:${v.name ?? `#${v.index ?? '?'}`}`;
  }
}

// ---------------------------------------------------------------------------
// Drift constructors
// ---------------------------------------------------------------------------

function missingPredicateDrift(
  ref: ArtifactRef,
  spec: Predicate,
  codeQueries: ExtractedQuery[],
): ContractDrift {
  // Point at the first code query against this entity so the dev has a
  // file to edit. If there are NO queries at all, fall back to a
  // synthetic location at the rule's identity — better than crashing.
  const cite = codeQueries[0]?.source ?? { filePath: ref.identity, lineStart: 0, lineEnd: 0 };
  return {
    id: randomUUID(),
    type: 'contract-drift',
    artifactRef: ref,
    obligationKey: `query.predicate.missing.${columnName(spec)}.${spec.kind}`,
    severity: 'high',
    filePath: cite.filePath,
    lineStart: cite.lineStart,
    lineEnd: cite.lineEnd,
    message: `Spec requires predicate \`${describePredicate(spec)}\` on this query, but no code query against this entity emits it.`,
    specSide: describePredicate(spec),
    codeSide: codeQueries.length === 0 ? '<no queries found>' : '<predicate absent from all matching queries>',
  };
}

function valueMismatchDrift(
  ref: ArtifactRef,
  spec: Predicate,
  codeMatches: IndexedPredicate[],
): ContractDrift {
  // Cite the first code occurrence; that's where the value lives.
  const cite = codeMatches[0];
  return {
    id: randomUUID(),
    type: 'contract-drift',
    artifactRef: ref,
    obligationKey: `query.predicate.value-mismatch.${columnName(spec)}.${spec.kind}`,
    severity: 'high',
    filePath: cite.query.source.filePath,
    lineStart: cite.query.source.lineStart,
    lineEnd: cite.query.source.lineEnd,
    message: `Predicate on column \`${columnName(spec)}\` exists in code but with a different value than the spec requires.`,
    specSide: describePredicate(spec),
    codeSide: describePredicate(cite.predicate),
  };
}

function forbiddenPresentDrift(
  ref: ArtifactRef,
  spec: Predicate,
  offending: IndexedPredicate,
): ContractDrift {
  return {
    id: randomUUID(),
    type: 'contract-drift',
    artifactRef: ref,
    obligationKey: `query.predicate.forbidden-present.${columnName(spec)}.${spec.kind}`,
    severity: 'high',
    filePath: offending.query.source.filePath,
    lineStart: offending.query.source.lineStart,
    lineEnd: offending.query.source.lineEnd,
    message: `Spec forbids predicate \`${describePredicate(spec)}\` on this query, but code emits it.`,
    specSide: `forbidden: ${describePredicate(spec)}`,
    codeSide: describePredicate(offending.predicate),
  };
}

function dateBindingDrift(
  ref: ArtifactRef,
  specCol: QualifiedColumn,
  q: ExtractedQuery,
): ContractDrift {
  return {
    id: randomUUID(),
    type: 'contract-drift',
    artifactRef: ref,
    obligationKey: 'query.date-binding.column-mismatch',
    severity: 'medium',
    filePath: q.source.filePath,
    lineStart: q.source.lineStart,
    lineEnd: q.source.lineEnd,
    message: `Spec binds the date range to \`${qualifiedColumnText(specCol)}\` but code binds it to \`${qualifiedColumnText(q.dateRangeBinding!.column)}\`.`,
    specSide: qualifiedColumnText(specCol),
    codeSide: qualifiedColumnText(q.dateRangeBinding!.column),
  };
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

function columnName(p: Predicate): string {
  if (p.kind === 'raw') return '<raw>';
  if (p.kind === 'column-compare') return p.left.column;
  return p.column.column;
}

/** Pull the constrained-column from any non-raw predicate. */
function columnOf(p: Predicate): QualifiedColumn {
  if (p.kind === 'raw') return { column: '<raw>' };
  if (p.kind === 'column-compare') return p.left;
  return p.column;
}

function qualifiedColumnText(c: QualifiedColumn): string {
  if (c.table) return `${c.table}.${c.column}`;
  if (c.alias) return `${c.alias}.${c.column}`;
  return c.column;
}

function describePredicate(p: Predicate): string {
  switch (p.kind) {
    case 'is-null':     return `is-null ${qualifiedColumnText(p.column)}`;
    case 'is-not-null': return `is-not-null ${qualifiedColumnText(p.column)}`;
    case 'eq':  return `${qualifiedColumnText(p.column)} = ${literalText(p.value)}`;
    case 'neq': return `${qualifiedColumnText(p.column)} != ${literalText(p.value)}`;
    case 'gt':  return `${qualifiedColumnText(p.column)} > ${literalText(p.value)}`;
    case 'gte': return `${qualifiedColumnText(p.column)} >= ${literalText(p.value)}`;
    case 'lt':  return `${qualifiedColumnText(p.column)} < ${literalText(p.value)}`;
    case 'lte': return `${qualifiedColumnText(p.column)} <= ${literalText(p.value)}`;
    case 'in':     return `${qualifiedColumnText(p.column)} IN (${p.values.map(literalText).join(', ')})`;
    case 'not-in': return `${qualifiedColumnText(p.column)} NOT IN (${p.values.map(literalText).join(', ')})`;
    case 'between': return `${qualifiedColumnText(p.column)} BETWEEN ${literalText(p.low)} AND ${literalText(p.high)}`;
    case 'like':   return `${qualifiedColumnText(p.column)} LIKE '${p.pattern}'`;
    case 'ilike':  return `${qualifiedColumnText(p.column)} ILIKE '${p.pattern}'`;
    case 'column-compare': {
      const opText: Record<string, string> = { eq: '=', neq: '!=', gt: '>', gte: '>=', lt: '<', lte: '<=' };
      return `${qualifiedColumnText(p.left)} ${opText[p.op]} ${qualifiedColumnText(p.right)}`;
    }
    case 'raw':    return p.sql;
  }
}

function literalText(v: LiteralValue): string {
  switch (v.kind) {
    case 'string':     return `'${v.value}'`;
    case 'number':     return String(v.value);
    case 'boolean':    return v.value ? 'TRUE' : 'FALSE';
    case 'null':       return 'NULL';
    case 'identifier': return v.ref;
    case 'parameter':  return v.name ? `:${v.name}` : `?${v.index ?? ''}`;
  }
}
