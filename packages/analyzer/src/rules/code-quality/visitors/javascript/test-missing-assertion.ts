import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

type SyntaxNode = import('tree-sitter').SyntaxNode

const ASSERTION_PATTERNS = new Set([
  'expect', 'assert', 'should', 'chai', // Common assertion libraries
])

function hasAssertion(node: SyntaxNode): boolean {
  if (node.type === 'call_expression') {
    const fn = node.childForFieldName('function')
    if (fn) {
      // Direct call: expect(...), assert(...)
      if (fn.type === 'identifier' && ASSERTION_PATTERNS.has(fn.text)) return true
      // Member: assert.equal, assert.strictEqual, expect(...).toBe, etc.
      if (fn.type === 'member_expression') {
        const obj = fn.childForFieldName('object')
        if (obj?.type === 'identifier' && ASSERTION_PATTERNS.has(obj.text)) return true
        // Chained: expect(x).toBe(y)
        if (obj?.type === 'call_expression') {
          const innerFn = obj.childForFieldName('function')
          if (innerFn?.type === 'identifier' && ASSERTION_PATTERNS.has(innerFn.text)) return true
        }
      }
    }
  }

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (child && hasAssertion(child)) return true
  }

  return false
}

function isTestCallback(node: SyntaxNode): boolean {
  // it('name', () => { ... }) or it('name', function() { ... })
  const parent = node.parent
  if (!parent || parent.type !== 'call_expression') return false

  const fn = parent.childForFieldName('function')
  if (!fn) return false

  let fnName = ''
  if (fn.type === 'identifier') fnName = fn.text
  else if (fn.type === 'member_expression') {
    fnName = fn.childForFieldName('property')?.text ?? ''
  }

  return fnName === 'it' || fnName === 'test'
}

export const testMissingAssertionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/test-missing-assertion',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['arrow_function', 'function'],
  visit(node, filePath, sourceCode) {
    if (!isTestCallback(node)) return null

    const body = node.childForFieldName('body')
    if (!body) return null

    if (hasAssertion(body)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Test without assertion',
      'Test case does not contain any assertions — it will always pass.',
      sourceCode,
      'Add at least one assertion (`expect(...)`, `assert(...)`) to verify behavior.',
    )
  },
}
