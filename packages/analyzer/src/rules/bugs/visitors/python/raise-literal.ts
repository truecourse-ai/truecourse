import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonRaiseLiteralVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/raise-literal',
  languages: ['python'],
  nodeTypes: ['raise_statement'],
  visit(node, filePath, sourceCode) {
    const raised = node.namedChildren[0]
    if (!raised) return null

    const LITERAL_TYPES = new Set(['string', 'integer', 'float', 'true', 'false', 'none', 'concatenated_string'])
    if (LITERAL_TYPES.has(raised.type)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Raising a literal value',
        `\`raise ${raised.text}\` raises a TypeError in Python 3 — you must raise an exception instance or class, not a literal.`,
        sourceCode,
        `Replace with \`raise Exception(${raised.text})\` or a more specific exception.`,
      )
    }

    return null
  },
}
