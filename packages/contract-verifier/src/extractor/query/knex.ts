/**
 * Knex chained-builder extractor.
 *
 * Recognizes patterns like:
 *
 *   db('jobs').where('status', 'Completed').whereNull('archived_at')
 *   knex('jobs as j').where({status: 'Completed'}).whereIn('market_id', [1,2,3])
 *   db.from('jobs').where('id', '>=', 100).where('id', '<', 200)
 *
 * Walks the tree, finds each chain rooted in a `db('table')` /
 * `knex('table')` / `db.from('table')` / `db.table('table')` call, and
 * collects predicates from every chain link recognised in
 * `WHERE_METHOD_HANDLERS`. Unknown chain links and non-literal args
 * land in `unparseable[]` so the comparator can surface coverage gaps
 * (per PLAN_GAP_1_QUERY_RULE.md Q2 — never silently drop).
 *
 * Date-range heuristic: if the same column appears in BOTH a `>=` (or
 * `>`) predicate and a `<` (or `<=`) predicate within one chain, that
 * column is recorded as `dateRangeBinding` — this is how the comparator
 * catches the DISCOVERY "date anchor" cluster.
 */

import type { Node as SyntaxNode, Tree } from 'web-tree-sitter';
import type { LiteralValue, Predicate, QualifiedColumn } from '../../types/index.js';
import type { ExtractedQuery } from './types.js';

// ---------------------------------------------------------------------------
// Method vocabulary
// ---------------------------------------------------------------------------

const WHERE_METHODS = new Set([
  'where', 'andWhere', 'orWhere',
  'whereNot',
  'whereIn', 'whereNotIn',
  'whereNull', 'whereNotNull',
  'whereBetween', 'whereNotBetween',
  'whereLike', 'whereILike',
  'whereRaw',
]);

const KNEX_ROOT_IDENTS = new Set(['db', 'knex']);
const FROM_TABLE_METHODS = new Set(['from', 'table']);

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function extractKnexQueriesFromFile(
  filePath: string,
  source: string,
  tree: Tree,
): ExtractedQuery[] {
  const results: ExtractedQuery[] = [];
  const consumed = new Set<number>();

  walk(tree.rootNode, (node) => {
    if (consumed.has(node.id)) return false;
    if (node.type !== 'call_expression') return true;

    // Only process the OUTERMOST call in a chain — peek at parent to
    // see if it's also part of the same chain.
    if (isInnerChainLink(node)) return true;

    const link = classifyCall(node, source);
    if (!link) return true;

    // Walk INWARD through the chain to find the root + collect each link.
    const chain = collectChainInward(node);
    if (chain.length === 0) return true;
    const outermost = node; // the call we entered on
    const root = chain[chain.length - 1]; // deepest receiver

    // Validate the chain is rooted in a Knex form (`db(...)` / `knex(...)` /
    // `db.from(...)` / `db.table(...)` etc.). If not, this isn't ours.
    const rootCls = classifyCall(root, source);
    if (rootCls?.method !== '__root__') return true;

    const tableInfo = parseTableFromRoot(root, source);
    if (!tableInfo) return true;

    for (const c of chain) consumed.add(c.id);

    // Process chain links in source order (outermost-to-innermost is
    // reverse of receiver-walk, so reverse). Skip the root itself.
    const linksOuterToInner = [...chain].reverse();
    const predicates: Predicate[] = [];
    const unparseable: { reason: string; raw: string }[] = [];

    for (const call of linksOuterToInner) {
      if (call === root) continue;
      const cls = classifyCall(call, source);
      if (!cls) {
        unparseable.push({ reason: 'non-where chain link', raw: textOf(call, source) });
        continue;
      }
      processWhereCall(cls, source, predicates, unparseable);
    }

    const dateRangeBinding = detectDateRangeBinding(predicates);

    results.push({
      entity: tableInfo,
      predicates,
      unparseable,
      source: {
        filePath,
        lineStart: root.startPosition.row + 1,
        lineEnd: outermost.endPosition.row + 1,
      },
      adapter: 'knex',
      dateRangeBinding,
    });
    return false; // children of this call are already consumed
  });

  return results;
}

// ---------------------------------------------------------------------------
// Chain walking
// ---------------------------------------------------------------------------

