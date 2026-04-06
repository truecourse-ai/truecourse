import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonUnusedImportVisitor: CodeRuleVisitor = {
  ruleKey: 'architecture/deterministic/unused-import',
  languages: ['python'],
  nodeTypes: ['import_from_statement'],
  visit(node, filePath, sourceCode) {
    // Skip __init__.py files (re-exports are intentional)
    if (filePath.endsWith('__init__.py')) return null

    // Get imported names
    const names: string[] = []
    for (const child of node.namedChildren) {
      if (child.type === 'dotted_name') {
        names.push(child.text)
      } else if (child.type === 'aliased_import') {
        const alias = child.childForFieldName('alias')
        const name = child.childForFieldName('name')
        names.push(alias?.text ?? name?.text ?? '')
      }
    }

    // Remove the module_name from our list
    const moduleName = node.childForFieldName('module_name')
    if (moduleName) {
      const idx = names.indexOf(moduleName.text)
      if (idx >= 0) names.splice(idx, 1)
    }

    if (names.length === 0) return null

    // Check if names are used in the rest of the file
    const importLineStart = node.startPosition.row
    const importLineEnd = node.endPosition.row
    const lines = sourceCode.split('\n')
    const codeWithoutImport = [
      ...lines.slice(0, importLineStart),
      ...lines.slice(importLineEnd + 1),
    ].join('\n')

    for (const name of names) {
      if (!name) continue
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
