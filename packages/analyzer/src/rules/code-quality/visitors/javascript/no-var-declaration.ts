import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const noVarDeclarationVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/no-var-declaration',
  languages: ['javascript'],
  nodeTypes: ['variable_declaration'],
  visit(node, filePath, sourceCode) {
    if (!node.text.startsWith('var ')) return null

    const nameNode = node.namedChildren[0]?.childForFieldName('name')
    const name = nameNode?.text || 'variable'
    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      '`var` declaration',
      `\`var ${name}\` is function-scoped and error-prone. Use \`let\` or \`const\` instead.`,
      sourceCode,
      'Replace `var` with `let` or `const`.',
    )
  },
}
