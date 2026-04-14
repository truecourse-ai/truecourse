import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const missingRadixVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/missing-radix',
  languages: JS_LANGUAGES,
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    // parseInt or Number.parseInt
    let isParseInt = false
    if (fn.type === 'identifier' && fn.text === 'parseInt') {
      isParseInt = true
    } else if (fn.type === 'member_expression') {
      const prop = fn.childForFieldName('property')
      const obj = fn.childForFieldName('object')
      if (prop?.text === 'parseInt' && obj?.text === 'Number') {
        isParseInt = true
      }
    }
    if (!isParseInt) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const argNodes = args.namedChildren
    // parseInt without radix has only 1 argument
    if (argNodes.length < 2) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Missing radix argument',
        `\`parseInt()\` called without a radix — always specify the radix (e.g., 10 for decimal) to avoid unpredictable behavior.`,
        sourceCode,
        'Add the radix argument: `parseInt(str, 10)` for base-10 parsing.',
      )
    }
    return null
  },
}
