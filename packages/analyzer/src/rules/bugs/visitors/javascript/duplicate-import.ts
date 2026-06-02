import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const duplicateImportVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/duplicate-import',
  languages: JS_LANGUAGES,
  nodeTypes: ['program'],
  visit(node, filePath, sourceCode) {
    const seenSources = new Map<string, SyntaxNode>()

    for (const child of node.namedChildren) {
      if (child.type === 'import_statement') {
        const source = child.namedChildren.find((c) => c.type === 'string')
        if (source) {
          const src = source.text
          const prev = seenSources.get(src)
          if (prev) {
            // Skip if one is a type-only import and the other is a value import
            // `import type { Foo } from 'x'` + `import { bar } from 'x'` is valid TS
            const prevIsType = prev.text.startsWith('import type ')
            const currIsType = child.text.startsWith('import type ')
            if (prevIsType !== currIsType) continue

            // Side-effect-only (`import 'x'`) paired with a bindings import
            // is intentional — the bare form documents that the module is
            // loaded for its top-level effects. Merging them erases intent.
            if (isSideEffectOnly(prev) !== isSideEffectOnly(child)) continue

            // A namespace binding (`import * as X from 'm'`) cannot be
            // syntactically merged with a sibling named import — the only
            // legal combined forms are `default + named` and
            // `default + namespace`. Skip the pair.
            const prevHasNs = hasNamespaceImport(prev)
            const currHasNs = hasNamespaceImport(child)
            const prevHasNamed = hasNamedImports(prev)
            const currHasNamed = hasNamedImports(child)
            if (
              (prevHasNs && currHasNamed && !currHasNs) ||
              (currHasNs && prevHasNamed && !prevHasNs)
            ) {
              continue
            }

            return makeViolation(
              this.ruleKey, child, filePath, 'medium',
              'Duplicate import',
              `Module ${src} is imported more than once — consolidate into a single import statement.`,
              sourceCode,
              'Merge the duplicate imports into a single import statement.',
            )
          }
          seenSources.set(src, child)
        }
      }
    }

    return null
  },
}

function isSideEffectOnly(imp: SyntaxNode): boolean {
  for (const child of imp.namedChildren) {
    if (child.type === 'import_clause') return false
  }
  return true
}

function hasNamespaceImport(imp: SyntaxNode): boolean {
  const clause = imp.namedChildren.find((c) => c.type === 'import_clause')
  if (!clause) return false
  return clause.namedChildren.some((c) => c.type === 'namespace_import')
}

function hasNamedImports(imp: SyntaxNode): boolean {
  const clause = imp.namedChildren.find((c) => c.type === 'import_clause')
  if (!clause) return false
  return clause.namedChildren.some((c) => c.type === 'named_imports')
}
