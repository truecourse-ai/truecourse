import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonNestedMinMaxVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/nested-min-max',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'identifier') return null
    if (fn.text !== 'min' && fn.text !== 'max') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    for (const arg of args.namedChildren) {
      if (arg.type === 'call') {
        const innerFn = arg.childForFieldName('function')
        if (innerFn?.type === 'identifier' && innerFn.text === fn.text) {
          return makeViolation(
            this.ruleKey, node, filePath, 'low',
            `Nested ${fn.text}() calls`,
            `\`${fn.text}(${fn.text}(a, b), c)\` is equivalent to \`${fn.text}(a, b, c)\`. Nested calls add unnecessary complexity.`,
            sourceCode,
            `Flatten the nested \`${fn.text}()\` calls into a single call with all arguments.`,
          )
        }
      }
    }

    return null
  },
}
