import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonImportFormattingVisitor: CodeRuleVisitor = {
  ruleKey: 'style/deterministic/import-formatting',
  languages: ['python'],
  nodeTypes: ['import_statement', 'import_from_statement'],
  visit(node, filePath, sourceCode) {
    const parent = node.parent
    if (!parent || parent.type !== 'module') return null

    let sawNonImport = false
    let isFirstStatement = true
    for (const child of parent.namedChildren) {
      if (child?.id === node.id) {
        if (sawNonImport) {
          return makeViolation(
            this.ruleKey, node, filePath, 'low',
            'Import not at top of file',
            'Import statement found after non-import code. Group all imports at the top of the module.',
            sourceCode,
            'Move this import to the top of the file with the other imports.',
          )
        }
        return null
      }
      if (
        child.type !== 'import_statement' &&
        child.type !== 'import_from_statement' &&
        child.type !== 'future_import_statement' &&
        child.type !== 'comment'
      ) {
        // Allow module docstring (expression_statement with string) as first non-comment
        if (isFirstStatement && child.type === 'expression_statement') {
          const firstChild = child.namedChildren[0]
          if (firstChild?.type === 'string') {
            isFirstStatement = false
            continue
          }
        }
        sawNonImport = true
      }
      isFirstStatement = false
    }

    return null
  },
}
