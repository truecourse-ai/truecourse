import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonStarImportVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/star-import',
  languages: ['python'],
  nodeTypes: ['import_from_statement'],
  visit(node, filePath, sourceCode) {
    const hasWildcard = node.children.some((c) => c.type === 'wildcard_import')
    if (hasWildcard) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Wildcard import',
        'from module import * pollutes the namespace and hides what symbols are actually used.',
        sourceCode,
        'Replace import * with explicit named imports.',
      )
    }
    return null
  },
}
