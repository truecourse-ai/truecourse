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
