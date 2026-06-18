/**
 * EF Core LINQ query matcher. Recognizes `_db.<DbSet>.Where(λ).Where(λ)…` chains
 * and turns each `.Where(o => <predicate>)` into a normalized `Predicate`, with
 * the lambda's property access resolved to its `[Column]` snake_case name so the
 * (language-agnostic) QueryRule comparator matches the spec columns.
 *
 * Mirrors the structure of the SQLAlchemy/Django ORM matchers, but for the C#
 * member-access invocation chain.
 */

import type { Node as SyntaxNode, Tree } from 'web-tree-sitter';
import type { LiteralValue, Predicate, QualifiedColumn } from '../../types/index.js';
import type { ExtractedQuery } from './types.js';
import { resolveColumn, type CsColumnMap } from '../shared/cs-column-map.js';
import { csStringText, namedChildOfType, walkCs } from '../shared/cs-nodes.js';
import { detectDateRangeBinding } from './raw-sql.js';

const FILTER_METHODS = new Set(['Where']);

export function extractEfcoreQueriesFromFile(
  filePath: string,
  source: string,
  tree: Tree,
  columns: CsColumnMap,
): ExtractedQuery[] {
  const out: ExtractedQuery[] = [];
  walkCs(tree.rootNode, (node) => {
    if (node.type !== 'invocation_expression' || isInnerChainCall(node)) return;
    const chain = collectChainInward(node);
    if (chain.length === 0) return;
    const root = rootReceiver(chain[chain.length - 1]);
    const dbSet = dbSetName(root, source);
    if (!root || !dbSet) return; // only `_db.<DbSet>.…` chains
    const className = dbSet.replace(/s$/, '');

    const predicates: Predicate[] = [];
    const unparseable: { reason: string; raw: string }[] = [];
    for (const call of chain) {
      const fn = call.childForFieldName('function');
      if (fn?.type !== 'member_access_expression') continue;
      const method = identText(fn.childForFieldName('name'), source);
      if (!FILTER_METHODS.has(method)) continue;
      const lambda = whereLambda(call);
      const body = lambda?.childForFieldName('body');
      if (!lambda || !body) continue;
      const param = lambdaParam(lambda, source);
      const p = efcoreLambda(body, param, source, columns, className);
      if (p) predicates.push(p);
      else unparseable.push({ reason: 'unrecognised LINQ predicate', raw: source.slice(body.startIndex, body.endIndex) });
    }

    out.push({
      entity: { table: dbSet },
      predicates,
      unparseable,
      source: { filePath, lineStart: root.startPosition.row + 1, lineEnd: node.endPosition.row + 1 },
      adapter: 'efcore',
      dateRangeBinding: detectDateRangeBinding(predicates),
    });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Chain walking
// ---------------------------------------------------------------------------

function isInnerChainCall(node: SyntaxNode): boolean {
  const parent = node.parent;
  if (parent?.type !== 'member_access_expression') return false;
  if (parent.childForFieldName('expression')?.id !== node.id) return false;
  return parent.parent?.type === 'invocation_expression';
}

function collectChainInward(outer: SyntaxNode): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  let cur: SyntaxNode | null = outer;
  while (cur && cur.type === 'invocation_expression') {
    out.push(cur);
    const fn = cur.childForFieldName('function');
    cur = fn?.type === 'member_access_expression' ? fn.childForFieldName('expression') : null;
  }
  return out;
}

function rootReceiver(innermostCall: SyntaxNode): SyntaxNode | null {
  return innermostCall.childForFieldName('function')?.childForFieldName('expression') ?? null;
}

function dbSetName(root: SyntaxNode | null, source: string): string | null {
  if (!root || root.type !== 'member_access_expression') return null;
  const expr = root.childForFieldName('expression');
  const name = root.childForFieldName('name');
  if (expr?.type !== 'identifier' || name?.type !== 'identifier') return null;
  return source.slice(name.startIndex, name.endIndex);
}

function whereLambda(call: SyntaxNode): SyntaxNode | null {
  const args = call.childForFieldName('arguments');
  if (!args) return null;
  for (let i = 0; i < args.namedChildCount; i++) {
    const arg = args.namedChild(i);
    if (!arg) continue;
    if (arg.type === 'lambda_expression') return arg;
    if (arg.type === 'argument') {
      const inner = arg.namedChild(0);
      if (inner?.type === 'lambda_expression') return inner;
    }
  }
  return null;
}

function lambdaParam(lambda: SyntaxNode, source: string): string {
  const p = lambda.childForFieldName('parameters');
  if (!p) return '';
  if (p.type === 'implicit_parameter') return source.slice(p.startIndex, p.endIndex);
  const first = p.namedChild(0);
  return first ? source.slice(first.startIndex, first.endIndex) : '';
}

// ---------------------------------------------------------------------------
// Predicate parsing
// ---------------------------------------------------------------------------

function efcoreLambda(
  body: SyntaxNode,
  param: string,
  source: string,
  columns: CsColumnMap,
  className: string,
): Predicate | null {
  if (body.type === 'binary_expression') {
    const left = body.childForFieldName('left');
    const right = body.childForFieldName('right');
    const opNode = body.childForFieldName('operator');
    if (!left || !right || !opNode) return null;
    const col = memberColumn(left, param, source, columns, className);
    if (!col) return null;
    const op = source.slice(opNode.startIndex, opNode.endIndex);
    if (right.type === 'null_literal') {
      if (op === '==') return { kind: 'is-null', column: col };
      if (op === '!=') return { kind: 'is-not-null', column: col };
      return null;
    }
    const kind = opKind(op);
    if (!kind) return null;
    const value = csharpLiteral(right, source) ?? { kind: 'parameter', name: source.slice(right.startIndex, right.endIndex) };
    return { kind, column: col, value };
  }
  if (body.type === 'invocation_expression') {
    const fn = body.childForFieldName('function');
    if (fn?.type !== 'member_access_expression') return null;
    if (identText(fn.childForFieldName('name'), source) !== 'Contains') return null;
    const recv = fn.childForFieldName('expression');
    const arg0 = firstArgExpr(body.childForFieldName('arguments'));
    if (!recv || !arg0) return null;
    const col = memberColumn(arg0, param, source, columns, className);
    if (!col) return null;
    return { kind: 'in', column: col, values: resolveLocalArray(recv, body, source) };
  }
  return null;
}

function memberColumn(
  node: SyntaxNode,
  param: string,
  source: string,
  columns: CsColumnMap,
  className: string,
): QualifiedColumn | null {
  if (node.type !== 'member_access_expression') return null;
  const expr = node.childForFieldName('expression');
  const name = node.childForFieldName('name');
  if (expr?.type !== 'identifier' || name?.type !== 'identifier') return null;
  if (source.slice(expr.startIndex, expr.endIndex) !== param) return null;
  const prop = source.slice(name.startIndex, name.endIndex);
  return { table: className.toLowerCase(), column: resolveColumn(columns, prop) };
}

function opKind(op: string): 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | null {
  switch (op) {
    case '==': return 'eq';
    case '!=': return 'neq';
    case '>': return 'gt';
    case '>=': return 'gte';
    case '<': return 'lt';
    case '<=': return 'lte';
    default: return null;
  }
}

function csharpLiteral(node: SyntaxNode, source: string): LiteralValue | null {
  switch (node.type) {
    case 'string_literal': return { kind: 'string', value: csStringText(node, source) ?? '' };
    case 'integer_literal': return { kind: 'number', value: parseInt(source.slice(node.startIndex, node.endIndex).replace(/_/g, ''), 10) };
    case 'real_literal': return { kind: 'number', value: parseFloat(source.slice(node.startIndex, node.endIndex).replace(/_/g, '')) };
    case 'boolean_literal': return { kind: 'boolean', value: source.slice(node.startIndex, node.endIndex) === 'true' };
    case 'null_literal': return { kind: 'null' };
    case 'identifier': return { kind: 'parameter', name: source.slice(node.startIndex, node.endIndex) };
    case 'member_access_expression': return { kind: 'identifier', ref: source.slice(node.startIndex, node.endIndex) };
    default: return null;
  }
}

/** `var allowed = new[] { "active" };` in the enclosing block → its literal values. */
function resolveLocalArray(recv: SyntaxNode, from: SyntaxNode, source: string): LiteralValue[] {
  if (recv.type !== 'identifier') return [];
  const name = source.slice(recv.startIndex, recv.endIndex);
  let block: SyntaxNode | null = from.parent;
  while (block && block.type !== 'block') block = block.parent;
  if (!block) return [];
  let init: SyntaxNode | null = null;
  walkCs(block, (n) => {
    if (init || n.type !== 'variable_declarator') return;
    const nm = n.childForFieldName('name');
    if (!nm || source.slice(nm.startIndex, nm.endIndex) !== name) return;
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i);
      if (c && c.id !== nm.id) { init = c; break; }
    }
  });
  if (!init) return [];
  const ie = (init as SyntaxNode).type === 'initializer_expression' ? init : namedChildOfType(init, 'initializer_expression');
  if (!ie) return [];
  const out: LiteralValue[] = [];
  for (let i = 0; i < ie.namedChildCount; i++) {
    const el = ie.namedChild(i);
    if (!el) continue;
    const lit = csharpLiteral(el, source);
    if (lit) out.push(lit);
  }
  return out;
}

function firstArgExpr(args: SyntaxNode | null): SyntaxNode | null {
  if (!args) return null;
  for (let i = 0; i < args.namedChildCount; i++) {
    const arg = args.namedChild(i);
    if (arg?.type === 'argument') return arg.namedChild(0) ?? null;
    if (arg && arg.type !== 'comment') return arg;
  }
  return null;
}

function identText(node: SyntaxNode | null, source: string): string {
  if (!node) return '';
  // `Query<T>` is a generic_name; its first child is the identifier.
  if (node.type === 'generic_name') {
    const id = node.namedChild(0);
    return id ? source.slice(id.startIndex, id.endIndex) : '';
  }
  return source.slice(node.startIndex, node.endIndex);
}
