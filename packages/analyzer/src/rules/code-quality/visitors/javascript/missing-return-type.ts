import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const missingReturnTypeVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/missing-return-type',
  languages: ['typescript', 'tsx'],
  nodeTypes: ['function_declaration', 'method_definition'],
  visit(node, filePath, sourceCode) {
    // Only flag named functions (not arrow functions)
    const nameNode = node.childForFieldName('name')
    if (!nameNode) return null

    // Check if there is a return_type annotation
    const returnType = node.childForFieldName('return_type')
    if (returnType) return null

    const name = nameNode.text

    // Skip constructors
    if (name === 'constructor') return null

    return makeViolation(
      this.ruleKey, nameNode, filePath, 'low',
      `Missing return type on function '${name}'`,
      `Function \`${name}\` is missing an explicit return type annotation.`,
      sourceCode,
      `Add a return type: \`function ${name}(...): ReturnType { ... }\``,
    )
  },
}
