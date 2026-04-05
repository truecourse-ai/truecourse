import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { SyntaxNode } from 'tree-sitter'

export const noLabelVarVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/no-label-var',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['labeled_statement'],
  visit(node, filePath, sourceCode) {
    const labelNode = node.children[0]
    if (!labelNode || labelNode.type !== 'statement_identifier') return null
    const labelName = labelNode.text

    let scope: SyntaxNode | null = node.parent
    while (scope) {
      for (let i = 0; i < scope.namedChildCount; i++) {
        const child = scope.namedChild(i)
        if (child?.type === 'variable_declaration' || child?.type === 'lexical_declaration') {
          for (let j = 0; j < child.namedChildCount; j++) {
            const declarator = child.namedChild(j)
            const name = declarator?.childForFieldName('name')
            if (name?.text === labelName) {
              return makeViolation(
                this.ruleKey, node, filePath, 'medium',
                'Label shadows variable',
                `Label \`${labelName}\` has the same name as a variable in scope.`,
                sourceCode,
                'Rename the label to avoid confusion with the variable.',
              )
            }
          }
        }
      }
      scope = scope.parent
    }
    return null
  },
}
