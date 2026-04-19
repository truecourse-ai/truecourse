import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

type SyntaxNode = import('web-tree-sitter').Node

function usesSelf(body: SyntaxNode): boolean {
  // Walk the AST looking for any reference to 'self'
  function walk(n: SyntaxNode): boolean {
    if (n.type === 'identifier' && n.text === 'self') return true
    // Don't descend into nested functions
    if (n.type === 'function_definition' || n.type === 'lambda') return false
    for (let i = 0; i < n.childCount; i++) {
      const child = n.child(i)
      if (child && walk(child)) return true
    }
    return false
  }
  return walk(body)
}

function isInClass(node: SyntaxNode): boolean {
  let parent = node.parent
  while (parent) {
    if (parent.type === 'class_definition') return true
    if (parent.type === 'function_definition') return false
    parent = parent.parent
  }
  return false
}

export const pythonNoSelfUseVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/no-self-use',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    if (!isInClass(node)) return null

    const params = node.childForFieldName('parameters')
    if (!params) return null

    // Check first parameter is 'self'
    const firstParam = params.namedChildren[0]
    if (!firstParam) return null
    const firstName = firstParam.type === 'identifier' ? firstParam.text : firstParam.namedChildren[0]?.text
    if (firstName !== 'self') return null

    // Skip static/class methods (decorated with @staticmethod or @classmethod)
    for (const child of node.children) {
      if (child.type === 'decorator') {
        const dec = child.namedChildren[0]
        if (dec?.text === 'staticmethod' || dec?.text === 'classmethod') return null
        if (dec?.text === 'property') return null
      }
    }

    const body = node.childForFieldName('body')
    if (!body) return null

    if (!usesSelf(body)) {
      const nameNode = node.childForFieldName('name')
      const name = nameNode?.text || 'method'

      // Skip abstract methods, dunder methods
      if (name.startsWith('__') && name.endsWith('__')) return null

      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Method does not use self',
        `Method \`${name}\` does not use \`self\` — it could be a \`@staticmethod\` or a module-level function.`,
        sourceCode,
        'Add the `@staticmethod` decorator if the method does not need access to instance data.',
      )
    }

    return null
  },
}
