import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const indexOfPositiveCheckVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/index-of-positive-check',
  languages: JS_LANGUAGES,
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    const operator = node.children.find((c) => ['>', '>=', '<', '<=', '===', '==', '!==', '!='].includes(c.text))

    if (!left || !right || !operator) return null

    function isIndexOfCall(n: SyntaxNode): boolean {
      if (n.type !== 'call_expression') return false
      const fn = n.childForFieldName('function')
      if (!fn || fn.type !== 'member_expression') return false
      const prop = fn.childForFieldName('property')
      return prop?.text === 'indexOf' || prop?.text === 'lastIndexOf'
    }

    // Flag only patterns that genuinely miss index 0:
    //   indexOf(x) > 0      — excludes position 0 (BUG)
    //   indexOf(x) > N>0    — excludes positions 0..N (BUG)
    //   0 < indexOf(x)      — same as above, reversed
    // Correct patterns we must NOT flag:
    //   indexOf(x) >= 0     — canonical "found" check (matches at 0 inclusive)
    //   indexOf(x) === 0    — find-at-first-position check
    //   indexOf(x) !== -1   — canonical "found"
    //   indexOf(x) === -1   — canonical "not found"
    function isPositiveInteger(n: SyntaxNode): boolean {
      if (n.type !== 'number') return false
      const val = Number(n.text)
      return Number.isInteger(val) && val > 0
    }
    function isZero(n: SyntaxNode): boolean {
      return n.type === 'number' && Number(n.text) === 0
    }

    const op = operator.text

    // indexOf() OP <constant>
    if (isIndexOfCall(left)) {
      // > 0, > N (N>0), >= N (N>0): all miss positions 0..N
      if ((op === '>' && (isZero(right) || isPositiveInteger(right))) ||
          (op === '>=' && isPositiveInteger(right))) {
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'indexOf compared to positive number',
          `\`indexOf()\` returns -1 when not found. Comparing to \`${right.text}\` with \`${op}\` misses the case where the element is at index 0. Use \`!== -1\` to check if found.`,
          sourceCode,
          'Compare to -1: use `indexOf(x) !== -1` (found) or `indexOf(x) === -1` (not found).',
        )
      }
    }

    // <constant> OP indexOf()  (mirror)
    if (isIndexOfCall(right)) {
      // 0 < indexOf(), N < indexOf() (N>=0), N <= indexOf() (N>0): mirrors of above
      if ((op === '<' && (isZero(left) || isPositiveInteger(left))) ||
          (op === '<=' && isPositiveInteger(left))) {
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'indexOf compared to positive number',
          `\`indexOf()\` returns -1 when not found. Comparing to \`${left.text}\` with \`${op}\` misses the case where the element is at index 0. Use \`!== -1\` to check if found.`,
          sourceCode,
          'Compare to -1: use `indexOf(x) !== -1` (found) or `indexOf(x) === -1` (not found).',
        )
      }
    }

    return null
  },
}
