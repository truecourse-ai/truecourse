import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { CSHARP_METHODLIKE_TYPES, getCSharpFunctionName } from './_helpers.js'

const MAX_POSITIONAL = 5

export const csharpTooManyPositionalArgumentsVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/too-many-positional-arguments',
  languages: ['csharp'],
  nodeTypes: CSHARP_METHODLIKE_TYPES,
  visit(node, filePath, sourceCode) {
    const params = node.childForFieldName('parameters')
    if (!params) return null

    // Parameters with defaults are optional but still positional-capable —
    // count everything except `params` arrays (the variadic tail).
    let count = 0
    for (const param of params.namedChildren) {
      if (!param || param.type !== 'parameter') continue
      if (param.children.some((c) => c?.type === 'params')) continue
      count++
    }

    if (count > MAX_POSITIONAL) {
      const name = getCSharpFunctionName(node)
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        `Too many parameters (${count})`,
        `Method \`${name}\` has ${count} parameters — group related values into a record or options class.`,
        sourceCode,
        'Reduce the parameter count by grouping related values into a record or options class.',
      )
    }
    return null
  },
}
