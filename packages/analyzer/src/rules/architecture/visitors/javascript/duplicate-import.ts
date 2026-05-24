import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const duplicateImportVisitor: CodeRuleVisitor = {
  ruleKey: 'architecture/deterministic/duplicate-import',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['program'],
  visit(node, filePath, sourceCode) {
    const imports = node.namedChildren.filter((c) => c.type === 'import_statement')
    const sourceMap = new Map<string, SyntaxNode>()

    for (const imp of imports) {
      const source = imp.childForFieldName('source')
      if (!source) continue
      const moduleName = source.text.replace(/['"]/g, '')

      if (sourceMap.has(moduleName)) {
        const prevImp = sourceMap.get(moduleName)!
        // Skip when one import is type-only and the other is a value import.
        // `import type { T }` and `import { V }` from the same module is valid TS.
        const prevIsTypeOnly = prevImp.text.includes('import type')
        const currentIsTypeOnly = imp.text.includes('import type')
        if (prevIsTypeOnly !== currentIsTypeOnly) continue

        // Skip when one import is a side-effect-only import (`import 'x'`)
        // and the other pulls bindings. The bare form is intentional — it
        // documents that the module is loaded for its side effects — and
        // mechanically merging into the named import erases that intent.
        const prevIsSideEffectOnly = isSideEffectOnly(prevImp)
        const currentIsSideEffectOnly = isSideEffectOnly(imp)
        if (prevIsSideEffectOnly !== currentIsSideEffectOnly) continue

        return makeViolation(
          this.ruleKey, imp, filePath, 'low',
          'Duplicate import',
          `Module '${moduleName}' is imported more than once. Consolidate into a single import.`,
          sourceCode,
          `Merge the imports from '${moduleName}' into a single import statement.`,
        )
      }
      sourceMap.set(moduleName, imp)
    }

    return null
  },
}

// `import 'foo'` — no import_clause, just the source string. Used to trigger
// a module's top-level side effects (polyfills, CSS bundling, registration
// calls). Distinct intent from `import { x } from 'foo'`.
function isSideEffectOnly(imp: SyntaxNode): boolean {
  for (const child of imp.namedChildren) {
    if (child.type === 'import_clause') return false
  }
  return true
}

