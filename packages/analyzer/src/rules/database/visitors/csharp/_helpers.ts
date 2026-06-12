import type { Node as SyntaxNode } from 'web-tree-sitter'
import {
  getCSharpMethodName,
  getCSharpArguments,
  getCSharpStringText,
  isCSharpStringNode,
} from '../../../_shared/csharp-helpers.js'

// ---------------------------------------------------------------------------
// Control-flow helpers
// ---------------------------------------------------------------------------

/** Loop statements (tree-sitter-c-sharp: `foreach_statement`, NOT `for_each_statement`). */
export const CSHARP_LOOP_TYPES = new Set([
  'for_statement', 'foreach_statement', 'while_statement', 'do_statement',
])

const CSHARP_FUNCTION_BOUNDARY_TYPES = new Set([
  'method_declaration',
  'local_function_statement',
  'constructor_declaration',
  'lambda_expression',
  'anonymous_method_expression',
  'accessor_declaration',
])

export function isDescendantOf(node: SyntaxNode, ancestor: SyntaxNode): boolean {
  let current: SyntaxNode | null = node.parent
  while (current) {
    if (current.id === ancestor.id) return true
    current = current.parent
  }
  return false
}

/**
 * True when `node` sits inside the BODY of a loop (not the loop header —
 * `foreach (var o in db.Orders.ToList())` materializes once, not per
 * iteration). Stops at method/lambda boundaries.
 */
export function isInsideCSharpLoopBody(node: SyntaxNode): boolean {
  let current = node.parent
  while (current) {
    if (CSHARP_LOOP_TYPES.has(current.type)) {
      const body = current.childForFieldName('body')
      if (body && isDescendantOf(node, body)) return true
      // In the header of this loop — an outer loop may still contain us.
    }
    if (CSHARP_FUNCTION_BOUNDARY_TYPES.has(current.type)) return false
    current = current.parent
  }
  return false
}

/** The nearest enclosing foreach_statement whose BODY contains `node`, or null. */
export function getEnclosingForeachBody(node: SyntaxNode): SyntaxNode | null {
  let current = node.parent
  while (current) {
    if (current.type === 'foreach_statement') {
      const body = current.childForFieldName('body')
      if (body && isDescendantOf(node, body)) return current
    }
    if (CSHARP_FUNCTION_BOUNDARY_TYPES.has(current.type)) return null
    current = current.parent
  }
  return null
}

/** True when node is inside the body of a try statement (finally is assumed to clean up). */
export function isInsideCSharpTryBody(node: SyntaxNode): boolean {
  let current: SyntaxNode | null = node.parent
  while (current) {
    if (current.type === 'try_statement') {
      const body = current.childForFieldName('body')
      if (body && isDescendantOf(node, body)) return true
      return false
    }
    current = current.parent
  }
  return false
}

/** True when an ancestor (up to the enclosing function) is a `using (...) { }` statement. */
export function isInsideUsingStatement(node: SyntaxNode): boolean {
  let current: SyntaxNode | null = node.parent
  while (current) {
    if (current.type === 'using_statement') return true
    if (CSHARP_FUNCTION_BOUNDARY_TYPES.has(current.type)) return false
    current = current.parent
  }
  return false
}

// ---------------------------------------------------------------------------
// SQL string extraction (Dapper / EF Core raw SQL / ADO.NET commands)
// ---------------------------------------------------------------------------

/** Dapper / EF Core methods whose FIRST string argument is SQL text. */
export const CSHARP_SQL_STRING_METHODS = new Set([
  // Dapper extension methods on IDbConnection
  'Query', 'QueryAsync', 'QueryFirst', 'QueryFirstAsync',
  'QueryFirstOrDefault', 'QueryFirstOrDefaultAsync',
  'QuerySingle', 'QuerySingleAsync', 'QuerySingleOrDefault', 'QuerySingleOrDefaultAsync',
  'QueryMultiple', 'QueryMultipleAsync',
  'Execute', 'ExecuteAsync', 'ExecuteScalar', 'ExecuteScalarAsync',
  'ExecuteReader', 'ExecuteReaderAsync',
  // EF Core raw SQL
  'FromSqlRaw', 'FromSql', 'FromSqlInterpolated', 'SqlQuery', 'SqlQueryRaw',
  'ExecuteSqlRaw', 'ExecuteSqlRawAsync', 'ExecuteSql', 'ExecuteSqlAsync',
  'ExecuteSqlInterpolated', 'ExecuteSqlInterpolatedAsync',
])

/**
 * ADO.NET command types whose constructor's first argument is SQL. Known
 * provider prefixes only — `RelayCommand`/`DelegateCommand` (MVVM) and other
 * `*Command` classes must not match.
 */
const DB_COMMAND_TYPE_RE = /^(?:Sql|SqlCe|Npgsql|MySql|Sqlite|SQLite|Oracle|OleDb|Odbc|Fb|DB2|ClickHouse|DuckDB)Command$/

