import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { isInsideTryCatch } from './_helpers.js'

export const unsafeJsonParseVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/unsafe-json-parse',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    if (fn.type !== 'member_expression') return null
    const obj = fn.childForFieldName('object')
    const prop = fn.childForFieldName('property')
    if (obj?.text !== 'JSON' || prop?.text !== 'parse') return null

    // `JSON.parse(JSON.stringify(x))` is the structured-clone idiom — the
    // input is guaranteed valid JSON because it was just produced by
    // JSON.stringify, so no try/catch is needed.
    const args = node.childForFieldName('arguments')
    const firstArg = args?.namedChildren[0]
    if (firstArg?.type === 'call_expression') {
      const innerFn = firstArg.childForFieldName('function')
      if (innerFn?.type === 'member_expression') {
        const innerObj = innerFn.childForFieldName('object')
        const innerProp = innerFn.childForFieldName('property')
        if (innerObj?.text === 'JSON' && innerProp?.text === 'stringify') return null
      }
    }

    if (isInsideTryCatch(node)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Unsafe JSON.parse',
      'JSON.parse() can throw on malformed input. Wrap it in a try/catch.',
      sourceCode,
      'Wrap JSON.parse() in a try/catch to handle malformed JSON gracefully.',
    )
  },
}
