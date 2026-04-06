import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Detects: series.nunique() called on a series that was assigned a constant value
// e.g., pd.Series([1, 1, 1]).nunique() always returns 1
// We detect the simple literal-slice pattern: pd.Series([x, x, x]).nunique()
// Also detects nunique() on literals or simple patterns we can reason about statically
export const pythonPandasNuniqueConstantSeriesVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/pandas-nunique-constant-series',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    // Match: <expr>.nunique()
    const func = node.childForFieldName('function')
    if (!func || func.type !== 'attribute') return null

    const attr = func.childForFieldName('attribute')
    if (!attr || attr.text !== 'nunique') return null

    // Check args: no arguments (standard nunique() call)
    const args = node.childForFieldName('arguments')
    if (!args) return null

    // Check if the object is pd.Series([...]) with all identical elements
    const obj = func.childForFieldName('object')
    if (!obj) return null

    // Pattern: pd.Series([val, val, val]) or Series([val, val, val])
    if (obj.type !== 'call') return null

    const seriesFunc = obj.childForFieldName('function')
    if (!seriesFunc) return null

    const funcName = seriesFunc.type === 'attribute'
      ? seriesFunc.childForFieldName('attribute')?.text
      : seriesFunc.text

    if (funcName !== 'Series') return null

    const seriesArgs = obj.childForFieldName('arguments')
    if (!seriesArgs) return null

    const firstArg = seriesArgs.namedChildren[0]
    if (!firstArg || firstArg.type !== 'list') return null

    const elements = firstArg.namedChildren
    if (elements.length < 2) return null

    // Check if all elements are the same literal
    const allSame = elements.every((el) => el.text === elements[0].text)
    if (!allSame) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'pandas.nunique() on constant series',
      `\`nunique()\` called on a series with all identical values (${elements[0].text}) — always returns 1, likely a logic error.`,
      sourceCode,
      'Verify the series data or use a different approach to check uniqueness.',
    )
  },
}
