import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

type SyntaxNode = import('web-tree-sitter').Node

function containsAssert(node: SyntaxNode): SyntaxNode | null {
  if (node.type === 'assert_statement') return node
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (child) {
      const result = containsAssert(child)
      if (result) return result
    }
  }
  return null
}

export const pythonPytestAssertInExceptVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/pytest-assert-in-except',
  languages: ['python'],
  nodeTypes: ['except_clause'],
  visit(node, filePath, sourceCode) {
    const assertNode = containsAssert(node)
    if (!assertNode) return null

    return makeViolation(
      this.ruleKey, assertNode, filePath, 'medium',
      'Assert in except block',
      'Using `assert` inside an `except` block is problematic — if the assertion fails, the original exception context is lost in the AssertionError traceback.',
      sourceCode,
      'Use a dedicated pytest assertion helper or re-raise the original exception before asserting.',
    )
  },
}
