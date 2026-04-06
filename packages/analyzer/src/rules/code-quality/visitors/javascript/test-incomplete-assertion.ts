import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * sonarjs/S2970 (no-incomplete-assertions)
 * Detects incomplete Chai/Jest/Jasmine assertions that don't actually assert anything:
 * - expect(x).to.be (missing final assertion call)
 * - expect(x).toBe (missing invocation)
 * - expect(x).not.toBeNull (missing invocation)
 */

// Chai property assertions that are used standalone without calling a method
const CHAI_PROPERTY_ASSERTIONS = new Set([
  'ok', 'true', 'false', 'null', 'undefined', 'exist', 'empty',
  'arguments', 'NaN', 'finite', 'sealed', 'frozen', 'extensible',
])

export const testIncompleteAssertionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/test-incomplete-assertion',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['member_expression'],
  visit(node, filePath, sourceCode) {
    // Only flag when this member_expression is used as a statement (not called)
    const parent = node.parent
    if (!parent) return null

    // If parent is a call_expression, this is being invoked — fine
    if (parent.type === 'call_expression') return null
    // If parent is another member_expression, we'll catch it at the statement level
    if (parent.type === 'member_expression') return null
    // It should be a statement or expression_statement
    if (parent.type !== 'expression_statement' && parent.type !== 'await_expression') return null

    // Walk up the chain to see if this starts from expect(...)
    function startsFromExpect(n: typeof node): boolean {
      if (n.type === 'call_expression') {
        const fn = n.childForFieldName('function')
        if (fn?.type === 'identifier' && fn.text === 'expect') return true
        if (fn?.type === 'member_expression') return startsFromExpect(fn)
      }
      if (n.type === 'member_expression') {
        const obj = n.childForFieldName('object')
        if (obj) return startsFromExpect(obj)
      }
      return false
    }

    const prop = node.childForFieldName('property')
    if (!prop) return null

    // Check if this is a Chai property assertion used as a statement
    if (CHAI_PROPERTY_ASSERTIONS.has(prop.text)) {
      const obj = node.childForFieldName('object')
      if (obj && startsFromExpect(obj)) {
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Incomplete assertion',
          `\`.${prop.text}\` is a Chai property assertion used as a statement without calling a method — this assertion does nothing.`,
          sourceCode,
          `Complete the assertion by using the proper method form, e.g. \`.to.be.${prop.text}\` chained correctly.`,
        )
      }
    }

    // Check for expect(x).toBe without () — unlikely in TS but possible in JS
    const jestMatchers = new Set([
      'toBe', 'toEqual', 'toBeNull', 'toBeUndefined', 'toBeTruthy',
      'toBeFalsy', 'toBeGreaterThan', 'toBeLessThan', 'toContain',
      'toHaveLength', 'toHaveBeenCalled', 'toThrow', 'toBeNaN',
      'toBeInstanceOf', 'toHaveProperty', 'toMatch',
    ])

    if (jestMatchers.has(prop.text)) {
      const obj = node.childForFieldName('object')
      if (obj && startsFromExpect(obj)) {
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Incomplete assertion',
          `\`.${prop.text}\` is referenced but not called — the assertion never runs.`,
          sourceCode,
          `Call the matcher: \`.${prop.text}(expectedValue)\`.`,
        )
      }
    }

    return null
  },
}
