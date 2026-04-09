import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const emptyCatchVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/empty-catch',
  languages: JS_LANGUAGES,
  nodeTypes: ['catch_clause'],
  visit(node, filePath, sourceCode) {
    const body = node.childForFieldName('body')
    if (!body) return null
    const statements = body.namedChildren.filter((c) => c.type !== 'comment')
    if (statements.length === 0) {
      // Skip empty catch when the try body is a single JSON.parse() call (common tryParse pattern)
      const tryStmt = node.parent
      if (tryStmt?.type === 'try_statement') {
        const tryBody = tryStmt.childForFieldName('body')
        if (tryBody) {
          const tryStatements = tryBody.namedChildren.filter((c) => c.type !== 'comment')
          if (tryStatements.length === 1) {
            const stmtText = tryStatements[0].text
            if (/JSON\.parse\s*\(/.test(stmtText)) return null
          }
        }

        // Skip when there are multiple sequential try/catch blocks (strategy chain pattern)
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
        'This catch block swallows errors silently. Add error handling or at least log the error.',
        sourceCode,
        'Add error logging or re-throw the error in this catch block.',
      )
    }
    return null
  },
}
