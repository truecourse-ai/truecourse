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
      // Relative imports (./foo, ../bar) — namespace imports for local modules are a valid pattern
      if (sourceText.startsWith('./') || sourceText.startsWith('../')) return null

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
