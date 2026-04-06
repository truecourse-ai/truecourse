import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const importFormattingVisitor: CodeRuleVisitor = {
  ruleKey: 'style/deterministic/import-formatting',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['import_statement'],
  visit(node, filePath, sourceCode) {
    // Check if there's non-import code before this import
    const parent = node.parent
    if (!parent || parent.type !== 'program') return null

    let sawNonImport = false
    for (const child of parent.namedChildren) {
      if (child === node) {
        if (sawNonImport) {
          return makeViolation(
            this.ruleKey, node, filePath, 'low',
            'Import not at top of file',
            'Import statement found after non-import code. Group all imports at the top.',
            sourceCode,
            'Move this import to the top of the file with the other imports.',
          )
        }
        return null
      }
      // Skip comments and type imports
      if (
        child.type !== 'import_statement' &&
        child.type !== 'comment' &&
        child.type !== 'empty_statement'
      ) {
        sawNonImport = true
      }
    }

    return null
  },
}
