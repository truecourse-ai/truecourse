import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { SyntaxNode } from 'tree-sitter'

function hasAwaitOrAsyncFor(node: SyntaxNode): boolean {
  if (node.type === 'await') return true
  if (node.type === 'for_statement' && node.children.some((c) => c.type === 'async')) return true
  if (node.type === 'with_statement' && node.children.some((c) => c.type === 'async')) return true
  // Don't descend into nested functions
  if (node.type === 'function_definition') return false
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (child && hasAwaitOrAsyncFor(child)) return true
  }
  return false
}

export const pythonAsyncUnusedAsyncVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/async-unused-async',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    const isAsync = node.children.some((c) => c.type === 'async')
    if (!isAsync) return null

    const bodyNode = node.childForFieldName('body')
    if (!bodyNode) return null

    if (hasAwaitOrAsyncFor(bodyNode)) return null

    const nameNode = node.childForFieldName('name')
    const name = nameNode?.text || 'function'

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Async function without await',
      `Async function \`${name}\` never uses \`await\`, \`async for\`, or \`async with\` — the \`async\` keyword is unnecessary.`,
      sourceCode,
      'Remove the `async` keyword if the function does not need to be awaitable.',
    )
  },
}
