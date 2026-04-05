import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonRedefinedWhileUnusedVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/redefined-while-unused',
  languages: ['python'],
  nodeTypes: ['module'],
  visit(node, filePath, sourceCode) {
    // Collect import bindings in order, detect if a name is imported again before being used
    // We do a simplified check: find duplicate imports of the same name at module level
    const imported = new Map<string, import('tree-sitter').SyntaxNode>()

    for (const stmt of node.namedChildren) {
      if (stmt.type === 'import_statement') {
        for (const child of stmt.namedChildren) {
          let name: string | null = null
          let aliasNode: import('tree-sitter').SyntaxNode | null = null

          if (child.type === 'aliased_import') {
            // import foo as bar
            const alias = child.childForFieldName('alias')
            if (alias) {
              name = alias.text
              aliasNode = child
            }
          } else if (child.type === 'dotted_name' || child.type === 'identifier') {
            name = child.text.split('.')[0]
            aliasNode = child
          }

          if (name && aliasNode) {
            if (imported.has(name)) {
              return makeViolation(
                this.ruleKey, aliasNode, filePath, 'medium',
                'Import redefined before use',
                `\`${name}\` is imported again before it was ever used — the first import is shadowed and effectively wasted.`,
                sourceCode,
                'Remove the duplicate import, or use the first import before re-importing.',
              )
            }
            imported.set(name, aliasNode)
          }
        }
      } else if (stmt.type === 'import_from_statement') {
        // from X import a, b
        for (const child of stmt.namedChildren) {
          if (child.type === 'aliased_import') {
            const alias = child.childForFieldName('alias')
            const name = alias?.text ?? child.text
            if (name && imported.has(name)) {
              return makeViolation(
                this.ruleKey, child, filePath, 'medium',
                'Import redefined before use',
                `\`${name}\` is imported again before it was ever used — the first import is shadowed.`,
                sourceCode,
                'Remove the duplicate import.',
              )
            }
            if (name) imported.set(name, child)
          } else if (child.type === 'identifier') {
            const name = child.text
            if (imported.has(name)) {
              return makeViolation(
                this.ruleKey, child, filePath, 'medium',
                'Import redefined before use',
                `\`${name}\` is imported again before it was ever used — the first import is shadowed.`,
                sourceCode,
                'Remove the duplicate import.',
              )
            }
            imported.set(name, child)
          }
        }
      } else if (stmt.type !== 'comment') {
        // Any non-import, non-comment statement means imports may have been used — reset
        // We only track consecutive top-level imports
        imported.clear()
      }
    }
    return null
  },
}
