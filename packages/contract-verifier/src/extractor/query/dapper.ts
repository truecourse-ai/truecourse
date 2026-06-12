/**
 * Dapper raw-SQL query matcher. Detects `connection.Query<T>("SELECT …")` /
 * `Execute(...)` calls, reads the SQL string (following `+` concatenation and
 * `$"...{x}"` interpolation), and delegates to the language-agnostic
 * `buildQueriesFromSqlText`. Interpolation surfaces a `query.unparseable` entry,
 * exactly like the Python f-string path.
 */

import type { Node as SyntaxNode, Tree } from 'web-tree-sitter';
import type { ExtractedQuery } from './types.js';
import { buildQueriesFromSqlText } from './raw-sql.js';
import { readCsharpString, walkCs } from '../shared/cs-nodes.js';

const DAPPER_METHODS = new Set([
  'Query', 'QueryAsync', 'QueryFirst', 'QueryFirstAsync', 'QueryFirstOrDefault', 'QueryFirstOrDefaultAsync',
  'QuerySingle', 'QuerySingleOrDefault', 'QueryMultiple', 'Execute', 'ExecuteAsync', 'ExecuteScalar', 'ExecuteScalarAsync',
]);

export function extractDapperQueriesFromFile(filePath: string, source: string, tree: Tree): ExtractedQuery[] {
  const out: ExtractedQuery[] = [];
  walkCs(tree.rootNode, (node) => {
    if (node.type !== 'invocation_expression') return;
    const fn = node.childForFieldName('function');
    if (fn?.type !== 'member_access_expression') return;
    if (!DAPPER_METHODS.has(methodName(fn.childForFieldName('name'), source))) return;
    const arg0 = firstArgExpr(node.childForFieldName('arguments'));
    if (!arg0) return;
    const read = readCsharpString(arg0, source);
    if (!read) return;
    out.push(...buildQueriesFromSqlText(read.text, read.hasInterpolation, {
      filePath,
      lineStart: arg0.startPosition.row + 1,
      lineEnd: arg0.endPosition.row + 1,
    }, 'dapper'));
  });
  return out;
}

/** Method identifier, unwrapping `Query<T>` (generic_name). */
function methodName(node: SyntaxNode | null, source: string): string {
  if (!node) return '';
  if (node.type === 'generic_name') {
    const id = node.namedChild(0);
    return id ? source.slice(id.startIndex, id.endIndex) : '';
  }
  return source.slice(node.startIndex, node.endIndex);
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
