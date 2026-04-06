import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const sparseArrayVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/sparse-array',
  languages: JS_LANGUAGES,
  nodeTypes: ['array'],
  visit(node, filePath, sourceCode) {
    // In tree-sitter, empty array slots show up as consecutive commas
    // Check the raw children for consecutive commas (ignoring whitespace)
    const children = node.children
    for (let i = 0; i < children.length - 1; i++) {
      if (children[i].text === ',' && children[i + 1].text === ',') {
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Sparse array',
          `Array literal \`${node.text}\` has empty slots — likely a typo or accidental extra comma.`,
          sourceCode,
          'Remove the extra comma or fill in the missing element.',
        )
      }
      // Also catch [,x] — comma right after [
      if (children[i].text === '[' && children[i + 1].text === ',') {
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Sparse array',
          `Array literal \`${node.text}\` has empty slots — likely a typo or accidental extra comma.`,
          sourceCode,
          'Remove the leading comma or fill in the missing element.',
        )
      }
    }
    return null
  },
}
