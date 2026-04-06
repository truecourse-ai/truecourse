import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects pd.merge() or DataFrame.merge() without explicit `on` and `how` parameters.
 */
export const pythonPandasMergeParametersVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/pandas-merge-parameters',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let isMerge = false
    if (fn.type === 'attribute') {
      const attr = fn.childForFieldName('attribute')
      if (attr?.text === 'merge') {
        isMerge = true
      }
    } else if (fn.type === 'identifier' && fn.text === 'merge') {
      // Could be pd.merge directly imported
      isMerge = true
    }

    if (!isMerge) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    // Check for keyword arguments
    const kwargs = args.namedChildren
      .filter((c) => c.type === 'keyword_argument')
      .map((c) => c.childForFieldName('name')?.text)

    const hasOn = kwargs.includes('on') || kwargs.includes('left_on')
    const hasHow = kwargs.includes('how')

    if (hasOn && hasHow) return null

    const missing = []
    if (!hasOn) missing.push('`on`')
    if (!hasHow) missing.push('`how`')

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Pandas merge without explicit parameters',
      `\`merge()\` called without ${missing.join(' and ')} — ambiguous merge behavior. Specify join keys and method explicitly.`,
      sourceCode,
      `Add explicit ${missing.join(' and ')} parameters to the merge() call.`,
    )
  },
}
