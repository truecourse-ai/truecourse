import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Detects: from x import * at module level
// This hides where names come from and makes it impossible to know what's defined
export const pythonImportStarUndefinedVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/import-star-undefined',
  languages: ['python'],
  nodeTypes: ['import_from_statement'],
  visit(node, filePath, sourceCode) {
    // Check if the import has a wildcard: from x import *
    const hasWildcard = node.namedChildren.some((c) => c.type === 'wildcard_import')

    if (!hasWildcard) return null

    const moduleName = node.childForFieldName('module_name')
    const moduleText = moduleName?.text ?? 'unknown'

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Wildcard import hides names',
      `\`from ${moduleText} import *\` makes it impossible to know which names are defined in this scope — use explicit imports instead.`,
      sourceCode,
      `Replace with explicit imports: \`from ${moduleText} import Name1, Name2\`.`,
    )
  },
}
