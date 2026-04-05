import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const uselessDefaultAssignmentVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/useless-default-assignment',
  languages: ['typescript', 'tsx'],
  nodeTypes: ['assignment_pattern'],
  visit(node, filePath, sourceCode) {
    // Detect: constructor(public name: string = undefined) or similar
    // where the default assignment to undefined/null is useless for a non-optional param
    const right = node.childForFieldName('right')
    if (!right) return null

    // Flag when default is undefined and the parameter has a non-optional type
    if (right.type !== 'identifier' || right.text !== 'undefined') return null

    const left = node.childForFieldName('left')
    if (!left) return null

    // Check if parent is a constructor parameter
    const parent = node.parent
    const grandParent = parent?.parent
    if (!grandParent) return null

    if (grandParent.type !== 'formal_parameters') return null

    const func = grandParent.parent
    if (!func || func.type !== 'method_definition') return null
    if (func.childForFieldName('name')?.text !== 'constructor') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Useless default assignment to undefined',
      `Default assignment to \`undefined\` is useless — the parameter is already \`undefined\` if not provided.`,
      sourceCode,
      'Remove the `= undefined` default assignment.',
    )
  },
}
