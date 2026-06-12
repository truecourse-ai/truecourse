import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName } from '../../../_shared/csharp-helpers.js'

/**
 * Empty catch block — errors are swallowed silently.
 *
 * Idiomatic C# that is NOT flagged:
 *   - `catch (OperationCanceledException) { }` / TaskCanceledException —
 *     the standard ignore-on-cancellation pattern
 *   - a single best-effort cleanup statement in the try body
 *     (`try { watcher.Dispose(); } catch { }`)
 *   - a single Parse/Deserialize attempt in the try body (tryParse pattern)
 *   - sequential try blocks forming a strategy chain
 */
const IGNORED_EXCEPTION_TYPES = new Set([
  'OperationCanceledException',
  'TaskCanceledException',
])

const BEST_EFFORT_METHODS = new Set([
  'Dispose', 'Close', 'Delete', 'Abort', 'Kill', 'Cancel', 'Flush', 'Stop',
])

export const csharpEmptyCatchVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/empty-catch',
  languages: ['csharp'],
  nodeTypes: ['catch_clause'],
  visit(node, filePath, sourceCode) {
    const body = node.childForFieldName('body')
    if (!body) return null
    const statements = body.namedChildren.filter((c) => c && c.type !== 'comment')
    if (statements.length !== 0) return null

    const decl = node.namedChildren.find((c) => c?.type === 'catch_declaration')
    const caughtType = decl?.childForFieldName('type')?.text.split('.').pop() ?? ''
    if (IGNORED_EXCEPTION_TYPES.has(caughtType)) return null

    const tryStmt = node.parent
    if (tryStmt?.type === 'try_statement') {
      const tryBody = tryStmt.childForFieldName('body')
      if (tryBody) {
        const tryStatements = tryBody.namedChildren.filter((c) => c && c.type !== 'comment')
        if (tryStatements.length === 1) {
          const stmt = tryStatements[0]!
          // tryParse pattern: a single parse/deserialize attempt
          if (/\b(Parse|TryParse|Deserialize)\s*[<(]/.test(stmt.text)) return null
          // Best-effort cleanup: a single Dispose/Close/Delete-style call
          const expr = stmt.namedChildren[0]
          if (expr?.type === 'invocation_expression' && BEST_EFFORT_METHODS.has(getCSharpMethodName(expr))) {
            return null
          }
          if (expr?.type === 'conditional_access_expression' && BEST_EFFORT_METHODS.has((expr.text.match(/\.(\w+)\s*\([^()]*\)\s*$/) ?? [])[1] ?? '')) {
            return null
          }
        }
      }

      // Strategy chain: multiple sequential try blocks in the same scope
      const parentBlock = tryStmt.parent
      if (parentBlock) {
        let tryCount = 0
        for (let i = 0; i < parentBlock.namedChildCount; i++) {
          if (parentBlock.namedChild(i)?.type === 'try_statement') tryCount++
        }
        if (tryCount >= 2) return null
      }
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Empty catch block',
      'This catch block swallows exceptions silently. Add error handling or at least log the exception.',
      sourceCode,
      'Log the exception or rethrow it; if intentionally ignoring, catch the specific exception type and add a comment.',
    )
  },
}
