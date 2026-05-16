import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const consoleErrorNoContextVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/console-error-no-context',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'member_expression') return null

    const obj = fn.childForFieldName('object')
    const prop = fn.childForFieldName('property')
    if (obj?.text !== 'console' || prop?.text !== 'error') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    // Only flag if there's exactly one argument that looks like an error variable
    if (args.namedChildren.length !== 1) return null

    // Skip inside .catch() callbacks — the catch handler context is self-evident
    let parent = node.parent
    while (parent) {
      if (parent.type === 'arrow_function' || parent.type === 'function_expression' || parent.type === 'function') {
        if (parent.parent?.type === 'arguments') {
          const callFn = parent.parent.parent?.childForFieldName('function')
          if (callFn?.type === 'member_expression') {
            const method = callFn.childForFieldName('property')
            if (method?.text === 'catch') return null
          }
        }
        break
      }
      parent = parent.parent
    }

    // Skip files where console.error in catch is idiomatic / non-production:
    // - scripts/ and seeds/ (dev tooling, console output is expected)
    if (/\/(?:scripts?|seeds?)\//.test(filePath)) return null

    // Fire only when:
    //   1. enclosing try has a finally (structured swallow with cleanup)
    //   2. catch body has ≥2 statements: console.error + a return-like (return,
    //      throw, break, continue) — indicates explicit error swallowing
    // Single-statement catches `} catch (e) { console.error(e); }` with finally
    // are typically UI cleanup patterns where the error IS reported via the
    // finally side-effect (e.g., setting an error state). Multi-statement
    // catches with an explicit return-like are real swallows.
    let catchClause: typeof node | null = null
    let cursor: typeof node | null = node.parent
    while (cursor) {
      if (cursor.type === 'catch_clause') { catchClause = cursor; break }
      if (cursor.type === 'function_declaration' || cursor.type === 'function_expression' ||
          cursor.type === 'arrow_function' || cursor.type === 'method_definition') break
      cursor = cursor.parent
    }
    if (!catchClause) return null
    const tryStmt = catchClause.parent
    if (!tryStmt || tryStmt.type !== 'try_statement') return null
    const hasFinally = tryStmt.namedChildren.some((c) => c.type === 'finally_clause')
    if (!hasFinally) return null

    // Count catch body statements; require ≥2 with a return-like sibling.
    const block = catchClause.namedChildren.find((c) => c.type === 'statement_block')
    if (!block) return null
    let consoleErrorPresent = false
    let hasReturnLike = false
    for (let i = 0; i < block.namedChildCount; i++) {
      const stmt = block.namedChild(i)
      if (!stmt) continue
      if (stmt.type === 'return_statement' || stmt.type === 'throw_statement' ||
          stmt.type === 'break_statement' || stmt.type === 'continue_statement') {
        hasReturnLike = true
      }
      // Detect if this stmt is the console.error call_expression we're inspecting
      if (stmt.type === 'expression_statement') {
        const expr = stmt.namedChild(0)
        if (expr && expr.id === node.id) consoleErrorPresent = true
      }
    }
    if (!consoleErrorPresent || !hasReturnLike) return null

    const arg = args.namedChildren[0]
    if (arg.type === 'identifier') {
      const name = arg.text.toLowerCase()
      if (name === 'e' || name === 'err' || name === 'error' || name === 'ex') {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'console.error() without context',
          `console.error(${arg.text}) logs only the error object. Add a descriptive message for better debugging.`,
          sourceCode,
          `Add context: console.error('Failed to <action>:', ${arg.text});`,
        )
      }
    }

    return null
  },
}
