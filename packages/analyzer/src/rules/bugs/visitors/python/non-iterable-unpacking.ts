import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Detect: a, b = 5 or a, b = True — unpacking non-iterable literal

const NON_ITERABLE_TYPES = new Set(['integer', 'float', 'none', 'true', 'false'])

export const pythonNonIterableUnpackingVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/non-iterable-unpacking',
  languages: ['python'],
  nodeTypes: ['assignment'],
  visit(node, filePath, sourceCode) {
    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    if (!left || !right) return null

    // Left must be a tuple pattern (unpacking): a, b = ...
    if (left.type !== 'pattern_list' && left.type !== 'tuple_pattern') return null

    // Right must be a non-iterable literal
    if (!NON_ITERABLE_TYPES.has(right.type)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Unpacking non-iterable',
      `Cannot unpack \`${right.text}\` (${right.type}) — it is not iterable. This will raise \`TypeError\` at runtime.`,
      sourceCode,
      'Assign a list, tuple, or other iterable value instead.',
    )
  },
}
