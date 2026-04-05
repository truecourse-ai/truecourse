import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const uselessEmptyExportVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/useless-empty-export',
  languages: ['typescript', 'tsx'],
  nodeTypes: ['export_statement'],
  visit(node, filePath, sourceCode) {
    const namedExports = node.namedChildren.find((c) => c.type === 'named_exports' || c.type === 'export_clause')
    if (!namedExports) return null

    if (namedExports.namedChildCount === 0) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Useless empty export',
        '`export {}` does nothing useful. Remove it unless it is needed to mark the file as a module.',
        sourceCode,
        'Remove the empty `export {}` statement.',
      )
    }
    return null
  },
}
