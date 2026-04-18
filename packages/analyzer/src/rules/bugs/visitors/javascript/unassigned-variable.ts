import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const unassignedVariableVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/unassigned-variable',
  languages: JS_LANGUAGES,
  nodeTypes: ['function_declaration', 'function', 'arrow_function', 'method_definition'],
  visit(node, filePath, sourceCode) {
    let body: SyntaxNode | null = null
    if (node.type === 'method_definition' || node.type === 'function_declaration' || node.type === 'function') {
      body = node.childForFieldName('body')
    } else if (node.type === 'arrow_function') {
      body = node.childForFieldName('body')
      if (body?.type !== 'statement_block') return null
    }
    if (!body || body.type !== 'statement_block') return null

    // Collect let/var declarations without initializers
    const declaredNoInit = new Map<string, SyntaxNode>()
    const assigned = new Set<string>()
    const readBeforeAssign = new Set<string>()

    function processNode(n: SyntaxNode) {
      if (n.type === 'variable_declaration' || n.type === 'lexical_declaration') {
        for (const declarator of n.namedChildren) {
          if (declarator.type === 'variable_declarator') {
            const name = declarator.childForFieldName('name')
            const value = declarator.childForFieldName('value')
            if (name?.type === 'identifier' && !value) {
              declaredNoInit.set(name.text, declarator)
            }
          }
        }
      }

      if (n.type === 'assignment_expression') {
        const left = n.childForFieldName('left')
        if (left?.type === 'identifier') assigned.add(left.text)
      }

      // Don't recurse into nested functions
      if (n.id !== body?.id && (n.type === 'function_declaration' || n.type === 'arrow_function' || n.type === 'function' || n.type === 'method_definition')) return

      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) processNode(child)
      }
    }

    processNode(body)

    // Find a variable that was declared without assignment and never assigned
    for (const [name, declNode] of declaredNoInit) {
      if (!assigned.has(name)) {
        return makeViolation(
          this.ruleKey, declNode, filePath, 'high',
          'Unassigned variable',
          `\`${name}\` is declared but never assigned — it will always be \`undefined\` when read.`,
          sourceCode,
          `Assign a value to \`${name}\` or remove the declaration if unused.`,
        )
      }
    }
    return null
  },
}

