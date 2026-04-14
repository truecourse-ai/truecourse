import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const arraySortWithoutCompareVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/array-sort-without-compare',
  languages: JS_LANGUAGES,
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'member_expression') return null

    const prop = fn.childForFieldName('property')
    if (!prop || (prop.text !== 'sort' && prop.text !== 'toSorted')) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const argNodes = args.namedChildren
    // sort() or sort(undefined) with no compare function
    if (argNodes.length === 0 || (argNodes.length === 1 && argNodes[0].type === 'undefined')) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Array sorted without comparator',
        `\`.${prop.text}()\` without a compare function sorts elements lexicographically (as strings), which may produce unexpected results for numbers.`,
        sourceCode,
        `Add a compare function: \`.${prop.text}((a, b) => a - b)\` for numeric sort.`,
      )
    }
    return null
  },
}
