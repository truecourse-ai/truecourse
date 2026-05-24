/**
 * Prisma client query extractor.
 *
 * Recognises calls of the form:
 *
 *   prisma.<model>.<op>({ where: { ... } })
 *   db.<model>.findMany({ where: { ... } })
 *
 * where `<op>` is one of: findMany, findFirst, findUnique, findFirstOrThrow,
 * findUniqueOrThrow, count, aggregate, groupBy, deleteMany, updateMany.
 *
 * `where` object syntax → Predicate algebra mapping:
 *
 *   { col: literal }                  → eq
 *   { col: null }                     → is-null
 *   { col: { not: null } }            → is-not-null
 *   { col: { not: literal } }         → neq
 *   { col: { gt|gte|lt|lte: lit } }   → corresponding op
 *   { col: { in: [...] } }            → in
 *   { col: { notIn: [...] } }         → not-in
 *   { col: { contains: 'x' } }        → like (%x%)
 *   { col: { startsWith: 'x' } }      → like (x%)
 *   { col: { endsWith: 'x' } }        → like (%x)
 *   { col: { mode: 'insensitive', ... } } → upgrades like → ilike
 *   { AND: [where, where, ...] }      → flatten
 *   { OR | NOT: ... }                 → opaque (semantics not modeled in v1)
 *
 * Date-range heuristic identical to the Knex adapter: if a column has
 * both a lower bound and an upper bound predicate, it's the date range.
 */

import type { Node as SyntaxNode, Tree } from 'web-tree-sitter';
import type { LiteralValue, Predicate, QualifiedColumn } from '../../types/index.js';
import type { ExtractedQuery } from './types.js';

const PRISMA_QUERY_METHODS = new Set([
  'findMany', 'findFirst', 'findUnique',
  'findFirstOrThrow', 'findUniqueOrThrow',
  'count', 'aggregate', 'groupBy',
  'deleteMany', 'updateMany',
]);

const PRISMA_CLIENT_IDENTS = new Set(['prisma', 'db', 'client']);

const RANGE_OPS: Record<string, Predicate['kind']> = {
  gt: 'gt', gte: 'gte', lt: 'lt', lte: 'lte',
};

export function extractPrismaQueriesFromFile(
  filePath: string,
  source: string,
  tree: Tree,
): ExtractedQuery[] {
  const results: ExtractedQuery[] = [];

  walk(tree.rootNode, (node) => {
    if (node.type !== 'call_expression') return true;

    const detected = detectPrismaQueryCall(node);
    if (!detected) return true;
    const { model, opMethod } = detected;

    // The where arg lives on the first call argument's `where` property.
    const args = collectArgs(node);
    const whereNode = findWhereProperty(args[0]);
    const predicates: Predicate[] = [];
    const unparseable: { reason: string; raw: string }[] = [];

    if (whereNode) {
      parseWhereObject(whereNode, source, predicates, unparseable, /*caseInsensitive*/ false);
    }
    // Else: query with no where (full-table scan) — still emit, predicates empty.

    const dateRangeBinding = detectDateRangeBinding(predicates);

    results.push({
      entity: { table: model },
      predicates,
      unparseable,
      source: {
        filePath,
        lineStart: node.startPosition.row + 1,
        lineEnd: node.endPosition.row + 1,
      },
      adapter: 'prisma',
      dateRangeBinding,
    });

    // Note: we intentionally don't return false here. Inside the args
    // (callbacks, nested objects) shouldn't contain another Prisma
    // chain root in practice; if they do, top-down walk picks them up.
    return true;
  });

  return results;
}

// ---------------------------------------------------------------------------
// Call detection: prisma.<model>.<op>(...)
// ---------------------------------------------------------------------------

function detectPrismaQueryCall(callNode: SyntaxNode): { model: string; opMethod: string } | null {
  const fn = callNode.childForFieldName('function');
  if (fn?.type !== 'member_expression') return null;

  // Outer property: the query method
  const opMethod = fn.childForFieldName('property')?.text ?? '';
  if (!PRISMA_QUERY_METHODS.has(opMethod)) return null;

  // .object should be `<clientIdent>.<model>` (another member_expression)
  const objNode = fn.childForFieldName('object');
  if (objNode?.type !== 'member_expression') return null;

  const model = objNode.childForFieldName('property')?.text ?? '';
  if (!model) return null;

  const clientNode = objNode.childForFieldName('object');
  if (!clientNode) return null;

  // Accept identifier (`prisma.user.findMany`) OR another member access
  // (`this.prisma.user.findMany`, `services.db.user.findMany`).
  if (clientNode.type === 'identifier') {
    if (!PRISMA_CLIENT_IDENTS.has(clientNode.text)) return null;
  } else if (clientNode.type === 'member_expression') {
    const tail = clientNode.childForFieldName('property')?.text ?? '';
    if (!PRISMA_CLIENT_IDENTS.has(tail)) return null;
  } else {
    return null;
  }

  return { model, opMethod };
}

