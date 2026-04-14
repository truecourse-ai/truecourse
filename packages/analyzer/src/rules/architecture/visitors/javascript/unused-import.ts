import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const unusedImportVisitor: CodeRuleVisitor = {
  ruleKey: 'architecture/deterministic/unused-import',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['import_statement'],
  visit(node, filePath, sourceCode) {
    // Skip type-only imports (used for TS type checking only)
    if (node.text.includes('import type')) return null

    const importClause = node.namedChildren.find((c) => c.type === 'import_clause')
    if (!importClause) return null

    // Get all imported names
    const names: string[] = []

    for (const child of importClause.namedChildren) {
      if (child.type === 'identifier') {
        names.push(child.text)
      } else if (child.type === 'named_imports') {
        for (const spec of child.namedChildren) {
          if (spec.type === 'import_specifier') {
            const alias = spec.childForFieldName('alias')
            const name = alias ?? spec.childForFieldName('name')
            if (name) names.push(name.text)
          }
        }
      } else if (child.type === 'namespace_import') {
        const name = child.namedChildren.find((c) => c.type === 'identifier')
        if (name) names.push(name.text)
      }
    }

    // Check if each imported name appears elsewhere in the file
    // Remove the import line itself from the search
    const importLineStart = node.startPosition.row
    const importLineEnd = node.endPosition.row
    const lines = sourceCode.split('\n')
    const codeWithoutImport = [
      ...lines.slice(0, importLineStart),
      ...lines.slice(importLineEnd + 1),
    ].join('\n')

    for (const name of names) {
      // Check if name appears in the rest of the code (as a word boundary)
      const regex = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)
      if (!regex.test(codeWithoutImport)) {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          `Unused import: ${name}`,
          `Imported '${name}' is not referenced anywhere in the file.`,
          sourceCode,
          `Remove the unused import of '${name}'.`,
        )
      }
    }

    return null
  },
}
