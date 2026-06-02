/**
 * Django ORM query adapter. Recognizes `Model.objects.filter(...)` /
 * `.exclude(...)` chains and maps each `field__lookup=value` keyword to a
 * shared `Predicate`:
 *
 *   .filter(status__in=["active"])  → in status
 *   .filter(balance__gte=100)       → gte balance
 *   .filter(deleted_at__isnull=True)→ is-null deleted_at
 *   .exclude(status="archived")     → neq status
 */

import type { Node as SyntaxNode, Tree } from 'web-tree-sitter';
import type { Predicate, QualifiedColumn } from '../../types/index.js';
import type { ExtractedQuery } from './types.js';
import { extractOrmQueries, pyLiteral, pyList } from './shared/python-orm.js';

const DJANGO_LOOKUPS: Record<string, Predicate['kind']> = {
  exact: 'eq', gt: 'gt', gte: 'gte', lt: 'lt', lte: 'lte', in: 'in',
  contains: 'like', icontains: 'ilike', startswith: 'like', endswith: 'like',
};

export function extractDjangoQueriesFromFile(filePath: string, source: string, tree: Tree): ExtractedQuery[] {
  return extractOrmQueries(tree, source, filePath, {
    adapter: 'django',
    detectEntity(chain, src) {
      for (const call of chain) {
        const fn = call.childForFieldName('function');
        if (fn?.type !== 'attribute') continue;
        const obj = fn.childForFieldName('object');
        if (obj?.type === 'attribute' && obj.childForFieldName('attribute')?.text === 'objects') {
          const modelNode = obj.childForFieldName('object');
          return { table: modelNode ? src.slice(modelNode.startIndex, modelNode.endIndex) : '' };
        }
      }
      return null;
    },
    parseFilterArg: djangoKeyword,
  });
}

function djangoKeyword(arg: SyntaxNode, method: string, source: string): Predicate | null {
  if (arg.type !== 'keyword_argument') return null;
  const nameNode = arg.childForFieldName('name');
  const valueNode = arg.childForFieldName('value');
  if (!nameNode || !valueNode) return null;
  const key = source.slice(nameNode.startIndex, nameNode.endIndex);
  const parts = key.split('__');
  const lookup = parts.length > 1 ? parts[parts.length - 1] : 'exact';
  const column: QualifiedColumn = { column: parts[0] };

  if (lookup === 'isnull') {
    const lit = pyLiteral(valueNode, source);
    const isTrue = lit?.kind === 'boolean' && lit.value === true;
    return { kind: isTrue ? 'is-null' : 'is-not-null', column };
  }
  if (lookup === 'in') {
    return { kind: method === 'exclude' ? 'not-in' : 'in', column, values: pyList(valueNode, source) };
  }
  const kind = DJANGO_LOOKUPS[lookup];
  if (!kind) return null;
  if (kind === 'like' || kind === 'ilike') {
    const lit = pyLiteral(valueNode, source);
    return lit?.kind === 'string' ? { kind, column, pattern: lit.value } : null;
  }
  const value = pyLiteral(valueNode, source);
  if (!value) return null;
  if (method === 'exclude' && kind === 'eq') return { kind: 'neq', column, value };
  return { kind: kind as 'eq' | 'gt' | 'gte' | 'lt' | 'lte', column, value };
}
