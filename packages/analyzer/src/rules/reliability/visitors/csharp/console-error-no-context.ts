import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpArguments } from '../../../_shared/csharp-helpers.js'

/**
 * `Console.WriteLine(ex)` / `Console.Error.WriteLine(ex)` with only the
 * caught exception and no message — the C# analog of `console.error(err)`.
 *
 * Tighter than the JS name-list heuristic: the lone argument must be the
 * parameter of an enclosing catch clause, so message strings that happen to
 * be named `error` never fire. The trade is recall — error variables passed
 * down to helpers are not tracked.
 */
const CONSOLE_RECEIVERS = new Set(['Console', 'System.Console', 'Console.Error', 'System.Console.Error'])

function enclosingCatchParamName(node: SyntaxNode): string | null {
  let current: SyntaxNode | null = node.parent
  while (current) {
    if (current.type === 'catch_clause') {
      const decl = current.namedChildren.find((c) => c?.type === 'catch_declaration')
      return decl?.childForFieldName('name')?.text ?? null
    }
    if (
      current.type === 'method_declaration' ||
      current.type === 'local_function_statement' ||
      current.type === 'lambda_expression' ||
      current.type === 'anonymous_method_expression'
    ) {
      // Function boundary before any catch clause — the call is not directly
      // in a catch body. Stop to avoid matching across scopes.
      return null
    }
    current = current.parent
  }
  return null
}

export const csharpConsoleErrorNoContextVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/console-error-no-context',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (fn?.type !== 'member_access_expression') return null
    if (fn.childForFieldName('name')?.text !== 'WriteLine') return null
    const receiver = fn.childForFieldName('expression')?.text ?? ''
    if (!CONSOLE_RECEIVERS.has(receiver)) return null

    const args = getCSharpArguments(node)
    if (args.length !== 1 || args[0]!.type !== 'identifier') return null

    const paramName = enclosingCatchParamName(node)
    if (!paramName || args[0]!.text !== paramName) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Exception logged without context',
      `${receiver}.WriteLine(${paramName}) logs only the exception. Add a descriptive message saying what operation failed.`,
      sourceCode,
      `Add context: ${receiver}.WriteLine($"Failed to <action>: {${paramName}}");`,
    )
  },
}
