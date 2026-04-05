import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const preferObjectSpreadVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/prefer-object-spread',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'member_expression') return null

    const obj = fn.childForFieldName('object')
    const prop = fn.childForFieldName('property')
    if (obj?.text !== 'Object' || prop?.text !== 'assign') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const argList = args.namedChildren
    if (argList.length < 1) return null

    const firstArg = argList[0]
    if (firstArg.type !== 'object' || firstArg.namedChildCount !== 0) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Prefer object spread',
      '`Object.assign({}, ...)` can be replaced with `{ ...obj }` object spread syntax.',
      sourceCode,
      'Replace `Object.assign({}, obj)` with `{ ...obj }`.',
    )
  },
}
