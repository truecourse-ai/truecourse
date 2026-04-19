import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonGetterMissingReturnVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/getter-missing-return',
  languages: ['python'],
  nodeTypes: ['decorated_definition'],
  visit(node, filePath, sourceCode) {
    // Check if decorated with @property
    const decorators = node.namedChildren.filter((c) => c.type === 'decorator')
    const isProperty = decorators.some((d) => {
      const expr = d.namedChildren[0]
      return expr?.type === 'identifier' && expr.text === 'property'
    })
    if (!isProperty) return null

    const funcDef = node.namedChildren.find((c) => c.type === 'function_definition')
    if (!funcDef) return null

    const body = funcDef.childForFieldName('body')
    if (!body) return null

    const statements = body.namedChildren.filter((c) => c.type !== 'comment')
    // Skip if only pass
    if (statements.length === 1 && statements[0].type === 'pass_statement') {
      return makeViolation(
        this.ruleKey, funcDef, filePath, 'high',
        'Getter missing return',
        'This @property getter only contains `pass` and will always return None.',
        sourceCode,
        'Add a return statement to the property getter.',
      )
    }

    function hasReturn(n: import('web-tree-sitter').Node): boolean {
      if (n.type === 'return_statement' && n.namedChildren.length > 0) return true
      if (n.type === 'function_definition') return false
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child && hasReturn(child)) return true
      }
      return false
    }

    if (!hasReturn(body)) {
      return makeViolation(
        this.ruleKey, funcDef, filePath, 'high',
        'Getter missing return',
        'This @property getter never returns a value and will always return None.',
        sourceCode,
        'Add a return statement with a value to the property getter.',
      )
    }
    return null
  },
}
