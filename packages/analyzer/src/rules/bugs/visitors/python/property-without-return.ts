import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonPropertyWithoutReturnVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/property-without-return',
  languages: ['python'],
  nodeTypes: ['decorated_definition'],
  visit(node, filePath, sourceCode) {
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
    // If it's just `pass` or `...`, flag it
    const isStubBody = statements.length === 0 ||
      (statements.length === 1 && (statements[0].type === 'pass_statement' || statements[0].type === 'expression_statement' && statements[0].text === '...'))
    if (isStubBody) return null // Stubs are intentional

    function hasReturnValue(n: import('tree-sitter').SyntaxNode): boolean {
      if (n.type === 'return_statement' && n.namedChildren.length > 0) return true
      if (n.type === 'function_definition') return false
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child && hasReturnValue(child)) return true
      }
      return false
    }

    if (!hasReturnValue(body)) {
      const funcName = funcDef.childForFieldName('name')?.text ?? 'property'
      return makeViolation(
        this.ruleKey, funcDef, filePath, 'high',
        'Property method without return',
        `\`@property\` getter \`${funcName}\` never returns a value — accessing \`obj.${funcName}\` always returns \`None\`.`,
        sourceCode,
        'Add a `return` statement with a value to the property getter.',
      )
    }
    return null
  },
}
