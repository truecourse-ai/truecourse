import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

type SyntaxNode = import('tree-sitter').SyntaxNode

function hasPropertyDecorator(node: SyntaxNode): boolean {
  // In tree-sitter Python, decorators are siblings of function_definition in decorated_definition
  // The function_definition node itself doesn't have the decorators as children
  const parent = node.parent
  if (parent?.type === 'decorated_definition') {
    for (const child of parent.children) {
      if (child.type === 'decorator') {
        const decoratorContent = child.namedChildren[0]
        if (decoratorContent?.text === 'property') return true
        if (decoratorContent?.type === 'attribute') {
          const attr = decoratorContent.childForFieldName('attribute')
          if (attr?.text === 'getter') return true
        }
      }
    }
  }
  // Also check function's own children (older tree-sitter versions)
  for (const child of node.children) {
    if (child.type === 'decorator') {
      const decoratorContent = child.namedChildren[0]
      if (decoratorContent?.text === 'property') return true
    }
  }
  return false
}

export const pythonPropertyWithParametersVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/property-with-parameters',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    if (!hasPropertyDecorator(node)) return null

    const params = node.childForFieldName('parameters')
    if (!params) return null

    // Parameters beyond 'self' indicate extra arguments
    const paramList = params.namedChildren.filter((c) => c.type === 'identifier' || c.type === 'typed_parameter' || c.type === 'default_parameter')
    if (paramList.length <= 1) return null

    const nameNode = node.childForFieldName('name')
    const name = nameNode?.text || 'property'

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Property with parameters',
      `Property \`${name}\` is defined with parameters beyond \`self\`. Properties cannot accept arguments — calls to them will fail at runtime.`,
      sourceCode,
      'Remove the extra parameters. If you need a parameterized accessor, use a regular method instead of `@property`.',
    )
  },
}
