import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const mixedTypeExportsVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/mixed-type-exports',
  languages: ['typescript', 'tsx'],
  nodeTypes: ['export_statement'],
  visit(node, filePath, sourceCode) {
    // export { Foo, type Bar } — mixed type and value exports
    let hasTypeSpecifier = false
    let hasValueSpecifier = false

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (!child) continue

      if (child.type === 'export_clause') {
        for (let j = 0; j < child.childCount; j++) {
          const spec = child.child(j)
          if (!spec) continue

          if (spec.type === 'export_specifier') {
            const firstToken = spec.child(0)
            if (firstToken?.type === 'type') {
              hasTypeSpecifier = true
            } else {
              hasValueSpecifier = true
            }
          }
        }
      }
    }

    if (hasTypeSpecifier && hasValueSpecifier) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Mixed type and value exports',
        'Export statement mixes `type` and value specifiers — separate into `export type { ... }` and `export { ... }`.',
        sourceCode,
        'Split into separate `export type` and `export` statements.',
      )
    }

    return null
  },
}
