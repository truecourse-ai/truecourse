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
