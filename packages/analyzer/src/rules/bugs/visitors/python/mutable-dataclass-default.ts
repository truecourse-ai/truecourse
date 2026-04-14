import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonMutableDataclassDefaultVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/mutable-dataclass-default',
  languages: ['python'],
  nodeTypes: ['class_definition'],
  visit(node, filePath, sourceCode) {
    // Check if this class is decorated with @dataclass
    const parent = node.parent
    if (!parent || parent.type !== 'decorated_definition') return null

    const decorators = parent.namedChildren.filter((c) => c.type === 'decorator')
    const isDataclass = decorators.some((d) => {
      const expr = d.namedChildren[0]
      if (!expr) return false
      return (expr.type === 'identifier' && expr.text === 'dataclass') ||
        (expr.type === 'call' && expr.childForFieldName('function')?.text === 'dataclass')
    })
    if (!isDataclass) return null

    const body = node.childForFieldName('body')
    if (!body) return null

    for (const child of body.namedChildren) {
      if (child.type === 'expression_statement') {
        const expr = child.namedChildren[0]
        if (!expr || expr.type !== 'assignment') continue

        const right = expr.childForFieldName('right')
        if (!right) continue

        if (right.type === 'list' || right.type === 'dictionary' || right.type === 'set') {
          const left = expr.childForFieldName('left')
          const varName = left?.text ?? 'field'
          const factory = right.type === 'list' ? 'list' : right.type === 'dictionary' ? 'dict' : 'set'
          return makeViolation(
            this.ruleKey, expr, filePath, 'high',
            'Mutable dataclass field default',
            `Dataclass field \`${varName}\` has a mutable default value — this is shared across all instances. Use \`field(default_factory=${factory})\` instead.`,
            sourceCode,
            `Replace \`${varName} = ${right.text}\` with \`${varName}: ${factory} = field(default_factory=${factory})\`.`,
          )
        }
      }
    }

    return null
  },
}
