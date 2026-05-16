import type { Node as SyntaxNode } from 'web-tree-sitter'
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

    function isNestedFunctionNode(n: SyntaxNode): boolean {
      return n.type === 'function_declaration' || n.type === 'arrow_function'
        || n.type === 'function' || n.type === 'function_expression'
        || n.type === 'method_definition'
    }

    // Pass 1: collect declarations only in THIS function's own scope (skip
    // nested function bodies — their declarations are in a different scope).
    function collectDeclarations(n: SyntaxNode) {
      if (n.type === 'variable_declaration' || n.type === 'lexical_declaration') {
        for (const declarator of n.namedChildren) {
          if (declarator.type === 'variable_declarator') {
            const name = declarator.childForFieldName('name')
            const value = declarator.childForFieldName('value')
            if (name?.type === 'identifier' && !value) {
              // Skip TypeScript definite-assignment assertion (`let x!: T`).
              // The `!` token tells the compiler the variable is assigned
              // before use elsewhere (e.g. inside a synchronous Promise
              // constructor callback or a closure passed to a function
              // that invokes it immediately). Honor that intent.
              if (declarator.text.includes('!')) continue
              // Skip declarations under `declare const X: ...` / `declare let X`
              // — these are ambient type declarations, not runtime variables.
              let ambientAncestor: SyntaxNode | null = declarator.parent
              while (ambientAncestor) {
                if (ambientAncestor.type === 'ambient_declaration') break
                ambientAncestor = ambientAncestor.parent
              }
              if (ambientAncestor) continue
              declaredNoInit.set(name.text, declarator)
            }
          }
        }
      }
      if (n.id !== body?.id && isNestedFunctionNode(n)) return
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) collectDeclarations(child)
      }
    }

    // Pass 2: collect assignments including those inside nested closures.
    // Closures defined in this scope can capture and mutate the outer
    // variable (event handler pattern, Promise constructor pattern,
    // callback pattern), so an assignment anywhere within the function
    // counts as "the variable does get assigned".
    function collectAssignments(n: SyntaxNode) {
      if (n.type === 'assignment_expression') {
        const left = n.childForFieldName('left')
        if (left?.type === 'identifier') assigned.add(left.text)
      }
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) collectAssignments(child)
      }
    }

    collectDeclarations(body)
    collectAssignments(body)

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

