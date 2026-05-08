import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const typeImportSideEffectsVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/type-import-side-effects',
  languages: ['typescript', 'tsx'],
  nodeTypes: ['import_statement'],
  visit(node, filePath, sourceCode) {
    // Detect: import { type Foo } from '...' — inline type on specifier without top-level type
    // The fix is to use import type { Foo } at the top level
    // This rule flags: import { type X, Y } where type import causes side effects

    // Check if import has 'type' keyword at top level: import type { ... }
    // In tree-sitter, import_statement > import_clause. For top-level type imports,
    // the import_clause may start with a 'type' node.
    const importClause = node.namedChildren.find(c => c.type === 'import_clause')
    if (!importClause) return null

    // Check if the import_clause starts with 'type' keyword
    const firstClauseChild = importClause.child(0)
    const hasTopLevelType = firstClauseChild?.type === 'type'

    if (hasTopLevelType) return null // Already a type import, fine

    // Check for inline type specifiers in named imports.
    // Also track whether the import_clause has a DEFAULT or
    // NAMESPACE specifier — those are value imports that force
    // module load regardless of inline \`type\` on named members.
    let hasInlineType = false
    let hasValueImport = false
    function findNamedImports(n: any) {
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (!child) continue
        if (child.type === 'named_imports') {
          for (let j = 0; j < child.childCount; j++) {
            const spec = child.child(j)
            if (!spec || spec.type !== 'import_specifier') continue
            const tok0 = spec.child(0)
            if (tok0?.type === 'type') {
              hasInlineType = true
            } else {
              hasValueImport = true
            }
          }
        } else if (child.type === 'identifier') {
          // Default specifier: \`import Foo from 'p'\` → identifier is
          // a direct child of import_clause.
          hasValueImport = true
        } else if (child.type === 'namespace_import') {
          // \`import * as Foo from 'p'\` → namespace_import is value.
          hasValueImport = true
        } else if (child.type === 'import_clause') {
          findNamedImports(child)
        }
      }
    }
    findNamedImports(node)

    if (!hasInlineType) return null

    // If there are value imports mixed with type imports, the module loads anyway —
    // inline `type` is correct and preferred (no side-effect concern)
    if (hasValueImport) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Type import specifier may cause side effects',
      'Inline `type` on import specifiers (`import { type Foo }`) may still trigger module side effects. Use `import type { Foo }` instead.',
      sourceCode,
      'Change to `import type { Foo }` to prevent module side effects.',
    )
  },
}
