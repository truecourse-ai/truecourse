import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonSingledispatchMethodMismatchVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/singledispatch-method-mismatch',
  languages: ['python'],
  nodeTypes: ['decorated_definition'],
  visit(node, filePath, sourceCode) {
    const decorators = node.namedChildren.filter((c) => c.type === 'decorator')
    const funcDef = node.namedChildren.find((c) => c.type === 'function_definition')
    if (!funcDef) return null

    // Determine if inside a class (method)
    const isInsideClass = (n: import('tree-sitter').SyntaxNode): boolean => {
      let curr = n.parent
      while (curr) {
        if (curr.type === 'class_definition') return true
        if (curr.type === 'function_definition') return false
        curr = curr.parent
      }
      return false
    }
    const isMethod = isInsideClass(node)

    for (const dec of decorators) {
      const decExpr = dec.namedChildren[0]
      if (!decExpr) continue
      const decName = decExpr.type === 'identifier' ? decExpr.text
        : decExpr.type === 'attribute' ? decExpr.childForFieldName('attribute')?.text ?? ''
        : ''

      if (decName === 'singledispatch' && isMethod) {
        return makeViolation(
          this.ruleKey, dec, filePath, 'high',
          'singledispatch on instance method',
          '`@singledispatch` is designed for module-level functions. Use `@singledispatchmethod` for instance methods.',
          sourceCode,
          'Replace `@singledispatch` with `@singledispatchmethod` from `functools`.',
        )
      }
      if (decName === 'singledispatchmethod' && !isMethod) {
        return makeViolation(
          this.ruleKey, dec, filePath, 'high',
          'singledispatchmethod on plain function',
          '`@singledispatchmethod` is designed for instance methods. Use `@singledispatch` for module-level functions.',
          sourceCode,
          'Replace `@singledispatchmethod` with `@singledispatch` from `functools`.',
        )
      }
    }
    return null
  },
}
