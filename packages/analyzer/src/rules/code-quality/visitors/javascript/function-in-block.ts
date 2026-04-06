import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const functionInBlockVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/function-in-block',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['function_declaration'],
  visit(node, filePath, sourceCode) {
    const parent = node.parent
    if (!parent) return null

    if (parent.type === 'statement_block') {
      const grandparent = parent.parent
      const CONTROL_TYPES = new Set(['if_statement', 'else_clause', 'while_statement', 'for_statement',
        'for_in_statement', 'do_statement', 'switch_case', 'switch_default'])
      if (grandparent && CONTROL_TYPES.has(grandparent.type)) {
        const nameNode = node.childForFieldName('name')
        const name = nameNode?.text || 'anonymous'
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Function declaration in block',
          `Function \`${name}\` is declared inside a control flow block. Behavior is inconsistent across environments.`,
          sourceCode,
          'Move the function declaration outside the block, or use a function expression assigned to a `const`.',
        )
      }
    }
    return null
  },
}
