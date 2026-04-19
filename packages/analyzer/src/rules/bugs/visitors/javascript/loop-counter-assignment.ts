import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const loopCounterAssignmentVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/loop-counter-assignment',
  languages: JS_LANGUAGES,
  nodeTypes: ['for_statement'],
  visit(node, filePath, sourceCode) {
    // Get the loop variable from the initializer
    const init = node.childForFieldName('initializer')
    if (!init) return null

    let loopVar: string | null = null
    if (init.type === 'lexical_declaration' || init.type === 'variable_declaration') {
      const declarator = init.namedChildren.find((c) => c.type === 'variable_declarator')
      if (declarator) {
        const name = declarator.childForFieldName('name')
        if (name) loopVar = name.text
      }
    }
    if (!loopVar) return null

    const body = node.childForFieldName('body')
    if (!body) return null

    // Search for plain assignment to the loop counter in the body
    function findAssignment(n: SyntaxNode): SyntaxNode | null {
      if (n.type === 'assignment_expression') {
        const left = n.childForFieldName('left')
        const op = n.children.find((c) => c.text === '=')
        if (left?.text === loopVar && op?.text === '=') {
          // Make sure it's plain = not += or -=
          return n
        }
      }
      // Don't recurse into nested functions
      if (n.type === 'function_declaration' || n.type === 'arrow_function' || n.type === 'function') return null
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) {
          const found = findAssignment(child)
          if (found) return found
        }
      }
      return null
    }

    const assignment = findAssignment(body)
    if (assignment) {
      return makeViolation(
        this.ruleKey, assignment, filePath, 'high',
        'Loop counter assignment',
        `Loop counter \`${loopVar}\` is assigned inside the loop body instead of being incremented/decremented.`,
        sourceCode,
        'Use += or -= to modify the loop counter, or restructure the loop.',
      )
    }
    return null
  },
}
