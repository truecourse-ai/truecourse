import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonDuplicateDictKeyVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/duplicate-dict-key',
  languages: ['python'],
  nodeTypes: ['dictionary_comprehension'],
  visit(node, filePath, sourceCode) {
    // Tree-sitter Python parses `{key: val for ...}` as:
    //   dictionary_comprehension -> pair(key, value), for_in_clause, ...
    const pairNode = node.namedChildren.find((c) => c.type === 'pair')
    if (!pairNode) return null

    const keyNode = pairNode.childForFieldName('key')
    if (!keyNode) return null

    // Find the for_in_clause to get the loop variable
    const forInClause = node.namedChildren.find((c) => c.type === 'for_in_clause')
    const loopVar = forInClause?.childForFieldName('left')?.text ?? ''

    // A constant key is a literal or an identifier that is NOT the loop variable
    const LITERAL_TYPES = new Set(['string', 'integer', 'float', 'true', 'false', 'none'])
    const isConstantKey = LITERAL_TYPES.has(keyNode.type) ||
      (keyNode.type === 'identifier' && loopVar && keyNode.text !== loopVar)

    if (isConstantKey) {
      return makeViolation(
        this.ruleKey, keyNode, filePath, 'high',
        'Constant key in dict comprehension',
        `Dict comprehension with constant key \`${keyNode.text}\` — each iteration overwrites the same key, leaving only the last value.`,
        sourceCode,
        'Use a key expression that depends on the loop variable, or use a list comprehension instead.',
      )
    }
    return null
  },
}
