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

    // Check if import has 'type' keyword at top level
    const firstChild = node.child(1) // 'import' is child 0
    const hasTopLevelType = firstChild?.type === 'type'

    if (hasTopLevelType) return null // Already a type import, fine

    // Check for inline type specifiers in named imports
    let hasInlineType = false
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (!child || child.type !== 'named_imports') continue

      for (let j = 0; j < child.childCount; j++) {
        const spec = child.child(j)
        if (!spec || spec.type !== 'import_specifier') continue

        const tok0 = spec.child(0)
        if (tok0?.type === 'type') {
          hasInlineType = true
          break
        }
      }
    }

    if (!hasInlineType) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Type import specifier may cause side effects',
      'Inline `type` on import specifiers (`import { type Foo }`) may still trigger module side effects. Use `import type { Foo }` instead.',
      sourceCode,
      'Change to `import type { Foo }` to prevent module side effects.',
    )
  },
}
