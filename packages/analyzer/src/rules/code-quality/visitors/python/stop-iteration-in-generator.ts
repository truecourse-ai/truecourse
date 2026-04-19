import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'

function isInsideGenerator(node: SyntaxNode): boolean {
  let cur: SyntaxNode | null = node.parent
  while (cur) {
    if (cur.type === 'function_definition') {
      // Check if it has yield
      return hasYield(cur)
    }
    cur = cur.parent
  }
  return false
}

function hasYield(node: SyntaxNode): boolean {
  if (node.type === 'yield') return true
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (child && child.type !== 'function_definition' && hasYield(child)) return true
  }
  return false
}

export const pythonStopIterationInGeneratorVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/stop-iteration-in-generator',
  languages: ['python'],
  nodeTypes: ['raise_statement'],
  visit(node, filePath, sourceCode) {
    const callNode = node.namedChildren.find((c) => c.type === 'call')
    if (!callNode) return null
    const fn = callNode.childForFieldName('function')
    if (!fn) return null
    if (fn.type !== 'identifier' || fn.text !== 'StopIteration') return null

    if (!isInsideGenerator(node)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'StopIteration raised in generator',
      'Raising `StopIteration` inside a generator is converted to `RuntimeError` in Python 3.7+ (PEP 479). Use `return` instead.',
      sourceCode,
      'Replace `raise StopIteration` with a bare `return` statement.',
    )
  },
}
