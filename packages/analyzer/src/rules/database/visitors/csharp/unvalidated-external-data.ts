import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName, getCSharpArguments } from '../../../_shared/csharp-helpers.js'
import { usesEfCore } from '../../../_shared/csharp-framework-detection.js'
import { CSHARP_SQL_STRING_METHODS, receiverTokens } from './_helpers.js'

/**
 * Raw HTTP request data written straight to the database. In ASP.NET, data
 * bound through typed action parameters goes through model binding +
 * validation — the unvalidated path is reading the raw request collections
 * (`Request.Form["email"]`, `Request.Query["id"]`, `HttpContext.Request…`)
 * and passing them into a write.
 *
 * Partial by design: only DIRECT access inside the write call's arguments is
 * detected — values laundered through an intermediate local are missed (no
 * C# data-flow support).
 */

// EF Core / repository write methods. All of them collide with collection
// APIs (List.Add, Dictionary.Remove, …) so a db-shaped receiver is required.
const ORM_WRITE_METHODS = new Set([
  'Add', 'AddAsync', 'AddRange', 'AddRangeAsync',
  'Update', 'UpdateRange', 'Remove', 'RemoveRange', 'Attach',
  'Insert', 'InsertAsync',
])

// Receiver tokens that mark an ORM write target (`_db.Users.Add`,
// `session.Save`, `_repo.Insert`). 'context' is accepted only in EF Core
// files — elsewhere it usually names an HttpContext.
const ORM_RECEIVER_TOKENS = new Set(['db', 'database', 'session', 'repository', 'repo', 'uow', 'unitofwork'])

// Raw request collections on HttpRequest.
const RAW_REQUEST_PROPS = new Set(['Form', 'Query', 'QueryString', 'Body', 'Headers', 'Cookies', 'RouteValues'])

function hasOrmReceiver(invocation: SyntaxNode, efCoreFile: boolean): boolean {
  const fn = invocation.childForFieldName('function')
  if (fn?.type !== 'member_access_expression') return false
  const receiver = fn.childForFieldName('expression')
  if (!receiver) return false
  for (const token of receiverTokens(receiver.text)) {
    if (ORM_RECEIVER_TOKENS.has(token)) return true
    if (efCoreFile && (token === 'context' || token === 'ctx')) return true
  }
  return false
}

/** `Request.Form` / `HttpContext.Request.Query` / `req.Form` member access. */
function isRawRequestAccess(node: SyntaxNode): boolean {
  if (node.type !== 'member_access_expression') return false
  const name = node.childForFieldName('name')?.text
  if (!name || !RAW_REQUEST_PROPS.has(name)) return false
  const expr = node.childForFieldName('expression')
  if (!expr) return false
  const text = expr.text
  return text === 'Request' || text === 'request' || text === 'req' || text.endsWith('.Request')
}

function findRawRequestAccess(arg: SyntaxNode): SyntaxNode | null {
  if (isRawRequestAccess(arg)) return arg
  for (const child of arg.namedChildren) {
    if (!child) continue
    const found = findRawRequestAccess(child)
    if (found) return found
  }
  return null
}

export const csharpUnvalidatedExternalDataVisitor: CodeRuleVisitor = {
  ruleKey: 'database/deterministic/unvalidated-external-data',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    const methodName = getCSharpMethodName(node)

    const isSqlCall = CSHARP_SQL_STRING_METHODS.has(methodName)
    // cmd.Parameters.AddWithValue("@x", Request.Form["x"]) — parameterized
    // but still unvalidated raw input headed for the database.
    const isParameterBinding =
      methodName === 'AddWithValue' && /\.Parameters$/.test(
        node.childForFieldName('function')?.childForFieldName('expression')?.text ?? '',
      )
    const efCoreFile = usesEfCore(node)
    const isOrmWrite = ORM_WRITE_METHODS.has(methodName) && hasOrmReceiver(node, efCoreFile)

    if (!isSqlCall && !isOrmWrite && !isParameterBinding) return null

    for (const arg of getCSharpArguments(node)) {
      const access = findRawRequestAccess(arg)
      if (access) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Unvalidated external data used in database write',
          `Raw request data (\`${access.text}\`) passed directly to \`${methodName}()\` without validation. Bind it to a typed model (or validate with FluentValidation/DataAnnotations) before writing to the database.`,
          sourceCode,
          'Bind the request data to a validated DTO (model binding + DataAnnotations or FluentValidation) before using it in database operations.',
        )
      }
    }

    return null
  },
}
