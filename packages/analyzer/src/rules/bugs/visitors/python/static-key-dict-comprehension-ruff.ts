import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects dictionary comprehensions with a static (constant) key — every iteration
 * overwrites the same key, leaving only the last value.
 * RUF011: RuffStaticKeyDictComprehension (distinct rule key from static-key-dict-comprehension)
 */
const LITERAL_TYPES = new Set(['string', 'integer', 'float', 'true', 'false', 'none'])

export const pythonStaticKeyDictComprehensionRuffVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/static-key-dict-comprehension-ruff',
  languages: ['python'],
  nodeTypes: ['dictionary_comprehension'],
  visit(node, filePath, sourceCode) {
    const pairNode = node.namedChildren.find((c) => c.type === 'pair')
    if (!pairNode) return null

    const keyNode = pairNode.childForFieldName('key')
    if (!keyNode) return null

    if (LITERAL_TYPES.has(keyNode.type)) {
      return makeViolation(
        this.ruleKey, keyNode, filePath, 'high',
        'Static key in dict comprehension',
        `Dict comprehension with constant key \`${keyNode.text}\` — every iteration overwrites the same key, resulting in a single-entry dict with only the last value.`,
        sourceCode,
        'Use a variable expression as the key. If you only need values, use a list comprehension instead.',
      )
    }
    return null
  },
}
