import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonCollectionLiteralConcatenationVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/collection-literal-concatenation',
  languages: ['python'],
  nodeTypes: ['binary_operator'],
  visit(node, filePath, sourceCode) {
    const op = node.children.find((c) => !c.isNamed && c.text === '+')
    if (!op) return null

    const left = node.namedChildren[0]
    const right = node.namedChildren[1]
    if (!left || !right) return null

    if (left.type === 'list' && right.type === 'list') {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'List literal concatenation',
        '`[...] + [...]` concatenates two list literals. Combine them into a single list literal instead.',
        sourceCode,
        'Replace `[a, b] + [c, d]` with `[a, b, c, d]`.',
      )
    }

    if (left.type === 'tuple' && right.type === 'tuple') {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Tuple literal concatenation',
        '`(...) + (...)` concatenates two tuple literals. Combine them into a single tuple literal instead.',
        sourceCode,
        'Replace `(a, b) + (c, d)` with `(a, b, c, d)`.',
      )
    }

    return null
  },
}
