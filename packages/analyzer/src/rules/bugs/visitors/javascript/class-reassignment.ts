import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const classReassignmentVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/class-reassignment',
  languages: JS_LANGUAGES,
  nodeTypes: ['program'],
  visit(node, filePath, sourceCode) {
    const classNames = new Set<string>()
    for (const child of node.namedChildren) {
      if (child.type === 'class_declaration') {
        const name = child.childForFieldName('name')
        if (name) classNames.add(name.text)
      }
    }
    if (classNames.size === 0) return null

    function findReassignment(n: SyntaxNode): SyntaxNode | null {
      if (n.type === 'assignment_expression') {
        const left = n.childForFieldName('left')
        if (left?.type === 'identifier' && classNames.has(left.text)) {
          return n
        }
      }
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
      const varName = reassignment.childForFieldName('left')?.text
      return makeViolation(
        this.ruleKey, reassignment, filePath, 'high',
        'Class reassignment',
        `\`${varName}\` is a class declaration and should not be reassigned.`,
        sourceCode,
        'Use a different variable name instead of reassigning the class.',
      )
    }
    return null
  },
}
