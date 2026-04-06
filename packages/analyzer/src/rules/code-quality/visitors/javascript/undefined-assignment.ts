import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const undefinedAssignmentVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/undefined-assignment',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['assignment_expression', 'variable_declarator'],
  visit(node, filePath, sourceCode) {
    if (node.type === 'assignment_expression') {
      const right = node.childForFieldName('right')
      if (right?.text === 'undefined') {
        const left = node.childForFieldName('left')
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Assignment to undefined',
          `Assigning \`undefined\` to \`${left?.text ?? 'variable'}\` is confusing. Use \`delete\` or let the variable go out of scope.`,
          sourceCode,
          'Remove the assignment or use `delete obj.prop` for object properties.',
        )
      }
    }

    if (node.type === 'variable_declarator') {
      const value = node.childForFieldName('value')
      if (value?.text === 'undefined') {
        const name = node.childForFieldName('name')
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Initialization to undefined',
          `\`${name?.text ?? 'variable'} = undefined\` is redundant — variables are \`undefined\` by default when declared without a value.`,
          sourceCode,
          'Remove the `= undefined` initialization.',
        )
      }
    }

    return null
  },
}
