import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects patterns like:
 *   {k: constant for k in keys}
 *   d = {}; for k in keys: d[k] = constant
 * Should use dict.fromkeys(keys, constant).
 */
export const pythonDictFromkeysForConstantVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/dict-fromkeys-for-constant',
  languages: ['python'],
  nodeTypes: ['dictionary_comprehension'],
  visit(node, filePath, sourceCode) {
    // Pattern: {k: CONST for k in iterable}
    // The value part should be a literal or simple constant
    const body = node.namedChildren[0] // key: value pair
    if (!body) return null

    // In tree-sitter Python, dictionary comprehension looks like: {key: value for_clause}
    // Check if value is a constant (literal)
    const children = node.namedChildren
    if (children.length < 2) return null

    // Find the for_clause
    const forClause = children.find((c) => c.type === 'for_in_clause')
    if (!forClause) return null

    // The value is the second named child before the for clause
    // Heuristic: check if the value is a constant
    const bodyText = node.text
    // Pattern: {var: CONST for var in ...} where CONST is None, True, False, number, or string
    const match = bodyText.match(/^\{(\w+):\s*(None|True|False|\d+|"[^"]*"|'[^']*')\s+for/)
    if (!match) return null

    const keyVar = match[1]
    const constVal = match[2]

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Use dict.fromkeys() for constant values',
      `\`{${keyVar}: ${constVal} for ${keyVar} in ...}\` — use \`dict.fromkeys(iterable, ${constVal})\` for clarity and efficiency.`,
      sourceCode,
      `Replace with \`dict.fromkeys(iterable, ${constVal})\`.`,
    )
  },
}
