import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

type SyntaxNode = import('web-tree-sitter').Node

const TEST_FUNCTION_NAMES = new Set(['it', 'test', 'describe'])

function hasTestFunction(node: SyntaxNode): boolean {
  if (node.type === 'call_expression') {
    const fn = node.childForFieldName('function')
    if (fn?.type === 'identifier' && TEST_FUNCTION_NAMES.has(fn.text)) return true
    if (fn?.type === 'member_expression') {
      const obj = fn.childForFieldName('object')
      if (obj?.type === 'identifier' && TEST_FUNCTION_NAMES.has(obj.text)) return true
    }
  }
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (child && hasTestFunction(child)) return true
  }
  return false
}

export const testEmptyFileVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/test-empty-file',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['program'],
  visit(node, filePath, sourceCode) {
    // Only flag test files
    const lowerPath = filePath.toLowerCase()
    const isTestFile = (
      lowerPath.includes('.test.') ||
      lowerPath.includes('.spec.') ||
      lowerPath.includes('__tests__')
    )
    if (!isTestFile) return null

    if (hasTestFunction(node)) return null

    // Only flag non-empty files (to avoid confusion with empty stub files)
    if (sourceCode.trim().length === 0) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Empty test file',
      'Test file contains no test cases (`it`, `test`, or `describe`).',
      sourceCode,
      'Add test cases or remove the file.',
    )
  },
}
