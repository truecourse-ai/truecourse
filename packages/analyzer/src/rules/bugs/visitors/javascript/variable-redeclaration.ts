import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const variableRedeclarationVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/variable-redeclaration',
  languages: JS_LANGUAGES,
  nodeTypes: ['program', 'function_declaration', 'function', 'arrow_function', 'method_definition'],
  visit(node, filePath, sourceCode) {
    // Collect all var declarations in this scope (not nested functions)
    const varNames = new Map<string, SyntaxNode>()

    function collectVars(n: SyntaxNode) {
      if (n.type === 'variable_declaration') {
        const hasVar = n.children.some((c) => c.text === 'var')
        if (hasVar) {
          for (const declarator of n.namedChildren) {
            if (declarator.type === 'variable_declarator') {
              const nameNode = declarator.childForFieldName('name')
              if (nameNode?.type === 'identifier') {
                const name = nameNode.text
                if (varNames.has(name)) {
                  // Found redeclaration
                  makeViolation(
                    'bugs/deterministic/variable-redeclaration', declarator, filePath, 'high',
                    'Variable redeclaration',
                    `\`${name}\` is already declared with \`var\` in this scope — the second declaration is silently ignored.`,
                    sourceCode,
                    `Remove the duplicate \`var ${name}\` declaration or rename the variable.`,
                  )
                }
                varNames.set(name, nameNode)
              }
            }
          }
        }
      }
      // Don't recurse into nested function scopes
      if (n !== node && (n.type === 'function_declaration' || n.type === 'arrow_function' || n.type === 'function' || n.type === 'method_definition')) return
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) collectVars(child)
      }
    }

    // Get the body node
    let body: SyntaxNode = node
    if (node.type !== 'program') {
      const b = node.childForFieldName('body')
      if (b) body = b
    }

    const redecls: SyntaxNode[] = []

    function collectVars2(n: SyntaxNode): SyntaxNode | null {
      if (n.type === 'variable_declaration') {
        const hasVar = n.children.some((c) => c.text === 'var')
        if (hasVar) {
          for (const declarator of n.namedChildren) {
            if (declarator.type === 'variable_declarator') {
              const nameNode = declarator.childForFieldName('name')
              if (nameNode?.type === 'identifier') {
                const name = nameNode.text
                if (varNames.has(name)) {
                  return declarator
                }
                varNames.set(name, nameNode)
              }
            }
          }
        }
      }
      if (n !== node && (n.type === 'function_declaration' || n.type === 'arrow_function' || n.type === 'function' || n.type === 'method_definition')) return null
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) {
          const found = collectVars2(child)
          if (found) return found
        }
      }
      return null
    }

    const redecl = collectVars2(body)
    if (redecl) {
      const nameNode = redecl.childForFieldName('name')
      const name = nameNode?.text ?? 'variable'
      return makeViolation(
        this.ruleKey, redecl, filePath, 'high',
        'Variable redeclaration',
        `\`${name}\` is already declared with \`var\` in this scope — the second declaration is silently ignored.`,
        sourceCode,
        `Remove the duplicate \`var ${name}\` declaration or rename the variable.`,
      )
    }
    return null
  },
}
