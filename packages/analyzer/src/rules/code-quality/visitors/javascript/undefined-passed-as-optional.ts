import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const undefinedPassedAsOptionalVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/undefined-passed-as-optional',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const args = node.childForFieldName('arguments')
    if (!args) return null

    const argList = args.namedChildren
    if (argList.length === 0) return null

    const lastArg = argList[argList.length - 1]
    if (lastArg.text !== 'undefined') return null

    // Skip React hooks where undefined is the standard initial value
    // Handles both `useState(undefined)` and `React.useState(undefined)`
    const fn = node.childForFieldName('function')
    let fnName = fn?.text ?? ''
    if (fn && fn.type === 'member_expression') {
      const prop = fn.childForFieldName('property')
      if (prop) fnName = prop.text
    }
    if (/^use[A-Z]/.test(fnName)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Explicit undefined as optional argument',
      'Passing `undefined` explicitly as a trailing argument is redundant — just omit it.',
      sourceCode,
      'Remove the explicit `undefined` argument — optional parameters default to `undefined` automatically.',
    )
  },
}