/**
 * `node` is a call_expression. Returns true iff its DIRECT parent is
 * a member_expression whose .object is `node` AND the grandparent is
 * itself a call_expression (i.e. `node` is the receiver of another
 * `.method()` call in the chain).
 */
function isInnerChainLink(node: SyntaxNode): boolean {
  const parent = node.parent;
  if (!parent || parent.type !== 'member_expression') return false;
  const objField = parent.childForFieldName('object');
  if (objField?.id !== node.id) return false;
  const grand = parent.parent;
  return grand?.type === 'call_expression';
}

/**
 * Walk from a call_expression INWARD through `.function.object` chain
 * until we hit something that isn't a call_expression — that's the
 * root. Returns [outer, ..., root] in receiver-walk order.
 */
function collectChainInward(start: SyntaxNode): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  let cur: SyntaxNode | null = start;
  while (cur && cur.type === 'call_expression') {
    out.push(cur);
    const fn = cur.childForFieldName('function');
    if (fn?.type === 'member_expression') {
      cur = fn.childForFieldName('object');
    } else {
      break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Call classification
// ---------------------------------------------------------------------------

interface ClassifiedCall {
  node: SyntaxNode;
  /** Method name (`where`, `whereIn`, etc.) or `__root__` for the chain root. */
  method: string;
  args: SyntaxNode[];
}

function classifyCall(node: SyntaxNode, _source: string): ClassifiedCall | null {
  if (node.type !== 'call_expression') return null;
  const fn = node.childForFieldName('function');
  const args = collectArgs(node);

  // Root form 1: `db('table')` — function is plain identifier
  if (fn?.type === 'identifier') {
    if (KNEX_ROOT_IDENTS.has(fn.text)) {
      return { node, method: '__root__', args };
    }
    return null;
  }

  // Root form 2: `db.from('table')` / `db.table('table')` / `this.knex(...)` — member_expression
  if (fn?.type === 'member_expression') {
    const propName = fn.childForFieldName('property')?.text ?? '';
    const objNode = fn.childForFieldName('object');

    // `db.from('jobs')` style root
    if (FROM_TABLE_METHODS.has(propName) && objNode && isKnexLikeIdentifier(objNode)) {
      return { node, method: '__root__', args };
    }
    // `this.knex('jobs')` style root — call_expression whose function is
    // member_expression `this.knex`; technically falls into the call
    // classification rather than member-from style.
    // For chain links, the receiver is whatever .object is — recognise
    // the where-family methods.
    if (WHERE_METHODS.has(propName)) {
      return { node, method: propName, args };
    }
    // Other methods (.select, .join, .orderBy, .limit, …) — skip silently;
    // they're not predicates but they're valid chain links.
    return { node, method: propName, args };
  }

  return null;
}

function isKnexLikeIdentifier(node: SyntaxNode): boolean {
  if (node.type === 'identifier') return KNEX_ROOT_IDENTS.has(node.text);
  if (node.type === 'member_expression') {
    // `this.knex`, `app.db`, etc.
    const prop = node.childForFieldName('property')?.text ?? '';
    return KNEX_ROOT_IDENTS.has(prop);
  }
  return false;
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

// ---------------------------------------------------------------------------
// Table parsing
// ---------------------------------------------------------------------------

function parseTableFromRoot(
  root: SyntaxNode,
  source: string,
): { table: string; alias?: string } | null {
  const args = collectArgs(root);
  if (args.length === 0) return null;
  const first = args[0];
  if (first.type !== 'string') return null;
  // Strip quotes from text
  const raw = textOf(first, source).slice(1, -1);
  return parseTableExpr(raw);
}

/** Parse `"table"`, `"table as t"`, `"schema.table"`, `"schema.table as t"`. */
function parseTableExpr(raw: string): { table: string; alias?: string } {
  const aliasMatch = raw.match(/^(.+?)\s+as\s+([\w_]+)$/i);
  if (aliasMatch) {
    return { table: aliasMatch[1].trim(), alias: aliasMatch[2].trim() };
  }
  return { table: raw.trim() };
}

// ---------------------------------------------------------------------------
// Predicate extraction per method
// ---------------------------------------------------------------------------

function processWhereCall(
  call: ClassifiedCall,
  source: string,
  out: Predicate[],
  unparseable: { reason: string; raw: string }[],
): void {
  const { method, args, node } = call;
  if (!WHERE_METHODS.has(method)) return; // .select(), .join() etc.

  switch (method) {
    case 'where':
    case 'andWhere': {
      processWhereVariadic(args, source, out, unparseable, node);
      return;
    }
    case 'orWhere': {
      // OR semantics fold into the same query result but change the
      // logical meaning of predicates. v1 marks them opaque so the
      // comparator doesn't conflate AND/OR.
      unparseable.push({
        reason: 'orWhere (OR semantics not modeled in v1)',
        raw: textOf(node, source),
      });
      return;
    }
    case 'whereNot': {
      // .whereNot('col', val) → neq col val
      // .whereNot({col: val}) → neq col val (object form)
      processWhereNotVariadic(args, source, out, unparseable, node);
      return;
    }
    case 'whereIn':
    case 'whereNotIn': {
      if (args.length < 2) {
        unparseable.push({ reason: `${method} with <2 args`, raw: textOf(node, source) });
        return;
      }
      const col = parseColumnArg(args[0], source);
      const vals = parseListArg(args[1], source);
      if (!col) {
        unparseable.push({ reason: `${method} column not literal`, raw: textOf(node, source) });
        return;
      }
      out.push({
        kind: method === 'whereIn' ? 'in' : 'not-in',
        column: col,
        values: vals,
      });
      return;
    }
    case 'whereNull':
    case 'whereNotNull': {
      if (args.length < 1) return;
      const col = parseColumnArg(args[0], source);
      if (!col) {
        unparseable.push({ reason: `${method} column not literal`, raw: textOf(node, source) });
        return;
      }
      out.push({
        kind: method === 'whereNull' ? 'is-null' : 'is-not-null',
        column: col,
      });
      return;
    }
    case 'whereBetween':
    case 'whereNotBetween': {
      if (args.length < 2) return;
      const col = parseColumnArg(args[0], source);
      const range = parseListArg(args[1], source);
      if (!col || range.length < 2) {
        unparseable.push({
          reason: `${method} bounds not literal`,
          raw: textOf(node, source),
        });
        return;
      }
      if (method === 'whereBetween') {
        out.push({ kind: 'between', column: col, low: range[0], high: range[1] });
      } else {
        unparseable.push({
          reason: 'whereNotBetween (no first-class predicate kind)',
          raw: textOf(node, source),
        });
      }
      return;
    }
    case 'whereLike':
    case 'whereILike': {
      if (args.length < 2) return;
      const col = parseColumnArg(args[0], source);
      const pat = parsePatternArg(args[1], source);
      if (!col || pat === null) {
        unparseable.push({ reason: `${method} args not literal`, raw: textOf(node, source) });
        return;
      }
      out.push({
        kind: method === 'whereLike' ? 'like' : 'ilike',
        column: col,
        pattern: pat,
      });
      return;
    }
    case 'whereRaw': {
      if (args.length < 1) return;
      const sql = parseRawSqlArg(args[0], source);
      out.push({ kind: 'raw', sql });
      return;
    }
    default:
      unparseable.push({ reason: `unhandled .${method}()`, raw: textOf(node, source) });
  }
}

/**
 * `.where(...)` overloads:
 *   - `.where('col', val)`               → eq
 *   - `.where('col', '<op>', val)`       → op
 *   - `.where({col1: v1, col2: v2})`     → multiple eq
 *   - `.where(fn)`                       → opaque sub-builder
 */
function processWhereVariadic(
  args: SyntaxNode[],
  source: string,
  out: Predicate[],
  unparseable: { reason: string; raw: string }[],
  callNode: SyntaxNode,
): void {
  if (args.length === 0) return;
  const first = args[0];

  // Object form: .where({col: val, …})
  if (first.type === 'object') {
    for (const [col, val] of objectKVs(first, source)) {
      const literal = parseValueArg(val, source);
      if (!literal) {
        unparseable.push({ reason: 'object-form value not literal', raw: textOf(val, source) });
        continue;
      }
      out.push({ kind: 'eq', column: { column: col }, value: literal });
    }
    return;
  }

  // Function form: .where((qb) => …)
  if (first.type === 'arrow_function' || first.type === 'function_expression') {
    unparseable.push({
      reason: '.where(callback) sub-builder (not unfolded in v1)',
      raw: textOf(callNode, source),
    });
    return;
  }

  // Positional: .where('col', val) or .where('col', '<op>', val)
  const col = parseColumnArg(first, source);
  if (!col) {
    unparseable.push({ reason: '.where column not literal', raw: textOf(callNode, source) });
    return;
  }
  if (args.length === 2) {
    const val = parseValueArg(args[1], source);
    if (!val) {
      unparseable.push({ reason: '.where value not literal', raw: textOf(callNode, source) });
      return;
    }
    out.push({ kind: 'eq', column: col, value: val });
    return;
  }
  if (args.length >= 3) {
    const op = parseStringLiteral(args[1], source);
    if (op === null) {
      unparseable.push({ reason: '.where(col, op, val) op not literal', raw: textOf(callNode, source) });
      return;
    }
    // Column-vs-column: `.where('t1.a', '>', db.ref('t2.b'))` — Knex's
    // way of referencing a column on the right-hand side.
    const rightColRef = parseColumnRefArg(args[2], source);
    if (rightColRef) {
      const cmpOp = opToCompareKind(op);
      if (cmpOp) {
        out.push({ kind: 'column-compare', left: col, op: cmpOp, right: rightColRef });
        return;
      }
    }
    const val = parseValueArg(args[2], source);
    if (!val) {
      unparseable.push({ reason: '.where(col, op, val) value not literal', raw: textOf(callNode, source) });
      return;
    }
    const pred = predicateForOp(op, col, val);
    if (pred) out.push(pred);
    else unparseable.push({ reason: `.where unknown operator '${op}'`, raw: textOf(callNode, source) });
    return;
  }
}

/**
 * Recognise Knex's `db.ref('t.col')` / `knex.ref('t.col')` form, which
 * names a column on the right-hand side of a where comparison.
 * Returns the parsed column or null if the arg isn't a ref() call.
 */
function parseColumnRefArg(node: SyntaxNode, source: string): QualifiedColumn | null {
  if (node.type !== 'call_expression') return null;
  const fn = node.childForFieldName('function');
  if (fn?.type !== 'member_expression') return null;
  const method = fn.childForFieldName('property')?.text ?? '';
  if (method !== 'ref') return null;
  const args = collectArgs(node);
  if (args.length < 1) return null;
  const colStr = parseStringLiteral(args[0], source);
  if (colStr === null) return null;
  return parseColumnExpr(colStr);
}

function opToCompareKind(op: string): 'eq'|'neq'|'gt'|'gte'|'lt'|'lte' | null {
  switch (op.toLowerCase().trim()) {
    case '=': case '==': return 'eq';
    case '!=': case '<>': return 'neq';
    case '>': return 'gt';
    case '>=': return 'gte';
    case '<': return 'lt';
    case '<=': return 'lte';
    default: return null;
  }
}

function processWhereNotVariadic(
  args: SyntaxNode[],
  source: string,
  out: Predicate[],
  unparseable: { reason: string; raw: string }[],
  callNode: SyntaxNode,
): void {
  if (args.length === 0) return;
  const first = args[0];
  if (first.type === 'object') {
    for (const [col, val] of objectKVs(first, source)) {
      const literal = parseValueArg(val, source);
      if (!literal) {
        unparseable.push({ reason: '.whereNot object value not literal', raw: textOf(val, source) });
        continue;
      }
      out.push({ kind: 'neq', column: { column: col }, value: literal });
    }
    return;
  }
  const col = parseColumnArg(first, source);
  if (!col || args.length < 2) {
    unparseable.push({ reason: '.whereNot args not literal', raw: textOf(callNode, source) });
    return;
  }
  const val = parseValueArg(args[1], source);
  if (!val) {
    unparseable.push({ reason: '.whereNot value not literal', raw: textOf(callNode, source) });
    return;
  }
  out.push({ kind: 'neq', column: col, value: val });
}

function predicateForOp(op: string, col: QualifiedColumn, val: LiteralValue): Predicate | null {
  switch (op.toLowerCase().trim()) {
    case '=':  case '==': return { kind: 'eq', column: col, value: val };
    case '!=': case '<>': return { kind: 'neq', column: col, value: val };
    case '>':  return { kind: 'gt',  column: col, value: val };
    case '>=': return { kind: 'gte', column: col, value: val };
    case '<':  return { kind: 'lt',  column: col, value: val };
    case '<=': return { kind: 'lte', column: col, value: val };
    case 'like':  return { kind: 'like',  column: col, pattern: literalToPatternString(val) };
    case 'ilike': return { kind: 'ilike', column: col, pattern: literalToPatternString(val) };
    case 'in':    return val.kind === 'string' ? null : null;
    default: return null;
  }
}

function literalToPatternString(v: LiteralValue): string {
  if (v.kind === 'string') return v.value;
  return JSON.stringify(v);
}

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

function parseColumnArg(node: SyntaxNode, source: string): QualifiedColumn | null {
  if (node.type !== 'string') return null;
  const raw = textOf(node, source).slice(1, -1);
  return parseColumnExpr(raw);
}

/** Parse `"col"`, `"table.col"`, `"alias.col"` — split on LAST dot. */
function parseColumnExpr(raw: string): QualifiedColumn {
  const lastDot = raw.lastIndexOf('.');
  if (lastDot < 0) return { column: raw };
  return { table: raw.slice(0, lastDot), column: raw.slice(lastDot + 1) };
}

function parseStringLiteral(node: SyntaxNode, source: string): string | null {
  if (node.type !== 'string') return null;
  return textOf(node, source).slice(1, -1);
}

function parseValueArg(node: SyntaxNode, source: string): LiteralValue | null {
  switch (node.type) {
    case 'string': {
      const raw = textOf(node, source);
      return { kind: 'string', value: raw.slice(1, -1) };
    }
    case 'number': {
      const text = textOf(node, source);
      const n = Number(text);
      if (Number.isNaN(n)) return null;
      return { kind: 'number', value: n };
    }
    case 'true':
      return { kind: 'boolean', value: true };
    case 'false':
      return { kind: 'boolean', value: false };
    case 'null':
      return { kind: 'null' };
    case 'identifier':
      // Variable reference — treat as parameter binding so the
      // comparator can distinguish "code passes a value" from "code
      // hard-codes a literal".
      return { kind: 'parameter', name: textOf(node, source) };
    case 'member_expression':
    case 'call_expression':
      // e.g. `req.query.status`, `NOW()` — preserve raw text.
      return { kind: 'identifier', ref: textOf(node, source) };
    default:
      return null;
  }
}

function parseListArg(node: SyntaxNode, source: string): LiteralValue[] {
  if (node.type !== 'array') return [];
  const out: LiteralValue[] = [];
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (!c) continue;
    const v = parseValueArg(c, source);
    if (v) out.push(v);
  }
  return out;
}

function parsePatternArg(node: SyntaxNode, source: string): string | null {
  return parseStringLiteral(node, source);
}

function parseRawSqlArg(node: SyntaxNode, source: string): string {
  if (node.type === 'string' || node.type === 'template_string') {
    return textOf(node, source);
  }
  return textOf(node, source);
}

function* objectKVs(
  objNode: SyntaxNode,
  _source: string,
): IterableIterator<[string, SyntaxNode]> {
  for (let i = 0; i < objNode.namedChildCount; i++) {
    const pair = objNode.namedChild(i);
    if (!pair) continue;
    if (pair.type !== 'pair') continue;
    const key = pair.childForFieldName('key');
    const value = pair.childForFieldName('value');
    if (!key || !value) continue;
    let keyName = '';
    if (key.type === 'property_identifier' || key.type === 'identifier') {
      keyName = key.text;
    } else if (key.type === 'string') {
      keyName = key.text.slice(1, -1);
    } else {
      continue;
    }
    yield [keyName, value];
  }
}

// ---------------------------------------------------------------------------
// Date-range heuristic
// ---------------------------------------------------------------------------

function detectDateRangeBinding(predicates: Predicate[]): { column: QualifiedColumn } | undefined {
  // Find columns appearing in BOTH a lower-bound (>= or >) and an
  // upper-bound (< or <=) predicate. The first such column wins —
  // single-binding-per-query is the typical case.
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

/**
 * Recursive walk. `visit` returns false to skip the node's children
 * (used when a chain consumes its entire subtree).
 */
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
