import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_FUNCTION_TYPES, getFunctionBody, getFunctionName } from './_helpers.js'

export const tooManyLinesVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/too-many-lines',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: JS_FUNCTION_TYPES,
  visit(node, filePath, sourceCode) {
    const bodyNode = getFunctionBody(node)
    if (!bodyNode) return null

    const lineCount = bodyNode.endPosition.row - bodyNode.startPosition.row + 1
    if (lineCount > 50) {
      const name = getFunctionName(node)
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Function too long',
        `Function \`${name}\` has ${lineCount} lines (max 50). Split into smaller, focused functions.`,
        sourceCode,
        'Extract logical sections into separate helper functions.',
      )
    }
    return null
  },
}
