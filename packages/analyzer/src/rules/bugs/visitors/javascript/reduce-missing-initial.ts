import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const reduceMissingInitialVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/reduce-missing-initial',
  languages: JS_LANGUAGES,
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'member_expression') return null

    const prop = fn.childForFieldName('property')
    if (!prop || (prop.text !== 'reduce' && prop.text !== 'reduceRight')) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const argNodes = args.namedChildren
    // reduce(fn) — only one argument, no initial value
    if (argNodes.length === 1) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Array.reduce missing initial value',
        `\`${prop.text}()\` called without an initial value — throws TypeError on empty arrays.`,
        sourceCode,
        `Add an initial value as the second argument: \`.${prop.text}(fn, initialValue)\`.`,
      )
    }
    return null
  },
}
