import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const importReassignmentVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/import-reassignment',
  languages: JS_LANGUAGES,
  nodeTypes: ['program'],
  visit(node, filePath, sourceCode) {
    const importNames = new Set<string>()
    for (const child of node.namedChildren) {
      if (child.type === 'import_statement') {
        // Collect all imported identifiers
        function collectImportNames(n: SyntaxNode) {
          if (n.type === 'identifier' && n.parent?.type === 'import_clause') {
            importNames.add(n.text)
          }
          if (n.type === 'import_specifier') {
            const alias = n.childForFieldName('alias')
            const name = n.childForFieldName('name')
            importNames.add(alias?.text || name?.text || '')
          }
          if (n.type === 'namespace_import') {
            const name = n.namedChildren.find((c) => c.type === 'identifier')
            if (name) importNames.add(name.text)
          }
          for (let i = 0; i < n.childCount; i++) {
            const c = n.child(i)
            if (c) collectImportNames(c)
          }
        }
        collectImportNames(child)
      }
    }
    if (importNames.size === 0) return null

    function findReassignment(n: SyntaxNode): SyntaxNode | null {
      if (n.type === 'assignment_expression' || n.type === 'augmented_assignment_expression') {
        const left = n.childForFieldName('left')
        if (left?.type === 'identifier' && importNames.has(left.text)) {
          return n
        }
      }
      if (n.type === 'update_expression') {
        const arg = n.childForFieldName('argument')
        if (arg?.type === 'identifier' && importNames.has(arg.text)) {
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
      const varName = reassignment.type === 'update_expression'
        ? reassignment.childForFieldName('argument')?.text
        : reassignment.childForFieldName('left')?.text
      return makeViolation(
        this.ruleKey, reassignment, filePath, 'high',
        'Import reassignment',
        `\`${varName}\` is an import binding and cannot be reassigned.`,
        sourceCode,
        'Use a different variable name instead of reassigning the import.',
      )
    }
    return null
  },
}
