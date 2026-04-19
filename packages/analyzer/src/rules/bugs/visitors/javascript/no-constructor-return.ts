import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const noConstructorReturnVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/no-constructor-return',
  languages: JS_LANGUAGES,
  nodeTypes: ['method_definition'],
  visit(node, filePath, sourceCode) {
    const name = node.childForFieldName('name')
    if (!name || name.text !== 'constructor') return null

    const body = node.childForFieldName('body')
    if (!body) return null

    // Look for return statements with a value in the direct body (not nested functions)
    function findReturnWithValue(block: SyntaxNode): SyntaxNode | null {
      for (const child of block.namedChildren) {
        if (child.type === 'return_statement') {
          const returnChildren = child.namedChildren
          if (returnChildren.length > 0) {
            return child
          }
        }
        // Don't recurse into nested functions/classes
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
        this.ruleKey, returnNode, filePath, 'high',
        'Constructor with return value',
        'Returning a value from a constructor replaces the constructed instance — this is almost always a bug.',
        sourceCode,
        'Remove the return value from the constructor, or use a static factory method instead.',
      )
    }
    return null
  },
}
