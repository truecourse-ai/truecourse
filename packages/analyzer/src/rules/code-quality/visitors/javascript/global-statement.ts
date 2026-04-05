import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const jsVarDeclarationVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/global-statement',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['variable_declaration'],
  visit(node, filePath, sourceCode) {
    if (!node.text.startsWith('var ')) return null

    let parent = node.parent
    while (parent) {
      if (parent.type === 'function_declaration' || parent.type === 'function_expression'
        || parent.type === 'arrow_function' || parent.type === 'method_definition') {
        const nameNode = node.namedChildren[0]?.childForFieldName('name')
        const name = nameNode?.text || 'variable'
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          '`var` declaration',
          `\`var ${name}\` is function-scoped, not block-scoped. Use \`let\` or \`const\` instead.`,
          sourceCode,
          'Replace `var` with `let` or `const` for block scoping.',
        )
      }
      parent = parent.parent
    }
    return null
  },
}
