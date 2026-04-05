import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonPandasReadCsvDtypeVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/pandas-read-csv-dtype',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let isCsvRead = false
    if (fn.type === 'attribute') {
      const obj = fn.childForFieldName('object')
      const attr = fn.childForFieldName('attribute')
      if ((obj?.text === 'pd' || obj?.text === 'pandas') && attr?.text === 'read_csv') {
        isCsvRead = true
      }
    }

    if (!isCsvRead) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const hasDtype = args.namedChildren.some((child) => {
      if (child.type === 'keyword_argument') {
        const key = child.childForFieldName('name')
        return key?.text === 'dtype'
      }
      return false
    })

    if (!hasDtype) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'pandas.read_csv without dtype',
        '`pd.read_csv()` without a `dtype` parameter allows pandas to infer column types, which may be incorrect (e.g., reading IDs as integers, phone numbers losing leading zeros).',
        sourceCode,
        'Specify `dtype` for columns that need specific types: `pd.read_csv(file, dtype={"col": str})`.',
      )
    }

    return null
  },
}
