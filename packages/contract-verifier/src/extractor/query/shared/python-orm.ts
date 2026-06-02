/**
 * Shared Python ORM-chain machinery for the query adapters. SQLAlchemy
 * and Django both walk a `<receiver>.method(...).method(...)` chain and
 * collect `filter`-family predicates; only the entity-detection and the
 * per-argument predicate parsing differ. Those two are injected via
 * `OrmAdapter`, keeping `sqlalchemy.ts` / `django.ts` thin.
 */

import type { Node as SyntaxNode, Tree } from 'web-tree-sitter';
import type { LiteralValue, Predicate, QualifiedColumn } from '../../../types/index.js';
import type { ExtractedQuery, QueryAdapterName } from '../types.js';

export const FILTER_METHODS = new Set(['filter', 'exclude', 'filter_by', 'where']);

export interface OrmAdapter {
  adapter: QueryAdapterName;
  /** Identify the queried table from the chain, or null if this chain
   *  isn't this adapter's shape. */
  detectEntity(chain: SyntaxNode[], source: string): { table: string } | null;
  /** Parse one `filter(...)` argument into a predicate (null = opaque). */
  parseFilterArg(arg: SyntaxNode, method: string, source: string): Predicate | null;
}

export function extractOrmQueries(
  tree: Tree,
  source: string,
  filePath: string,
  spec: OrmAdapter,
): ExtractedQuery[] {
  const out: ExtractedQuery[] = [];
  const consumed = new Set<number>();

  walk(tree.rootNode, (node) => {
    if (node.type !== 'call') return true;
    if (consumed.has(node.id)) return true;
    if (isInnerChainCall(node)) return true;

    const chain = collectChainInward(node);
    const entity = spec.detectEntity(chain, source);
    if (!entity) return true;

    const predicates: Predicate[] = [];
    const unparseable: { reason: string; raw: string }[] = [];
    for (const call of chain) {
      const fn = call.childForFieldName('function');
      if (fn?.type !== 'attribute') continue;
      const method = fn.childForFieldName('attribute')?.text ?? '';
      if (!FILTER_METHODS.has(method)) continue;
      const args = call.childForFieldName('arguments');
      if (!args) continue;
      for (let i = 0; i < args.namedChildCount; i++) {
        const arg = args.namedChild(i);
        if (!arg) continue;
        const p = spec.parseFilterArg(arg, method, source);
        if (p) predicates.push(p);
        else unparseable.push({ reason: 'unrecognised filter expression', raw: source.slice(arg.startIndex, arg.endIndex) });
      }
    }

    for (const c of chain) consumed.add(c.id);
    const outer = chain[0];
    const root = chain[chain.length - 1];
    out.push({
      entity: { table: entity.table },
      predicates,
      unparseable,
      source: { filePath, lineStart: root.startPosition.row + 1, lineEnd: outer.endPosition.row + 1 },
      adapter: spec.adapter,
      dateRangeBinding: detectDateRangeBinding(predicates),
    });
    return true;
  });

  return out;
}

// ---------------------------------------------------------------------------
// Chain walking
// ---------------------------------------------------------------------------

/** A call is an inner chain link iff its result is the receiver of an
 *  outer `.method(...)` call. */
export function isInnerChainCall(node: SyntaxNode): boolean {
  const parent = node.parent;
  if (parent?.type !== 'attribute') return false;
  if (parent.childForFieldName('object')?.id !== node.id) return false;
  return parent.parent?.type === 'call';
}

/** Walk inward through `function.object` while it stays a call. */
export function collectChainInward(start: SyntaxNode): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  let cur: SyntaxNode | null = start;
  while (cur && cur.type === 'call') {
    out.push(cur);
    const fn = cur.childForFieldName('function');
    cur = fn?.type === 'attribute' ? fn.childForFieldName('object') : null;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Shared value / column parsing
// ---------------------------------------------------------------------------

export function opKind(op: string): Predicate['kind'] | null {
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

/** `Order.created_at` → {table: 'Order', column: 'created_at'}. */
export function columnFromAttribute(node: SyntaxNode, source: string): QualifiedColumn | null {
  if (node.type !== 'attribute') return null;
  const col = node.childForFieldName('attribute');
  if (!col) return null;
  const obj = node.childForFieldName('object');
  const table = obj?.type === 'identifier' ? source.slice(obj.startIndex, obj.endIndex) : undefined;
  return table ? { table, column: col.text } : { column: col.text };
}

export function pyLiteral(node: SyntaxNode, source: string): LiteralValue | null {
  switch (node.type) {
    case 'string': {
      let content = '';
      for (let i = 0; i < node.namedChildCount; i++) {
        const c = node.namedChild(i);
        if (c?.type === 'string_content') content += source.slice(c.startIndex, c.endIndex);
        else if (c?.type === 'interpolation') return null;
      }
      return { kind: 'string', value: content };
    }
    case 'integer': return { kind: 'number', value: parseInt(source.slice(node.startIndex, node.endIndex).replace(/_/g, ''), 10) };
    case 'float': return { kind: 'number', value: parseFloat(source.slice(node.startIndex, node.endIndex)) };
    case 'true': return { kind: 'boolean', value: true };
    case 'false': return { kind: 'boolean', value: false };
    case 'none': return { kind: 'null' };
    case 'identifier': return { kind: 'parameter', name: source.slice(node.startIndex, node.endIndex) };
    case 'attribute': return { kind: 'identifier', ref: source.slice(node.startIndex, node.endIndex) };
    default: return null;
  }
}

export function pyList(node: SyntaxNode, source: string): LiteralValue[] {
  if (node.type !== 'list' && node.type !== 'tuple' && node.type !== 'set') return [];
  const out: LiteralValue[] = [];
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (!c) continue;
    const v = pyLiteral(c, source);
    if (v) out.push(v);
  }
  return out;
}

function detectDateRangeBinding(predicates: Predicate[]): { column: QualifiedColumn } | undefined {
  const lowers = new Map<string, QualifiedColumn>();
  const uppers = new Map<string, QualifiedColumn>();
  for (const p of predicates) {
    if (p.kind === 'gte' || p.kind === 'gt') lowers.set(p.column.column, p.column);
    if (p.kind === 'lte' || p.kind === 'lt') uppers.set(p.column.column, p.column);
  }
  for (const [k, col] of lowers) if (uppers.has(k)) return { column: col };
  return undefined;
}

function walk(node: SyntaxNode, visit: (n: SyntaxNode) => boolean | void): void {
  const recurse = visit(node);
  if (recurse === false) return;
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (c) walk(c, visit);
  }
}
