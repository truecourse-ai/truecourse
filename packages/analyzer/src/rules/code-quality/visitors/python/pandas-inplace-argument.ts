import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { importsPandas } from '../../../_shared/python-framework-detection.js'

export const pythonPandasInplaceArgumentVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/pandas-inplace-argument',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    // Gate on file actually using pandas. Other libraries also accept
    // `inplace=True` as a kwarg — we shouldn't flag them.
    if (!importsPandas(node)) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    for (const child of args.namedChildren) {
      if (child.type === 'keyword_argument') {
        const key = child.childForFieldName('name')
        const value = child.childForFieldName('value')
        if (key?.text === 'inplace' && value?.text === 'True') {
          return makeViolation(
            this.ruleKey, child, filePath, 'medium',
            'Pandas inplace=True usage',
            '`inplace=True` mutates the DataFrame in-place, making code harder to read and breaking method chaining. The `inplace` parameter is being deprecated.',
            sourceCode,
            'Assign the result instead: `df = df.operation(...)` without `inplace=True`.',
          )
        }
      }
    }

    return null
  },
}
