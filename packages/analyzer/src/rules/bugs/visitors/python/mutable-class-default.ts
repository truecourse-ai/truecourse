import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonMutableClassDefaultVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/mutable-class-default',
  languages: ['python'],
  nodeTypes: ['class_definition'],
  visit(node, filePath, sourceCode) {
    const body = node.childForFieldName('body')
    if (!body) return null

    for (const child of body.namedChildren) {
      // Class-level assignment: name = [] or name = {} or name = set()
      if (child.type === 'expression_statement') {
        const expr = child.namedChildren[0]
        if (!expr || expr.type !== 'assignment') continue
        const right = expr.childForFieldName('right')
        if (!right) continue

        const isMutable = right.type === 'list' || right.type === 'dictionary' || right.type === 'set'
        if (isMutable) {
          const left = expr.childForFieldName('left')
          const varName = left?.text ?? 'attribute'
          return makeViolation(
            this.ruleKey, expr, filePath, 'high',
            'Mutable class variable default',
            `Class variable \`${varName}\` is a mutable \`${right.type}\` — it is shared across all instances and mutations affect every instance.`,
            sourceCode,
            `Move the initialization to \`__init__\`: \`self.${varName} = ${right.type === 'list' ? '[]' : right.type === 'dictionary' ? '{}' : 'set()'}\`.`,
          )
        }
      }
    }

    return null
  },
}
