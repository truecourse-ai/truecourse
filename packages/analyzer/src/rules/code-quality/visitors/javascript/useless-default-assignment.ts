import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const uselessDefaultAssignmentVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/useless-default-assignment',
  languages: ['typescript', 'tsx'],
  nodeTypes: ['required_parameter', 'optional_parameter'],
  visit(node, filePath, sourceCode) {
    // Detect: constructor(public name: string = undefined) or similar
    // where the default assignment to undefined is useless.
    // In tree-sitter TS, parameters with defaults are required_parameter/optional_parameter
    // with '=' and the default value as children (not assignment_pattern).

    // Find the default value: look for '=' followed by an identifier 'undefined'
    let hasEquals = false
    let defaultNode: typeof node | null = null
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (!child) continue
      if (child.type === '=' || child.text === '=') {
        hasEquals = true
        continue
      }
      if (hasEquals && child.type === 'undefined') {
        defaultNode = child
        break
      }
      if (hasEquals && child.type === 'identifier' && child.text === 'undefined') {
        defaultNode = child
        break
      }
    }

    if (!defaultNode) return null

    // Check if parent is formal_parameters inside a constructor
    const parent = node.parent
    if (!parent || parent.type !== 'formal_parameters') return null

    const func = parent.parent
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
