import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects type aliases or inline types with very deep nesting (count depth of
 * nested <> and []).  When the nesting depth exceeds a threshold (4), flag it
 * as overly complex.
 */

function maxBracketDepth(text: string): number {
  let depth = 0
  let max = 0
  for (const ch of text) {
    if (ch === '<' || ch === '[') {
      depth++
      if (depth > max) max = depth
    } else if (ch === '>' || ch === ']') {
      depth = Math.max(0, depth - 1)
    }
  }
  return max
}

function countUnionIntersectionMembers(text: string): number {
  // Count top-level | and & operators (rough heuristic)
  let depth = 0
  let count = 1
  for (const ch of text) {
    if (ch === '<' || ch === '[' || ch === '(' || ch === '{') depth++
    else if (ch === '>' || ch === ']' || ch === ')' || ch === '}') depth--
    else if (depth === 0 && (ch === '|' || ch === '&')) count++
  }
  return count
}

const DEPTH_THRESHOLD = 4
const MEMBER_THRESHOLD = 6

export const complexTypeAliasVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/complex-type-alias',
  languages: ['typescript'],
  nodeTypes: ['type_alias_declaration'],
  visit(node, filePath, sourceCode) {
    const typeValue = node.childForFieldName('value')
    if (!typeValue) return null

    const typeText = typeValue.text
    const depth = maxBracketDepth(typeText)
    const members = countUnionIntersectionMembers(typeText)

    if (depth >= DEPTH_THRESHOLD || members >= MEMBER_THRESHOLD) {
      const reason = depth >= DEPTH_THRESHOLD
        ? `nesting depth of ${depth} (threshold: ${DEPTH_THRESHOLD})`
        : `${members} union/intersection members (threshold: ${MEMBER_THRESHOLD})`
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Complex type alias',
        `Type alias has ${reason}. Break it into smaller named types for readability.`,
        sourceCode,
        'Extract intermediate type aliases to reduce complexity.',
      )
    }

    return null
  },
}
