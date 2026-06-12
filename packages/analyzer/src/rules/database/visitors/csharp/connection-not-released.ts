import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import {
  getCSharpMethodName,
  getCSharpReceiver,
  getCSharpEnclosingFunctionBody,
} from '../../../_shared/csharp-helpers.js'
import {
  isInsideCSharpTryBody,
  isInsideUsingStatement,
  findLocalDeclaration,
  declarationHasUsingModifier,
  expressionHasDbToken,
} from './_helpers.js'

/**
 * A database connection opened without a guaranteed release path. Two C#
 * acquire shapes:
 *
 *  1. `var conn = new SqlConnection(cs); conn.Open();` — flagged at the
 *     Open()/OpenAsync() call when the local is not declared with `using`,
 *     not inside a using statement, and not closed/disposed in a finally.
 *  2. `var conn = dataSource.OpenConnection();` (NpgsqlDataSource /
 *     DbDataSource pool APIs) — same release checks at the acquire call.
 */

const OPEN_METHODS = new Set(['Open', 'OpenAsync'])

// Pool/data-source acquire calls that return an OPEN connection. GetConnection
// collides with non-database APIs, so it additionally requires a db-ish receiver.
const ACQUIRE_METHODS = new Set(['OpenConnection', 'OpenConnectionAsync'])
const AMBIGUOUS_ACQUIRE_METHODS = new Set(['GetConnection', 'GetConnectionAsync'])
const ACQUIRE_RECEIVER_TOKENS = new Set(['db', 'database', 'pool', 'datasource', 'source', 'factory'])

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * `conn = …; try { … } finally { conn.Close(); }` — the acquire sits above
 * the try, so isInsideCSharpTryBody misses it, but the connection IS released.
 */
function isClosedInFinally(functionBody: SyntaxNode, varName: string): boolean {
  const closePattern = new RegExp(
    `\\b${escapeRegExp(varName)}\\??\\.(?:Close|CloseAsync|Dispose|DisposeAsync|ReleaseConnection)\\s*\\(`,
  )
  const stack: SyntaxNode[] = [functionBody]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (n.type === 'finally_clause' && closePattern.test(n.text)) return true
    for (const child of n.namedChildren) {
      if (child) stack.push(child)
    }
  }
  return false
}

/** Resolve the declared variable name when `node` is the RHS of `var x = <node>;` (await unwrapped). */
function declaredVariableName(node: SyntaxNode): { name: string; declaration: SyntaxNode } | null {
  let parent: SyntaxNode | null = node.parent
  if (parent?.type === 'await_expression') parent = parent.parent
  if (parent?.type !== 'variable_declarator') return null
  const name = parent.childForFieldName('name')?.text
  if (!name) return null
  // variable_declarator → variable_declaration → local_declaration_statement | using_statement
  const declaration = parent.parent?.parent
  if (!declaration) return null
  return { name, declaration }
}

export const csharpConnectionNotReleasedVisitor: CodeRuleVisitor = {
  ruleKey: 'database/deterministic/connection-not-released',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    const methodName = getCSharpMethodName(node)

    // Shape 1: conn.Open() on a locally constructed connection.
    if (OPEN_METHODS.has(methodName)) {
      const fn = node.childForFieldName('function')
      if (fn?.type !== 'member_access_expression') return null
      const receiver = fn.childForFieldName('expression')
      // Fields (`_connection.Open()`) and chained receivers have a lifetime
      // owned elsewhere — only flag locals we can see being constructed.
      if (receiver?.type !== 'identifier') return null
      const varName = receiver.text

      const body = getCSharpEnclosingFunctionBody(node)
      if (!body) return null

      const decl = findLocalDeclaration(body, varName)
      if (!decl) return null // parameter or field — caller manages it

      // The local must actually hold a DB connection: `new NpgsqlConnection(…)`,
      // `factory.CreateConnection()`, `dataSource.OpenConnectionAsync()`, ….
      if (!/\bnew\s+\w*Connection\s*\(|Connection(?:Async)?\s*\(/.test(decl.text)) return null

      if (declarationHasUsingModifier(decl)) return null
      if (isInsideUsingStatement(node)) return null
      if (isInsideCSharpTryBody(node)) return null
      if (isClosedInFinally(body, varName)) return null

      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Database connection not released',
        `${varName}.${methodName}() opens a connection that is never guaranteed to be released — on an exception the connection leaks. Declare it with 'using' or close it in a finally block.`,
        sourceCode,
        `Declare the connection with 'using var ${varName} = …' (or wrap in try/finally calling ${varName}.Dispose()).`,
      )
    }

    // Shape 2: pooled acquire — var conn = dataSource.OpenConnection();
    const isAcquire =
      ACQUIRE_METHODS.has(methodName) ||
      (AMBIGUOUS_ACQUIRE_METHODS.has(methodName) &&
        expressionHasDbToken(getCSharpReceiver(node), ACQUIRE_RECEIVER_TOKENS))
    if (!isAcquire) return null

    // Only flag method calls on objects, not standalone helper functions.
    if (node.childForFieldName('function')?.type !== 'member_access_expression') return null

    const declared = declaredVariableName(node)
    // Not assigned to a local: `return ds.OpenConnection()` transfers ownership
    // to the caller; an expression-statement result is not a held resource.
    if (!declared) return null

    // `using (var conn = ds.OpenConnection())` — declaration hangs off the using_statement.
    if (declared.declaration.type === 'using_statement') return null
    if (declared.declaration.type === 'local_declaration_statement' && declarationHasUsingModifier(declared.declaration)) return null
    if (isInsideUsingStatement(node)) return null
    if (isInsideCSharpTryBody(node)) return null

    const body = getCSharpEnclosingFunctionBody(node)
    if (body && isClosedInFinally(body, declared.name)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Database connection not released',
      `${methodName}() acquires a pooled connection but it may never be returned to the pool if an error occurs. Declare it with 'using' or release it in a finally block.`,
      sourceCode,
      `Declare the connection with 'using var ${declared.name} = …' so it is disposed (returned to the pool) on every path.`,
    )
  },
}
