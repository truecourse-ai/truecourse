import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { CSHARP_FUNCTION_BOUNDARIES } from './_helpers.js'

/**
 * `catch (Exception ex) { _logger.LogError(…); throw ex; }` — rethrowing the
 * caught variable with `throw ex;` resets the stack trace to this line; the
 * original failure location is lost. Bare `throw;` preserves it.
 *
 * The single-statement `catch { throw ex; }` shape is owned by
 * reliability/catch-rethrow-no-context and is not double-flagged here.
 */
export const csharpLostErrorContextVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/lost-error-context',
  languages: ['csharp'],
  nodeTypes: ['catch_clause'],
  visit(node, filePath, sourceCode) {
    const decl = node.namedChildren.find((c) => c?.type === 'catch_declaration')
    const paramName = decl?.childForFieldName('name')?.text
    if (!paramName) return null

    const body = node.childForFieldName('body')
    if (!body) return null

    const statements = body.namedChildren.filter((c) => c && c.type !== 'comment')
    // catch-rethrow-no-context owns the single-statement rethrow shape
    if (statements.length <= 1) return null

    function findThrowEx(n: SyntaxNode): SyntaxNode | null {
      if (n.type === 'throw_statement') {
        const thrown = n.namedChildren[0]
        if (thrown?.type === 'identifier' && thrown.text === paramName) return n
      }
      if (CSHARP_FUNCTION_BOUNDARIES.has(n.type)) return null
      // A throw inside a nested catch refers to that catch's own context
      if (n.type === 'catch_clause') return null
      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i)
        if (child) {
          const found = findThrowEx(child)
          if (found) return found
        }
      }
      return null
    }

    const rethrow = findThrowEx(body)
    if (!rethrow) return null

    return makeViolation(
      this.ruleKey, rethrow, filePath, 'high',
      'Lost error context',
      `\`throw ${paramName};\` resets the exception's stack trace to this line — the original failure location is lost. Use bare \`throw;\` to preserve it.`,
      sourceCode,
      `Replace \`throw ${paramName};\` with \`throw;\`, or wrap: \`throw new ApplicationException("context", ${paramName});\`.`,
    )
  },
}
