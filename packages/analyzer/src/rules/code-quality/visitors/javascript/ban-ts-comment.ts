import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const banTsCommentVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/ban-ts-comment',
  languages: ['typescript', 'tsx'],
  nodeTypes: ['comment'],
  visit(node, filePath, sourceCode) {
    const text = node.text.trim()
    const match = text.match(/^\/\/\s*@(ts-ignore|ts-nocheck|ts-expect-error)\s*(.*)$/)
    if (!match) return null

    const directive = match[1]
    const description = match[2]?.trim()

    if (!description) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        `@${directive} without description`,
        `\`@${directive}\` suppresses TypeScript errors without explaining why. Add a reason.`,
        sourceCode,
        `Add a description after \`@${directive}\` explaining why the error is suppressed.`,
      )
    }
    return null
  },
}
