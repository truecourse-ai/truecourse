import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'

// Modern TS 4.5+ inline-modifier form `import { v, type T } from 'x'` is the
// preferred idiom and NOT a violation. The deprecated "mixed" pattern is
// splitting one module's imports across multiple statements where one is
// type-only (`import type { T } from 'x'`) and another is value-only.
export const mixedTypeImportsVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/mixed-type-imports',
  languages: ['typescript', 'tsx'],
  nodeTypes: ['program'],
  visit(node, filePath, sourceCode) {
    type ImportRecord = { source: string; isTypeOnly: boolean; node: SyntaxNode }
    const imports: ImportRecord[] = []

    function getStringSource(n: SyntaxNode): string | null {
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (c?.type === 'string') return c.text.replace(/^['"`]|['"`]$/g, '')
      }
      return null
    }

    function isTopLevelTypeImport(n: SyntaxNode): boolean {
      // tree-sitter shape varies; use text-prefix check which is robust.
      return /^import\s+type\b/.test(n.text)
    }

    function walk(n: SyntaxNode) {
      if (n.type === 'import_statement') {
        const source = getStringSource(n)
        if (source) {
          imports.push({ source, isTypeOnly: isTopLevelTypeImport(n), node: n })
        }
        return
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) walk(c)
      }
    }
    walk(node)

    const bySource = new Map<string, ImportRecord[]>()
    for (const rec of imports) {
      const list = bySource.get(rec.source) ?? []
      list.push(rec)
      bySource.set(rec.source, list)
    }
    for (const recs of bySource.values()) {
      const typeOnlyRecs = recs.filter((r) => r.isTypeOnly)
      const valueRecs = recs.filter((r) => !r.isTypeOnly)
      if (typeOnlyRecs.length >= 1 && valueRecs.length >= 1) {
        return makeViolation(
          this.ruleKey, typeOnlyRecs[0]!.node, filePath, 'low',
          'Mixed type and value imports across statements',
          'Module imported via separate `import type` and value `import` statements. Combine using the TS 4.5+ inline `type` modifier.',
          sourceCode,
          'Use `import { value, type Type } from \'module\'`.',
        )
      }
    }

    return null
  },
}
