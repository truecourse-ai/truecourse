import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const mixedTypeImportsVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/mixed-type-imports',
  languages: ['typescript', 'tsx'],
  nodeTypes: ['import_statement'],
  visit(node, filePath, sourceCode) {
    // import { Foo, type Bar } from '...' — mixed type and value imports
    // We want: import type { Bar } from '...' + import { Foo } from '...'

    // Check if there are both typed and non-typed specifiers
    let hasTypeSpecifier = false
    let hasValueSpecifier = false

    // Find named_imports by walking through import_clause
    function checkSpecifiers(parent: import('tree-sitter').SyntaxNode) {
      for (let i = 0; i < parent.childCount; i++) {
        const child = parent.child(i)
        if (!child) continue

        if (child.type === 'import_specifier') {
          const firstToken = child.child(0)
          if (firstToken?.type === 'type') {
            hasTypeSpecifier = true
          } else {
            hasValueSpecifier = true
          }
        } else if (child.type === 'named_imports' || child.type === 'import_clause') {
          checkSpecifiers(child)
        }
      }
    }
    checkSpecifiers(node)

    if (hasTypeSpecifier && hasValueSpecifier) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Mixed type and value imports',
        'Import statement mixes `type` and value specifiers — separate into `import type { ... }` and `import { ... }`.',
        sourceCode,
        'Split into separate `import type` and `import` statements.',
      )
    }

    return null
  },
}
