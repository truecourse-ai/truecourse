import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// `export {}` is the documented way to force a file to be parsed as an ES
// module rather than a global script. That matters for:
//   - bare barrel files with no actual exports
//   - polyfills / `declare global { ... }` augmentations (need to be modules
//     for the augmentation to apply)
//   - any file lacking another import/export
// Only flag when the file already contains other top-level imports or
// exports — in those cases the empty `export {}` is genuinely redundant.
function fileHasOtherTopLevelModuleStatement(emptyExport: SyntaxNode): boolean {
  let program: SyntaxNode | null = emptyExport
  while (program && program.type !== 'program') program = program.parent
  if (!program) return false
  for (const child of program.namedChildren) {
    if (child.id === emptyExport.id) continue
    if (child.type === 'import_statement') return true
    if (child.type === 'export_statement') {
      // Another export_statement counts — but ignore if it's another empty
      // export (the file would still need at least one to be a module).
      const inner = child.namedChildren.find((c) => c.type === 'named_exports' || c.type === 'export_clause')
      if (!inner || inner.namedChildCount > 0) return true
      // It's another empty export — keep scanning.
    }
  }
  return false
}

export const uselessEmptyExportVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/useless-empty-export',
  languages: ['typescript', 'tsx'],
  nodeTypes: ['export_statement'],
  visit(node, filePath, sourceCode) {
    const namedExports = node.namedChildren.find((c) => c.type === 'named_exports' || c.type === 'export_clause')
    if (!namedExports) return null
    if (namedExports.namedChildCount !== 0) return null

    // Bare-barrel / global-augmentation / polyfill files need the marker.
    if (!fileHasOtherTopLevelModuleStatement(node)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Useless empty export',
      '`export {}` does nothing useful. Remove it unless it is needed to mark the file as a module.',
      sourceCode,
      'Remove the empty `export {}` statement.',
    )
  },
}
