/**
 * SQLAlchemy query adapter. Recognizes `session.query(Model).filter(...)`
 * chains and maps each filter expression to a shared `Predicate`:
 *
 *   .filter(Order.created_at >= since)   → gte created_at
 *   .filter(Order.deleted_at.is_(None))  → is-null deleted_at
 *   .filter(Order.status.in_([...]))     → in status
 *   .filter_by(status="active")          → eq status
 */

import type { Node as SyntaxNode, Tree } from 'web-tree-sitter';
import type { Predicate } from '../../types/index.js';
import type { ExtractedQuery } from './types.js';
import { extractOrmQueries, columnFromAttribute, opKind, pyLiteral, pyList } from './shared/python-orm.js';

const NULL_METHODS = new Set(['is_', 'isnot', 'is_not']);

export function extractSqlalchemyQueriesFromFile(filePath: string, source: string, tree: Tree): ExtractedQuery[] {
  return extractOrmQueries(tree, source, filePath, {
    adapter: 'sqlalchemy',
    detectEntity(chain, src) {
      for (const call of chain) {
        const fn = call.childForFieldName('function');
        if (fn?.type === 'attribute' && fn.childForFieldName('attribute')?.text === 'query') {
          const arg = call.childForFieldName('arguments')?.namedChild(0);
          return { table: arg ? src.slice(arg.startIndex, arg.endIndex) : '' };
        }
      }
      return null;
    },
    parseFilterArg: sqlalchemyExpr,
  });
}

function sqlalchemyExpr(node: SyntaxNode, _method: string, source: string): Predicate | null {
  // Column comparison: Order.created_at >= since
  if (node.type === 'comparison_operator') {
    const left = node.namedChild(0);
    const right = node.namedChild(1);
    if (!left || !right) return null;
    const column = columnFromAttribute(left, source);
    if (!column) return null;
    const op = source.slice(left.endIndex, right.startIndex).trim();
    const value = pyLiteral(right, source) ?? { kind: 'parameter', name: source.slice(right.startIndex, right.endIndex) };
    const kind = opKind(op);
    if (!kind) return null;
    return { kind, column, value } as Predicate;
  }
  // Method form: Order.col.is_(None) / Order.col.in_([...]) / Order.col.like("x")
  if (node.type === 'call') {
    const fn = node.childForFieldName('function');
    if (fn?.type !== 'attribute') return null;
    const m = fn.childForFieldName('attribute')?.text ?? '';
    const recv = fn.childForFieldName('object');
    const column = recv ? columnFromAttribute(recv, source) : null;
    if (!column) return null;
    const callArgs = node.childForFieldName('arguments');
    if (NULL_METHODS.has(m)) {
      const a0 = callArgs?.namedChild(0);
      if (a0?.type !== 'none') return null;
      const negate = m === 'isnot' || m === 'is_not';
      return { kind: negate ? 'is-not-null' : 'is-null', column };
    }
    if (m === 'in_' || m === 'notin_' || m === 'not_in') {
      const a0 = callArgs?.namedChild(0);
      return { kind: m === 'in_' ? 'in' : 'not-in', column, values: a0 ? pyList(a0, source) : [] };
    }
    if (m === 'like' || m === 'ilike') {
      const a0 = callArgs?.namedChild(0);
      const lit = a0 ? pyLiteral(a0, source) : null;
      return lit?.kind === 'string' ? { kind: m, column, pattern: lit.value } : null;
    }
  }
  return null;
}
