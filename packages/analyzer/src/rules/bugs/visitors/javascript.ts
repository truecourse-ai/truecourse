/**
 * Bugs domain JS/TS visitors.
 */

import type { CodeRuleVisitor } from '../../types.js'
import { makeViolation } from '../../types.js'

export const emptyCatchVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/empty-catch',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['catch_clause'],
  visit(node, filePath, sourceCode) {
    const body = node.childForFieldName('body')
    if (!body) return null
    const statements = body.namedChildren.filter((c) => c.type !== 'comment')
    if (statements.length === 0) {
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

export const BUGS_JS_VISITORS: CodeRuleVisitor[] = [
  emptyCatchVisitor,
]
