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
