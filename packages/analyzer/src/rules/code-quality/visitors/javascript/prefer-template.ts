import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects any string concatenation using + where a template literal could be used.
 * Unlike prefer-template-literal which only flags string+non-string, this flags
 * any binary + where one operand is a string literal.
 */
export const preferTemplateVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/prefer-template',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    const operator = node.children.find((c) => c.type === '+')
    if (!operator) return null

    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    if (!left || !right) return null

    // Skip if both are string literals (string concat already caught)
    const leftIsString = left.type === 'string'
    const rightIsString = right.type === 'string'

    // Skip if neither side is a string literal
    if (!leftIsString && !rightIsString) return null
    // Skip if both are string literals (pure string concat, no template benefit)
    if (leftIsString && rightIsString) return null

    // Skip if inside a template literal (those are handled separately)
    let ancestor = node.parent
    while (ancestor) {
      if (ancestor.type === 'template_string' || ancestor.type === 'template_literal') return null
      ancestor = ancestor.parent
    }

    // Skip if this is already inside another + expression (avoid double-reporting)
    const parent = node.parent
    if (parent?.type === 'binary_expression') {
      const parentOp = parent.children.find((c) => c.type === '+')
      if (parentOp) return null
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'String concatenation',
      'Using `+` for string concatenation — consider using a template literal for better readability.',
      sourceCode,
      'Replace string concatenation with a template literal: `` `text ${expr}` ``.',
    )
  },
}
