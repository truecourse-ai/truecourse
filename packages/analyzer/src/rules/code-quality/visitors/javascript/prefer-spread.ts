import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const preferSpreadVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/prefer-spread',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'member_expression') return null

    const prop = fn.childForFieldName('property')
    if (prop?.text !== 'apply') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const argList = args.namedChildren
    if (argList.length === 2) {
      const contextArg = argList[0]
      if (contextArg.text === 'null' || contextArg.text === 'undefined' || contextArg.text === 'this') {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Prefer spread over apply',
          '`fn.apply(ctx, args)` can be replaced with `fn(...args)` using the spread operator.',
          sourceCode,
          'Replace `.apply(ctx, args)` with `fn(...args)` or `fn.call(ctx, ...args)`.',
        )
      }
    }
    return null
  },
}
