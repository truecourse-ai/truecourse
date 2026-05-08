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
        // Skip module-scope \`let\` reset: \`let timer = ...; timer =
        // undefined;\` after a clear-call. \`delete\` doesn't apply
        // to bindings, and the binding can't go out of scope.
        if (left?.type === 'identifier') {
          let scope = node.parent
          while (scope) {
            if (scope.type === 'function_declaration' ||
                scope.type === 'arrow_function' ||
                scope.type === 'function_expression' ||
                scope.type === 'method_definition') break
            if (scope.type === 'program') {
              // Truly module-scope assignment to a let binding —
              // canonical reset pattern.
              return null
            }
            scope = scope.parent
          }
        }
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