/**
 * String text of a C# string-literal node with interpolation holes kept
 * INLINE (`$"UPDATE {t} SET x = 1"` → `UPDATE {t} SET x = 1`). The shared
 * `getCSharpStringText` drops the literal segments of interpolated strings
 * that contain holes, which breaks SQL keyword matching — for interpolated
 * strings we strip the quotes from the raw node text instead.
 */
export function getCSharpSqlText(stringNode: SyntaxNode): string | null {
  if (!isCSharpStringNode(stringNode)) return null
  if (stringNode.type === 'interpolated_string_expression') {
    return stringNode.text.replace(/^[$@]+"+|"+$/g, '')
  }
  return getCSharpStringText(stringNode)
}

/** Node types that can carry an inline SQL string. Register visitors on these. */
export const CSHARP_SQL_NODE_TYPES = [
  'invocation_expression',
  'object_creation_expression',
  'assignment_expression',
]

/**
 * Extract the SQL string carried by a node, covering the three C# shapes:
 *   - `conn.Query<T>("SELECT …")` / `db.Database.ExecuteSqlRaw("…")` (invocation)
 *   - `new SqlCommand("SELECT …", conn)` (object creation)
 *   - `cmd.CommandText = "SELECT …"` (assignment)
 * Returns the SQL text (interpolation holes left in place) or null.
 */
export function getCSharpSqlString(node: SyntaxNode): string | null {
  if (node.type === 'invocation_expression') {
    const methodName = getCSharpMethodName(node)
    if (!CSHARP_SQL_STRING_METHODS.has(methodName)) return null
    const firstArg = getCSharpArguments(node)[0]
    if (!firstArg || !isCSharpStringNode(firstArg)) return null
    return getCSharpSqlText(firstArg)
  }
  if (node.type === 'object_creation_expression') {
    const typeName = node.childForFieldName('type')?.text ?? ''
    const simple = typeName.split('.').pop() ?? typeName
    if (!DB_COMMAND_TYPE_RE.test(simple)) return null
    const firstArg = getCSharpArguments(node)[0]
    if (!firstArg || !isCSharpStringNode(firstArg)) return null
    return getCSharpSqlText(firstArg)
  }
  if (node.type === 'assignment_expression') {
    const left = node.childForFieldName('left')
    if (left?.type !== 'member_access_expression') return null
    if (left.childForFieldName('name')?.text !== 'CommandText') return null
    const right = node.childForFieldName('right')
    if (!right || !isCSharpStringNode(right)) return null
    return getCSharpSqlText(right)
  }
  return null
}

// ---------------------------------------------------------------------------
// Receiver heuristics
// ---------------------------------------------------------------------------

/** Split an expression's text into lowercase tokens (camelCase / `_` / `.` boundaries). */
export function receiverTokens(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s_$.()<>\[\]?!]+/)
    .filter(Boolean)
    .map((t) => t.toLowerCase())
}

/**
 * Tokens that mark a receiver chain as a database object (`_db.Users`,
 * `dbContext.Orders`, `session.Save`, …).
 */
export const DB_RECEIVER_TOKENS = new Set([
  'db', 'database', 'context', 'ctx', 'session', 'uow', 'unitofwork',
  'conn', 'connection', 'datasource', 'repository', 'repo',
])

export function expressionHasDbToken(text: string, tokens: Set<string> = DB_RECEIVER_TOKENS): boolean {
  for (const token of receiverTokens(text)) {
    if (tokens.has(token)) return true
  }
  return false
}

/**
 * Walk a member/invocation/element-access chain down to its root identifier:
 * `order.Items.Where(…).ToList` → `order`; `_db.Orders` → `_db`.
 */
export function chainRootIdentifier(expr: SyntaxNode): SyntaxNode | null {
  let cur: SyntaxNode | null = expr
  while (cur) {
    if (cur.type === 'member_access_expression') {
      cur = cur.childForFieldName('expression')
      continue
    }
    if (cur.type === 'invocation_expression') {
      const fn = cur.childForFieldName('function')
      cur = fn?.type === 'member_access_expression' ? fn.childForFieldName('expression') : null
      continue
    }
    if (cur.type === 'element_access_expression') {
      cur = cur.childForFieldName('expression')
      continue
    }
    if (cur.type === 'identifier') return cur
    return null
  }
  return null
}

/**
 * Find the local_declaration_statement in `body` that declares `name`, or
 * null when `name` is not a local (parameter, field, …).
 */
export function findLocalDeclaration(body: SyntaxNode, name: string): SyntaxNode | null {
  const stack: SyntaxNode[] = [body]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (n.type === 'local_declaration_statement') {
      const varDecl = n.namedChildren.find((c) => c?.type === 'variable_declaration')
      for (const declarator of varDecl?.namedChildren ?? []) {
        if (declarator?.type !== 'variable_declarator') continue
        if (declarator.childForFieldName('name')?.text === name) return n
      }
    }
    for (const child of n.namedChildren) {
      if (child) stack.push(child)
    }
  }
  return null
}

/** True for `using var x = …;` / `await using var x = …;` declarations. */
export function declarationHasUsingModifier(declStatement: SyntaxNode): boolean {
  return declStatement.children.some((c) => c?.type === 'using')
}
