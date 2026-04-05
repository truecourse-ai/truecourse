import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonPandasUseOfDotValuesVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/pandas-use-of-dot-values',
  languages: ['python'],
  nodeTypes: ['attribute'],
  visit(node, filePath, sourceCode) {
    const attr = node.childForFieldName('attribute')
    if (attr?.text !== 'values') return null

    // Avoid false positives: only flag when inside a statement (not as part of assignment target)
    // We heuristically check if parent is not an assignment target
    const parent = node.parent
    if (parent?.type === 'assignment') {
      const left = parent.childForFieldName('left')
      if (left === node) return null
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Pandas .values instead of .to_numpy()',
      '`.values` returns a NumPy array or ExtensionArray depending on the dtype. Use `.to_numpy()` for a consistent NumPy array return type.',
      sourceCode,
      'Replace `.values` with `.to_numpy()` for consistent behavior.',
    )
  },
}
