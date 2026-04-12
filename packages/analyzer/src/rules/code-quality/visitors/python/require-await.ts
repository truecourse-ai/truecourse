import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

type SyntaxNode = import('tree-sitter').SyntaxNode

export const pythonRequireAwaitVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/require-await',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    // Check if function is async (has async keyword before def)
    const isAsync = node.children.some((c) => c.type === 'async')
    if (!isAsync) return null

    // Skip async dunder methods — __aenter__, __aexit__, __aiter__,
    // __anext__ MUST be async for protocol compliance even if their
    // bodies don't await anything.
    const nameNode = node.childForFieldName('name')
    const name = nameNode?.text || ''
    if (name.startsWith('__') && name.endsWith('__')) return null

    const bodyNode = node.childForFieldName('body')
    if (!bodyNode) return null

    let hasAwait = false

    function walk(n: SyntaxNode) {
      if (hasAwait) return
      if (n.type === 'await') {
        hasAwait = true
        return
      }
      // Don't descend into nested functions
      if (n.type === 'function_definition' && n.id !== node.id) return
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) walk(child)
      }
    }

    walk(bodyNode)

    if (!hasAwait) {
      const nameNode = node.childForFieldName('name')
      const name = nameNode?.text || 'anonymous'
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Async without await',
        `Async function \`${name}\` does not use \`await\`. Remove the \`async\` keyword or add an \`await\`.`,
        sourceCode,
        'Remove the `async` keyword if the function does not need to be async.',
      )
    }
    return null
  },
}
