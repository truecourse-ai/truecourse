import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { isPydanticModelClass } from '../../../_shared/python-framework-detection.js'

/** True if the class has a `@dataclass` (or `@dataclasses.dataclass`) decorator. */
function hasDataclassDecorator(classNode: SyntaxNode): boolean {
  for (const child of classNode.children) {
    if (child.type === 'decorator') {
      const expr = child.namedChildren[0]
      if (!expr) continue
      // @dataclass or @dataclass(...)
      if (expr.type === 'identifier' && expr.text === 'dataclass') return true
      if (expr.type === 'call') {
        const fn = expr.childForFieldName('function')
        if (fn?.type === 'identifier' && fn.text === 'dataclass') return true
        // @dataclasses.dataclass(...)
        if (fn?.type === 'attribute') {
          const attr = fn.childForFieldName('attribute')
          if (attr?.text === 'dataclass') return true
        }
      }
      // @dataclasses.dataclass
      if (expr.type === 'attribute') {
        const attr = expr.childForFieldName('attribute')
        if (attr?.text === 'dataclass') return true
      }
    }
  }
  return false
}

export const pythonMutableClassDefaultVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/mutable-class-default',
  languages: ['python'],
  nodeTypes: ['class_definition'],
  visit(node, filePath, sourceCode) {
    const body = node.childForFieldName('body')
    if (!body) return null

    // Pydantic models create new instances per-model, so mutable defaults are safe
    if (isPydanticModelClass(node)) return null

    // Dataclass fields are also handled specially — mutable defaults are safe
    if (hasDataclassDecorator(node)) return null

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
