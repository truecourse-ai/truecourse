import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Collect all identifier names from a loop variable node, handling
 * tuple/pattern unpacking like `k, v` or `(a, b, c)`.
 */
function collectLoopVarNames(node: SyntaxNode): Set<string> {
  const names = new Set<string>()
  function walk(n: SyntaxNode) {
    if (n.type === 'identifier') {
      names.add(n.text)
    } else {
      for (const child of n.namedChildren) {
        walk(child)
      }
    }
  }
  walk(node)
  return names
}

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

    // Find the for_in_clause to get all loop variable identifiers
    const forInClause = node.namedChildren.find((c) => c.type === 'for_in_clause')
    const leftNode = forInClause?.childForFieldName('left')
    const loopVarNames = leftNode ? collectLoopVarNames(leftNode) : new Set<string>()

    // A constant key is a literal or an identifier that is NOT any loop variable
    const LITERAL_TYPES = new Set(['string', 'integer', 'float', 'true', 'false', 'none'])
    const isConstantKey = LITERAL_TYPES.has(keyNode.type) ||
      (keyNode.type === 'identifier' && loopVarNames.size > 0 && !loopVarNames.has(keyNode.text))

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
