import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const unnecessaryBlockVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unnecessary-block',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['statement_block'],
  visit(node, filePath, sourceCode) {
    const parent = node.parent
    if (!parent) return null

    const CONTROL_PARENTS = new Set([
      'function_declaration', 'function_expression', 'arrow_function', 'method_definition',
      'if_statement', 'else_clause', 'while_statement', 'for_statement', 'for_in_statement',
      'do_statement', 'try_statement', 'catch_clause', 'finally_clause', 'switch_case',
      'switch_default', 'class_body', 'program',
    ])

    if (CONTROL_PARENTS.has(parent.type)) return null

    if (parent.type === 'statement_block') {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Unnecessary block statement',
        'Standalone `{ }` block serves no purpose — remove it or use a function to create proper scope.',
        sourceCode,
        'Remove the unnecessary block or extract its contents into a named function.',
      )
    }

    return null
  },
}
