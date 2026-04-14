import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const getterMissingReturnVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/getter-missing-return',
  languages: JS_LANGUAGES,
  nodeTypes: ['method_definition'],
  visit(node, filePath, sourceCode) {
    const hasGetter = node.children.some((c) => c.text === 'get' && c.type !== 'property_identifier')
    if (!hasGetter) return null

    const body = node.childForFieldName('body')
    if (!body) return null

    const statements = body.namedChildren.filter((c) => c.type !== 'comment')
    if (statements.length === 0) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Getter missing return',
        'This getter has an empty body and will always return undefined.',
        sourceCode,
        'Add a return statement to the getter.',
      )
    }

    // Check if there's at least one return statement with a value
    function hasReturnWithValue(n: SyntaxNode): boolean {
      if (n.type === 'return_statement' && n.namedChildren.length > 0) return true
      if (n.type === 'function_declaration' || n.type === 'arrow_function' || n.type === 'function') return false
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child && hasReturnWithValue(child)) return true
      }
      return false
    }

    if (!hasReturnWithValue(body)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Getter missing return',
        'This getter never returns a value and will always return undefined.',
        sourceCode,
        'Add a return statement with a value to the getter.',
      )
    }
    return null
  },
}
