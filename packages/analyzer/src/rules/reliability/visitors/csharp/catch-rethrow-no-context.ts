import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Catch whose entire body is a bare rethrow (`throw;`) or `throw ex;` —
 * the try/catch adds nothing; `throw ex;` additionally resets the stack trace.
 *
 * NOT flagged (idiomatic C#):
 *   - a rethrow-only catch in a multi-catch try
 *     (`catch (OperationCanceledException) { throw; } catch (Exception ex) { … }`
 *     excludes a type from the general handler);
 *   - catches with a `when` filter (filters are used for side effects like
 *     logging without unwinding).
 */
export const csharpCatchRethrowNoContextVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/catch-rethrow-no-context',
  languages: ['csharp'],
  nodeTypes: ['catch_clause'],
  visit(node, filePath, sourceCode) {
    const tryStmt = node.parent
    if (!tryStmt || tryStmt.type !== 'try_statement') return null
    const catchCount = tryStmt.namedChildren.filter((c) => c?.type === 'catch_clause').length
    if (catchCount > 1) return null

    if (node.namedChildren.some((c) => c?.type === 'catch_filter_clause')) return null

    const body = node.namedChildren.find((c) => c?.type === 'block')
    if (!body) return null

    const stmts = body.namedChildren.filter((c) => c && c.type !== 'comment')
    if (stmts.length !== 1 || stmts[0]!.type !== 'throw_statement') return null

    const thrown = stmts[0]!.namedChildren[0]
    const decl = node.namedChildren.find((c) => c?.type === 'catch_declaration')
    const paramName = decl?.childForFieldName('name')?.text

    // `throw;` — preserves the stack trace but the whole try/catch is a no-op.
    if (!thrown) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Catch rethrows without adding context',
        'Catch block only rethrows. The try/catch adds nothing — remove it, or wrap the exception with context.',
        sourceCode,
        'Remove the try/catch, or wrap: throw new InvalidOperationException("Context…", ex);',
      )
    }

    // `throw ex;` — no context added AND the original stack trace is destroyed.
    if (thrown.type === 'identifier' && paramName && thrown.text === paramName) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Catch rethrows without adding context',
        `Catch block rethrows '${paramName}' without adding context — and 'throw ${paramName};' resets the original stack trace.`,
        sourceCode,
        `Wrap the exception (throw new InvalidOperationException("Context…", ${paramName});) or use bare 'throw;' if the catch is needed at all.`,
      )
    }

    return null
  },
}
