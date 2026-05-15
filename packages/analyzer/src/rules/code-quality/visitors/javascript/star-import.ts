import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Libraries whose canonical API surface is a namespace object.
// `import * as z from 'zod'`, `import * as _superjson from 'superjson'`, etc. —
// the entire namespace IS the documented usage; named imports would defeat the design.
const CANONICAL_NAMESPACE_PACKAGES = new Set<string>([
  'zod',
  'superjson',
  '@react-email/render',
  'react-email',
])

// Packages whose namespace import is the documented / only entry shape.
// Match by exact name or by prefix (for sub-paths like 'pdfjs-dist/legacy/build/pdf.mjs').
const CANONICAL_NAMESPACE_PREFIXES = [
  'pdfjs-dist',
]

export const jsStarImportVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/star-import',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['import_statement'],
  visit(node, filePath, sourceCode) {
    const hasNamespaceImport = node.namedChildren.some(
      (c) => c.type === 'import_clause' && c.namedChildren.some((cc) => cc.type === 'namespace_import')
    )
    if (!hasNamespaceImport) return null

    // Type-only namespace imports (`import type * as Foo from '...'`) — the
    // entire namespace is consumed as type annotations; there's no runtime
    // surface to tree-shake, and named type imports often aren't available.
    // Detect by scanning for the `type` keyword token before the `*` in source.
    const importText = node.text
    if (/^\s*import\s+type\s+\*/.test(importText)) {
      return null
    }

    const source = node.namedChildren.find((c) => c.type === 'string')
    const sourceText = source?.text?.slice(1, -1) ?? ''

    // Skip well-known namespace imports that are idiomatic
    if (sourceText === 'react' || sourceText === 'react-dom'
      || sourceText.startsWith('@radix-ui/') || sourceText.startsWith('@headlessui/')) {
      return null
    }
    // Skip chart/UI/3D libraries where namespace imports are idiomatic
    const namespaceLibs = ['recharts', 'd3', 'three', 'pixi.js', '@pixi/', 'pixi']
    if (namespaceLibs.some((lib) => sourceText === lib || sourceText.startsWith(lib + '/') || sourceText.startsWith(lib + '-'))) {
      return null
    }
    // Node.js built-in modules accessed via the `node:` protocol specifier —
    // `import * as fs from 'node:fs'` is the idiomatic namespace pattern.
    if (sourceText.startsWith('node:')) {
      return null
    }
    // Canonical-namespace packages (zod, superjson, @react-email/render, ...).
    if (CANONICAL_NAMESPACE_PACKAGES.has(sourceText)) {
      return null
    }
    if (CANONICAL_NAMESPACE_PREFIXES.some((p) => sourceText === p || sourceText.startsWith(p + '/'))) {
      return null
    }
    // Relative imports (./foo, ../bar) — namespace imports for local modules are a valid pattern
    if (sourceText.startsWith('./') || sourceText.startsWith('../')) return null

    // Identify the namespace alias name for downstream usage checks.
    const nsImport = node.namedChildren.find((c) => c.type === 'import_clause')
      ?.namedChildren.find((cc) => cc.type === 'namespace_import')
    const nsName = nsImport?.namedChildren.find((c) => c.type === 'identifier')?.text

    if (nsName) {
      const root = node.tree.rootNode
      // Skip when the namespace is used as a JSX component prefix (e.g., <Recharts.LineChart>)
      const jsxPattern = nsName + '.'
      if (root.text.includes('<' + jsxPattern)) return null

      // Skip when the namespace is spread into an object literal (`...nsName`)
      // — the whole namespace surface is required; no named subset is possible.
      const spreadPattern = '...' + nsName
      // Guard against matching a longer identifier like `...nsNameLong`.
      const idx = root.text.indexOf(spreadPattern)
      if (idx >= 0) {
        const after = root.text.charAt(idx + spreadPattern.length)
        if (!/[A-Za-z0-9_$]/.test(after)) return null
      }
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Namespace import',
      'import * imports the entire module. Import only what you need for better tree-shaking and clarity.',
      sourceCode,
      'Replace import * with named imports for the specific symbols you use.',
    )
  },
}
