import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'

// Inline-modifier `export { v, type T }` is the modern preferred idiom and
// NOT a violation. The deprecated pattern is splitting one module's named
// exports across multiple `export` statements where one is type-only.
export const mixedTypeExportsVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/mixed-type-exports',
  languages: ['typescript', 'tsx'],
  nodeTypes: ['program'],
  visit(node, filePath, sourceCode) {
    let typeOnlyExportNode: SyntaxNode | null = null
    let hasValueExportClause = false

    function isTypeOnlyExport(n: SyntaxNode): boolean {
      // Top-level `export type { ... }` — first non-keyword named child is 'type'
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (!c) continue
        if (c.type === 'export') continue
        if (c.type === 'type') return true
        if (c.type === 'export_clause') return false
        break
      }
      return false
    }

    function hasExportClauseWithValueSpecifier(n: SyntaxNode): boolean {
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (c?.type !== 'export_clause') continue
        for (let j = 0; j < c.childCount; j++) {
          const spec = c.child(j)
          if (spec?.type !== 'export_specifier') continue
          const firstToken = spec.child(0)
          if (firstToken?.type !== 'type') return true
        }
      }
      return false
    }

    function walk(n: SyntaxNode) {
      if (n.type === 'export_statement') {
        if (isTypeOnlyExport(n)) {
          if (!typeOnlyExportNode) typeOnlyExportNode = n
        } else if (hasExportClauseWithValueSpecifier(n)) {
          hasValueExportClause = true
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) walk(c)
      }
    }
    walk(node)

    if (typeOnlyExportNode && hasValueExportClause) {
      return makeViolation(
        this.ruleKey, typeOnlyExportNode, filePath, 'low',
        'Mixed type and value exports across statements',
        'Module has both `export type { ... }` and value `export { ... }` statements. Combine using inline `type` modifier.',
        sourceCode,
        'Use `export { value, type Type }`.',
      )
    }

    return null
  },
}
