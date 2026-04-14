import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { importsPandas } from '../../../_shared/python-framework-detection.js'

export const pythonPandasReadCsvDtypeVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/pandas-read-csv-dtype',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    // Gate on file actually using pandas. Pre-fix this only recognized
    // `pd.read_csv` / `pandas.read_csv` — `import pandas as pandas_lib`
    // or sub-module imports (`from pandas import read_csv`) were missed.
    // Once we know pandas is imported, any `read_csv` attribute call is
    // fair game to check for a `dtype` kwarg.
    if (!importsPandas(node)) return null

    const fn = node.childForFieldName('function')
    if (!fn) return null

    let isCsvRead = false
    if (fn.type === 'attribute') {
      const attr = fn.childForFieldName('attribute')
      if (attr?.text === 'read_csv') {
        isCsvRead = true
      }
    } else if (fn.type === 'identifier' && fn.text === 'read_csv') {
      // `from pandas import read_csv` → `read_csv(...)`
      isCsvRead = true
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
