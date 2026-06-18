import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName } from '../../../_shared/csharp-helpers.js'

/**
 * `s.IndexOf(x) > 0` / `list.IndexOf(x) >= 1` — IndexOf returns -1 when not
 * found, so a "found" check written this way silently misses index 0.
 * The correct idioms `>= 0`, `< 0`, `== -1`, `!= -1` do not fire.
 */
function isIndexOfCall(n: SyntaxNode): boolean {
  if (n.type !== 'invocation_expression') return false
  const name = getCSharpMethodName(n)
  return name === 'IndexOf' || name === 'LastIndexOf'
}

function asNonNegativeInt(n: SyntaxNode): number | null {
  if (n.type !== 'integer_literal') return null
  const val = Number(n.text)
  return Number.isInteger(val) && val >= 0 ? val : null
}

export const csharpIndexOfPositiveCheckVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/index-of-positive-check',
  languages: ['csharp'],
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    const op = node.childForFieldName('operator')?.text
    if (!left || !right || !op) return null

    let fires = false
    let compared = ''
    if (isIndexOfCall(left)) {
      const val = asNonNegativeInt(right)
      fires = val !== null && ((op === '>' && val === 0) || (op === '>=' && val >= 1))
      compared = right.text
    } else if (isIndexOfCall(right)) {
      const val = asNonNegativeInt(left)
      fires = val !== null && ((op === '<' && val === 0) || (op === '<=' && val >= 1))
      compared = left.text
    }
    if (!fires) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'IndexOf compared to positive number',
      `\`IndexOf()\` returns -1 when not found. Comparing to \`${compared}\` misses the case where the element is at index 0. Use \`>= 0\` to check if found.`,
      sourceCode,
      'Compare to -1 or 0: use `IndexOf(x) >= 0` (found) or `IndexOf(x) < 0` (not found).',
    )
  },
}
