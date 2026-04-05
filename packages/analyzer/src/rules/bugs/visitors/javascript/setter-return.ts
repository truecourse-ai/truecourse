import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const setterReturnVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/setter-return',
  languages: JS_LANGUAGES,
  nodeTypes: ['method_definition'],
  visit(node, filePath, sourceCode) {
    const hasSetter = node.children.some((c) => c.text === 'set' && c.type !== 'property_identifier')
    if (!hasSetter) return null

    const body = node.childForFieldName('body')
    if (!body) return null

    function findReturnWithValue(block: SyntaxNode): SyntaxNode | null {
      for (const child of block.namedChildren) {
        if (child.type === 'return_statement' && child.namedChildren.length > 0) return child
        if (child.type === 'function_declaration' || child.type === 'arrow_function' ||
            child.type === 'function' || child.type === 'class_declaration') continue
        if (child.type === 'if_statement' || child.type === 'statement_block' || child.type === 'else_clause') {
          const found = findReturnWithValue(child)
          if (found) return found
        }
      }
      return null
    }

    const returnNode = findReturnWithValue(body)
    if (returnNode) {
      return makeViolation(
        this.ruleKey, returnNode, filePath, 'medium',
        'Setter with return value',
        'Setters should not return a value — the return value is always ignored.',
        sourceCode,
        'Remove the return value from the setter.',
      )
    }
    return null
  },
}
