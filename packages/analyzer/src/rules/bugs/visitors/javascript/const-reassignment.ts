import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const constReassignmentVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/const-reassignment',
  languages: JS_LANGUAGES,
  nodeTypes: ['program'],
  visit(node, filePath, sourceCode) {
    // Collect all const declarations in the top scope and function scopes
    const constVars = new Map<string, SyntaxNode>()

    function collectConsts(block: SyntaxNode) {
      for (const child of block.namedChildren) {
        if (child.type === 'lexical_declaration') {
          // Check if it's a const
          const constKeyword = child.children.find((c) => c.text === 'const')
          if (constKeyword) {
            for (const decl of child.namedChildren) {
              if (decl.type === 'variable_declarator') {
                const name = decl.childForFieldName('name')
                if (name?.type === 'identifier') {
                  constVars.set(name.text, name)
                }
              }
            }
          }
        }
      }
    }

    collectConsts(node)

    // Now find any reassignments
    function findReassignment(n: SyntaxNode): SyntaxNode | null {
      if (n.type === 'assignment_expression' || n.type === 'augmented_assignment_expression') {
        const left = n.childForFieldName('left')
        if (left?.type === 'identifier' && constVars.has(left.text)) {
          return n
        }
      }
      if (n.type === 'update_expression') {
        const arg = n.childForFieldName('argument')
        if (arg?.type === 'identifier' && constVars.has(arg.text)) {
          return n
        }
      }
      // Don't recurse into nested scopes that might shadow the const
      if (n.type === 'function_declaration' || n.type === 'arrow_function' || n.type === 'function') return null
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) {
          const found = findReassignment(child)
          if (found) return found
        }
      }
      return null
    }

    const reassignment = findReassignment(node)
    if (reassignment) {
      const varName = reassignment.type === 'update_expression'
        ? reassignment.childForFieldName('argument')?.text
        : reassignment.childForFieldName('left')?.text
      return makeViolation(
        this.ruleKey, reassignment, filePath, 'high',
        'Const reassignment',
        `\`${varName}\` is declared with \`const\` and cannot be reassigned.`,
        sourceCode,
        `Use \`let\` instead of \`const\` if you need to reassign \`${varName}\`.`,
      )
    }
    return null
  },
}
