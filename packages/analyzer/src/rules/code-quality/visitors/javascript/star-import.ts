import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const jsStarImportVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/star-import',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['import_statement'],
  visit(node, filePath, sourceCode) {
    const hasNamespaceImport = node.namedChildren.some(
      (c) => c.type === 'import_clause' && c.namedChildren.some((cc) => cc.type === 'namespace_import')
    )
    if (hasNamespaceImport) {
      // Skip type-only namespace imports: `import type * as X from 'pkg'`.
      // The `type` keyword causes the entire import to be erased at compile
      // time, so tree-shaking / runtime-load concerns don't apply.
      const isTypeOnly = node.children.some((c) => !c.isNamed && c.type === 'type')
      if (isTypeOnly) return null

      // Skip well-known namespace imports that are idiomatic
      const source = node.namedChildren.find((c) => c.type === 'string')
      const sourceText = source?.text?.slice(1, -1) ?? ''
      if (sourceText === 'react' || sourceText === 'react-dom'
        || sourceText.startsWith('@radix-ui/') || sourceText.startsWith('@headlessui/')) {
        return null
      }
      // Skip chart/UI/3D libraries where namespace imports are idiomatic
      const namespaceLibs = ['recharts', 'd3', 'three', 'pixi.js', '@pixi/', 'pixi']
      if (namespaceLibs.some((lib) => sourceText === lib || sourceText.startsWith(lib + '/') || sourceText.startsWith(lib + '-'))) {
        return null
      }
      // Skip libraries whose API is designed around a namespace alias:
      //   - `zod` is built for `import * as z from 'zod'` → `z.object(...)`.
      //   - `@react-email/*` and `fumadocs-ui/components/*` expose many
      //     individually-imported components that read more cleanly under
      //     a single namespace alias.
      if (sourceText === 'zod'
        || sourceText.startsWith('@react-email/')
        || sourceText.startsWith('fumadocs-ui/')
        || sourceText.startsWith('fumadocs-core/')) {
        return null
      }
      // Relative imports (./foo, ../bar) — namespace imports for local modules are a valid pattern
      if (sourceText.startsWith('./') || sourceText.startsWith('../')) return null

      // Skip when the namespace is used as a JSX component prefix (e.g., <Recharts.LineChart>)
      const nsImport = node.namedChildren.find((c) => c.type === 'import_clause')
        ?.namedChildren.find((cc) => cc.type === 'namespace_import')
      const nsName = nsImport?.namedChildren.find((c) => c.type === 'identifier')?.text
      if (nsName) {
        const root = node.tree.rootNode
        const jsxPattern = nsName + '.'
        if (root.text.includes('<' + jsxPattern)) return null

        // Skip when the namespace is referenced many times — the alias is
        // load-bearing and collapsing it into named imports would just
        // produce a sprawling import list.
        const escaped = nsName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const matches = root.text.match(new RegExp(`\\b${escaped}\\.`, 'g'))
        if (matches && matches.length >= 5) return null
      }

      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Namespace import',
        'import * imports the entire module. Import only what you need for better tree-shaking and clarity.',
        sourceCode,
        'Replace import * with named imports for the specific symbols you use.',
      )
    }
    return null
  },
}
