import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonCommentTagFormattingVisitor: CodeRuleVisitor = {
  ruleKey: 'style/deterministic/comment-tag-formatting',
  languages: ['python'],
  nodeTypes: ['comment'],
  visit(node, filePath, sourceCode) {
    const text = node.text

    const match = text.match(/\b(TODO|FIXME|HACK|XXX)\s+[^:]/)
    if (match) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        `Malformed ${match[1]} comment`,
        `${match[1]} comment should use colon format: '${match[1]}: description'.`,
        sourceCode,
        `Format as: # ${match[1]}: description`,
      )
    }

    const emptyMatch = text.match(/\b(TODO|FIXME|HACK|XXX):?\s*$/)
    if (emptyMatch) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        `Empty ${emptyMatch[1]} comment`,
        `${emptyMatch[1]} comment has no description.`,
        sourceCode,
        `Add a description: # ${emptyMatch[1]}: what needs to be done`,
      )
    }

    return null
  },
}