// ---------------------------------------------------------------------------
// where parsing
// ---------------------------------------------------------------------------

function findWhereProperty(argNode: SyntaxNode | undefined): SyntaxNode | null {
  if (!argNode || argNode.type !== 'object') return null;
  for (let i = 0; i < argNode.namedChildCount; i++) {
    const pair = argNode.namedChild(i);
    if (pair?.type !== 'pair') continue;
    const key = pair.childForFieldName('key');
    const keyName = keyText(key);
    if (keyName === 'where') {
      return pair.childForFieldName('value');
    }
  }
  return null;
}

function parseWhereObject(
  obj: SyntaxNode,
  source: string,
  out: Predicate[],
  unparseable: { reason: string; raw: string }[],
  caseInsensitive: boolean,
): void {
  if (obj.type !== 'object') {
    unparseable.push({ reason: 'where not an object literal', raw: textOf(obj, source) });
    return;
  }

  for (let i = 0; i < obj.namedChildCount; i++) {
    const pair = obj.namedChild(i);
    if (pair?.type !== 'pair') continue;
    const key = pair.childForFieldName('key');
    const value = pair.childForFieldName('value');
    if (!key || !value) continue;
    const k = keyText(key);
    if (!k) continue;

    if (k === 'AND') {
      // value: array of where objects → flatten
      if (value.type !== 'array') {
        unparseable.push({ reason: 'AND value not array', raw: textOf(value, source) });
        continue;
      }
      for (let j = 0; j < value.namedChildCount; j++) {
        const sub = value.namedChild(j);
        if (sub) parseWhereObject(sub, source, out, unparseable, caseInsensitive);
      }
      continue;
    }
    if (k === 'OR' || k === 'NOT') {
      unparseable.push({
        reason: `${k} clause (semantics not modeled in v1)`,
        raw: textOf(pair, source),
      });
      continue;
    }

    parseFieldClause(k, value, source, out, unparseable, caseInsensitive);
  }
}

function parseFieldClause(
  column: string,
  value: SyntaxNode,
  source: string,
  out: Predicate[],
  unparseable: { reason: string; raw: string }[],
  caseInsensitive: boolean,
): void {
  const col: QualifiedColumn = { column };

  // Literal value form → eq (or is-null for null)
  const literal = parseLiteralValue(value, source);
  if (literal) {
    if (literal.kind === 'null') {
      out.push({ kind: 'is-null', column: col });
    } else {
      out.push({ kind: 'eq', column: col, value: literal });
    }
    return;
  }

  // Object-with-operators form → one or more predicates
  if (value.type === 'object') {
    // Check for `mode: 'insensitive'` first so we know to upgrade like→ilike.
    let mode = caseInsensitive;
    for (let i = 0; i < value.namedChildCount; i++) {
      const pair = value.namedChild(i);
      if (pair?.type !== 'pair') continue;
      const k = keyText(pair.childForFieldName('key'));
      if (k === 'mode') {
        const v = parseLiteralValue(pair.childForFieldName('value')!, source);
        if (v?.kind === 'string' && v.value === 'insensitive') mode = true;
      }
    }
    for (let i = 0; i < value.namedChildCount; i++) {
      const pair = value.namedChild(i);
      if (pair?.type !== 'pair') continue;
      const op = keyText(pair.childForFieldName('key'));
      const opValue = pair.childForFieldName('value');
      if (!op || !opValue || op === 'mode') continue;

      if (op === 'not') {
        const lit = parseLiteralValue(opValue, source);
        if (!lit) {
          unparseable.push({ reason: 'not operator value not literal', raw: textOf(pair, source) });
          continue;
        }
        if (lit.kind === 'null') {
          out.push({ kind: 'is-not-null', column: col });
        } else {
          out.push({ kind: 'neq', column: col, value: lit });
        }
        continue;
      }

      if (op === 'equals') {
        const lit = parseLiteralValue(opValue, source);
        if (lit) {
          if (lit.kind === 'null') out.push({ kind: 'is-null', column: col });
          else out.push({ kind: 'eq', column: col, value: lit });
        }
        continue;
      }

      if (RANGE_OPS[op]) {
        const lit = parseLiteralValue(opValue, source);
        if (!lit) {
          unparseable.push({ reason: `${op} value not literal`, raw: textOf(pair, source) });
          continue;
        }
        out.push({ kind: RANGE_OPS[op] as 'gt' | 'gte' | 'lt' | 'lte', column: col, value: lit });
        continue;
      }

      if (op === 'in' || op === 'notIn') {
        const arr = parseLiteralArray(opValue, source);
        out.push({
          kind: op === 'in' ? 'in' : 'not-in',
          column: col,
          values: arr,
        });
        continue;
      }

      if (op === 'contains' || op === 'startsWith' || op === 'endsWith') {
        const lit = parseLiteralValue(opValue, source);
        if (lit?.kind !== 'string') {
          unparseable.push({ reason: `${op} value not string`, raw: textOf(pair, source) });
          continue;
        }
        const pattern =
          op === 'contains'  ? `%${lit.value}%` :
          op === 'startsWith' ? `${lit.value}%` :
                                `%${lit.value}`;
        out.push({
          kind: mode ? 'ilike' : 'like',
          column: col,
          pattern,
        });
        continue;
      }

      // Unknown operator — opaque so coverage gap surfaces.
      unparseable.push({
        reason: `unsupported Prisma operator '${op}'`,
        raw: textOf(pair, source),
      });
    }
    return;
  }

  // Non-literal, non-object value (variable, member access, etc.)
  const ref = parseLiteralValue(value, source);
  if (ref) {
    out.push({ kind: 'eq', column: col, value: ref });
    return;
  }
  unparseable.push({ reason: 'field value not recognised', raw: textOf(value, source) });
}

