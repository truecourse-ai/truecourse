import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonStaticKeyDictComprehensionVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/static-key-dict-comprehension',
  languages: ['python'],
  nodeTypes: ['dictionary_comprehension'],
  visit(node, filePath, sourceCode) {
    // Tree-sitter Python parses `{key: val for ...}` as:
    //   dictionary_comprehension -> pair -> key / value, + for_in_clause
    const pairNode = node.namedChildren.find((c) => c.type === 'pair')
    if (!pairNode) return null

    const keyNode = pairNode.childForFieldName('key')
    if (!keyNode) return null

    // A static key is a literal (string, integer, float, true, false, none)
    const LITERAL_TYPES = new Set(['string', 'integer', 'float', 'true', 'false', 'none'])
    if (LITERAL_TYPES.has(keyNode.type)) {
      return makeViolation(
        this.ruleKey, keyNode, filePath, 'high',
        'Static key in dict comprehension',
        `Dict comprehension with constant key \`${keyNode.text}\` — every iteration overwrites the same key, leaving only the last value.`,
        sourceCode,
        'Use a variable as the key, or use a list comprehension if you only need the values.',
      )
    }
    return null
  },
}
