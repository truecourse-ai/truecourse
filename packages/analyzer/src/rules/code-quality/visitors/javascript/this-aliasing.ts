import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const thisAliasingVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/this-aliasing',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['variable_declarator'],
  visit(node, filePath, sourceCode) {
    const value = node.childForFieldName('value')
    if (!value || value.text !== 'this') return null

    const nameNode = node.childForFieldName('name')
    const name = nameNode?.text ?? 'variable'

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'This aliasing',
      `\`const ${name} = this\` creates an unnecessary alias. Use arrow functions to preserve \`this\` context instead.`,
      sourceCode,
      'Replace the `this` alias with an arrow function that captures `this` lexically.',
    )
  },
}
