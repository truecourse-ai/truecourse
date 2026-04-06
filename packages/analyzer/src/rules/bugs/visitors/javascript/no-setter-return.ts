import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const noSetterReturnVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/no-setter-return',
  languages: JS_LANGUAGES,
  nodeTypes: ['method_definition'],
  visit(node, filePath, sourceCode) {
    // Check if this is a setter
    const hasSetter = node.children.some((c) => c.text === 'set' && c.type !== 'property_identifier')
    if (!hasSetter) return null

    const body = node.childForFieldName('body')
    if (!body) return null

    function findReturnWithValue(block: SyntaxNode): SyntaxNode | null {
      for (const child of block.namedChildren) {
        if (child.type === 'return_statement') {
          const returnChildren = child.namedChildren
          if (returnChildren.length > 0) {
            return child
          }
        }
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
        'Return value from a setter is always ignored — this return has no effect.',
        sourceCode,
        'Remove the return value from the setter.',
      )
    }
    return null
  },
}
