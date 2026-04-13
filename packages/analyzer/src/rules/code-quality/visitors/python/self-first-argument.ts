import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

type SyntaxNode = import('tree-sitter').SyntaxNode

function isInsideClass(node: SyntaxNode): boolean {
  let parent = node.parent
  while (parent) {
    if (parent.type === 'class_definition') return true
    if (parent.type === 'function_definition') return false
    parent = parent.parent
  }
  return false
}

function hasDecorator(node: SyntaxNode, ...names: string[]): boolean {
  // Decorators may live on the function_definition itself OR on the parent
  // decorated_definition (the canonical tree-sitter Python AST shape).
  const targets = [node]
  if (node.parent?.type === 'decorated_definition') {
    targets.push(node.parent)
  }
  for (const target of targets) {
    for (const child of target.children) {
      if (child.type === 'decorator') {
        const dec = child.namedChildren[0]
        if (dec && names.includes(dec.text)) return true
      }
    }
  }
  return false
}

export const pythonSelfFirstArgumentVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/self-first-argument',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    if (!isInsideClass(node)) return null

    // Skip static methods (they don't have self)
    if (hasDecorator(node, 'staticmethod')) return null

    // Class methods use cls, not self
    if (hasDecorator(node, 'classmethod')) return null

    const params = node.childForFieldName('parameters')
    if (!params) return null

    const firstParam = params.namedChildren[0]
    if (!firstParam) return null

    let firstName: string | undefined
    if (firstParam.type === 'identifier') {
      firstName = firstParam.text
    } else if (firstParam.type === 'typed_parameter') {
      firstName = firstParam.namedChildren[0]?.text
    }

    if (!firstName || firstName === 'self') return null

    const nameNode = node.childForFieldName('name')
    const methodName = nameNode?.text ?? 'method'

    return makeViolation(
      this.ruleKey, firstParam, filePath, 'low',
      'Instance method self naming',
      `The first argument of instance method \`${methodName}\` is \`${firstName}\` instead of the conventional \`self\`. This is confusing and breaks IDE tooling.`,
      sourceCode,
      `Rename the first parameter to \`self\`.`,
    )
  },
}
