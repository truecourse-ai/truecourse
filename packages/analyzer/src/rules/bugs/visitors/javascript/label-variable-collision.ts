import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const labelVariableCollisionVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/label-variable-collision',
  languages: JS_LANGUAGES,
  nodeTypes: ['labeled_statement'],
  visit(node, filePath, sourceCode) {
    const label = node.childForFieldName('label')
    if (!label || label.type !== 'statement_identifier') return null

    const labelName = label.text

    // Walk up to find if there's a variable with the same name in scope
    // Simplified: flag labels named after common JS globals or if the name is camelCase (likely a variable)
    // More specific: check if parent scope has a variable declaration with same name
    let current = node.parent
    while (current) {
      if (current.type === 'program' || current.type === 'function_declaration' || current.type === 'function' || current.type === 'arrow_function' || current.type === 'method_definition') {
        // Check for variable declarations with the same name in this scope
        function hasVarWithName(n: SyntaxNode, name: string): boolean {
          if (n.type === 'variable_declarator') {
            const varName = n.childForFieldName('name')
            if (varName?.text === name) return true
          }
          // Don't recurse into nested functions
          if (n !== current && (n.type === 'function_declaration' || n.type === 'arrow_function' || n.type === 'function')) return false
          for (let i = 0; i < n.childCount; i++) {
            const child = n.child(i)
            if (child && hasVarWithName(child, name)) return true
          }
          return false
        }

        if (hasVarWithName(current, labelName)) {
          return makeViolation(
            this.ruleKey, label, filePath, 'medium',
            'Label variable collision',
            `Label \`${labelName}\` shares a name with a variable in scope — this is confusing and error-prone.`,
            sourceCode,
            `Rename the label to a unique name that does not conflict with variables: e.g., \`${labelName}Loop\`.`,
          )
        }
        break
      }
      current = current.parent
    }
    return null
  },
}
