import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonLoadBeforeGlobalDeclarationVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/load-before-global-declaration',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    const body = node.childForFieldName('body')
    if (!body) return null

    // Find global declarations and their positions in the statement list
    const statements = body.namedChildren.filter((c) => c.type !== 'comment')

    // Map: varName -> index of global declaration
    const globalDeclIdx = new Map<string, number>()
    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i]
      if (stmt.type === 'global_statement') {
        for (const child of stmt.namedChildren) {
          if (child.type === 'identifier') {
            globalDeclIdx.set(child.text, i)
          }
        }
      }
    }
    if (globalDeclIdx.size === 0) return null

    // Find any use of a globally-declared variable before its declaration
    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i]
      if (stmt.type === 'global_statement') continue

      // Look for identifier references in this statement
      function findIdentifiers(n: import('web-tree-sitter').Node): string[] {
        const ids: string[] = []
        if (n.type === 'identifier') ids.push(n.text)
        // Don't descend into nested function defs
        if (n !== stmt && n.type === 'function_definition') return ids
        for (let j = 0; j < n.childCount; j++) {
          const child = n.child(j)
          if (child) ids.push(...findIdentifiers(child))
        }
        return ids
      }

      const usedNames = findIdentifiers(stmt)
      for (const name of usedNames) {
        const declIdx = globalDeclIdx.get(name)
        if (declIdx !== undefined && i < declIdx) {
          // Statement uses the variable before the global declaration
          return makeViolation(
            this.ruleKey, stmt, filePath, 'high',
            'Variable used before global declaration',
            `\`${name}\` is used at statement ${i + 1} but its \`global\` declaration appears at statement ${declIdx + 1} — this causes a SyntaxError.`,
            sourceCode,
            `Move the \`global ${name}\` declaration to the top of the function, before any use of \`${name}\`.`,
          )
        }
      }
    }
    return null
  },
}

