import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonIsinstanceTypeNoneVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/isinstance-type-none',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    // isinstance(x, type(None))
    if (fn.type === 'identifier' && fn.text === 'isinstance') {
      const args = node.childForFieldName('arguments')
      if (!args) return null

      const argList = args.namedChildren
      if (argList.length < 2) return null

      const typeArg = argList[1]
      if (!typeArg || typeArg.type !== 'call') return null

      const typeArgFn = typeArg.childForFieldName('function')
      if (!typeArgFn || typeArgFn.text !== 'type') return null

      const typeArgArgs = typeArg.childForFieldName('arguments')
      if (!typeArgArgs) return null

      const typeArgParam = typeArgArgs.namedChildren[0]
      if (!typeArgParam || typeArgParam.text !== 'None') return null

      const varName = argList[0]?.text ?? 'x'
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'isinstance with type(None)',
        `\`isinstance(${varName}, type(None))\` should be \`${varName} is None\`.`,
        sourceCode,
        `Replace with \`${varName} is None\`.`,
      )
    }

    // type(x) is type(None)
    if (fn.type === 'identifier' && fn.text === 'type') {
      const parent = node.parent
      if (!parent || parent.type !== 'comparison_operator') return null

      // Check if this is type(x) is type(None)
      const children = parent.children
      let isOperator = false
      for (const c of children) {
        if (c.type === 'is') { isOperator = true; break }
      }
      if (!isOperator) return null

      const rightSide = children[children.length - 1]
      if (!rightSide || rightSide.type !== 'call') return null

      const rightFn = rightSide.childForFieldName('function')
      if (!rightFn || rightFn.text !== 'type') return null

      const rightArgs = rightSide.childForFieldName('arguments')
      if (!rightArgs) return null

      const rightParam = rightArgs.namedChildren[0]
      if (!rightParam || rightParam.text !== 'None') return null

      return makeViolation(
        this.ruleKey, parent, filePath, 'low',
        'type(x) is type(None)',
        '`type(x) is type(None)` should be `x is None`.',
        sourceCode,
        'Replace with `x is None`.',
      )
    }

    return null
  },
}