// ---------------------------------------------------------------------------
// Literals
// ---------------------------------------------------------------------------

function parseLiteralValue(node: SyntaxNode, source: string): LiteralValue | null {
  switch (node.type) {
    case 'string': {
      const raw = textOf(node, source);
      return { kind: 'string', value: raw.slice(1, -1) };
    }
    case 'number': {
      const n = Number(textOf(node, source));
      if (Number.isNaN(n)) return null;
      return { kind: 'number', value: n };
    }
    case 'true':  return { kind: 'boolean', value: true };
    case 'false': return { kind: 'boolean', value: false };
    case 'null':  return { kind: 'null' };
    case 'identifier': return { kind: 'parameter', name: textOf(node, source) };
    case 'member_expression':
    case 'call_expression':
      return { kind: 'identifier', ref: textOf(node, source) };
    default:
      return null;
  }
}

function parseLiteralArray(node: SyntaxNode, source: string): LiteralValue[] {
  if (node.type !== 'array') return [];
  const out: LiteralValue[] = [];
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (!c) continue;
    const v = parseLiteralValue(c, source);
    if (v) out.push(v);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Date-range heuristic (shared shape with knex.ts)
// ---------------------------------------------------------------------------

function detectDateRangeBinding(predicates: Predicate[]): { column: QualifiedColumn } | undefined {
  const lowers = new Map<string, QualifiedColumn>();
  const uppers = new Map<string, QualifiedColumn>();
  for (const p of predicates) {
    if (p.kind === 'gte' || p.kind === 'gt') lowers.set(keyOf(p.column), p.column);
    if (p.kind === 'lte' || p.kind === 'lt') uppers.set(keyOf(p.column), p.column);
  }
  for (const [k, col] of lowers) {
    if (uppers.has(k)) return { column: col };
  }
  return undefined;
}

function keyOf(c: QualifiedColumn): string {
  return `${c.table ?? c.alias ?? ''}.${c.column}`;
}

// ---------------------------------------------------------------------------
// AST helpers
// ---------------------------------------------------------------------------

function walk(node: SyntaxNode, visit: (n: SyntaxNode) => boolean): void {
  const recurse = visit(node);
  if (recurse === false) return;
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (c) walk(c, visit);
  }
}

function textOf(node: SyntaxNode, source: string): string {
  return source.slice(node.startIndex, node.endIndex);
}

function keyText(key: SyntaxNode | null): string {
  if (!key) return '';
  if (key.type === 'property_identifier' || key.type === 'identifier') return key.text;
  if (key.type === 'string') return key.text.slice(1, -1);
  return '';
}

function collectArgs(callNode: SyntaxNode): SyntaxNode[] {
  const argList = callNode.childForFieldName('arguments');
  if (!argList) return [];
  const out: SyntaxNode[] = [];
  for (let i = 0; i < argList.namedChildCount; i++) {
    const c = argList.namedChild(i);
    if (c) out.push(c);
  }
  return out;
}
