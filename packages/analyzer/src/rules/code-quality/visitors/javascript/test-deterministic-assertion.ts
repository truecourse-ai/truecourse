import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * sonarjs/S6092 (chai-determinate-assertion)
 * Detects Chai assertions that are non-determinate — have more than one way to succeed.
 *
 * Specifically:
 * - expect(x).to.be.oneOf([...]) with a large list — may succeed for many values
 * - expect(x).to.satisfy(fn) — custom predicate, non-deterministic
 * - expect(x).to.be.closeTo(n, delta) — intentionally imprecise
 * - expect(x).to.match(regex) — regex may match many values
 */
export const testDeterministicAssertionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/test-deterministic-assertion',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'member_expression') return null

    const method = fn.childForFieldName('property')
    if (!method) return null

    // expect(x).to.be.oneOf([...]) — passes for any value in the list
    if (method.text === 'oneOf') {
      const args = node.childForFieldName('arguments')
      const argList = args?.namedChildren ?? []
      if (argList.length === 1 && argList[0].type === 'array') {
        const items = argList[0].namedChildren
        if (items.length > 3) {
          return makeViolation(
            this.ruleKey, node, filePath, 'low',
            'Non-deterministic Chai assertion',
            '`oneOf()` with a large list has multiple ways to succeed — prefer a more precise assertion.',
            sourceCode,
            'Use a more specific assertion like `.to.equal()` or `.to.deep.equal()` instead of `.to.be.oneOf([...])` with many options.',
          )
        }
      }
    }

    // expect(x).to.satisfy(fn) — custom predicate is non-deterministic
    if (method.text === 'satisfy') {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Non-deterministic Chai assertion',
        '`.satisfy()` with a custom predicate is non-deterministic — the assertion may succeed for many values.',
        sourceCode,
        'Replace `.satisfy()` with a specific assertion like `.to.equal()` or `.to.be.greaterThan()`.',
      )
    }

    return null
  },
}
