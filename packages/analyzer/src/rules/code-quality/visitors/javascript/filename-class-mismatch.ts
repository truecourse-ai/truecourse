import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const filenameClassMismatchVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/filename-class-mismatch',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['export_statement'],
  visit(node, filePath, sourceCode) {
    // Look for: export default class ClassName {}
    // or: export default ClassName; (where ClassName is the default export)
    const isDefault = node.children.some((c) => c.text === 'default')
    if (!isDefault) return null

    // Get the class or identifier being exported
    let exportedName: string | null = null
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (!child) continue
      if (child.type === 'class_declaration') {
        exportedName = child.childForFieldName('name')?.text ?? null
        break
      }
      if (child.type === 'identifier') {
        exportedName = child.text
        break
      }
    }

    if (!exportedName) return null

    // Extract filename without extension
    const fileBase = filePath.split('/').pop()?.replace(/\.[^.]+$/, '') ?? ''
    if (!fileBase) return null

    // Normalize: compare case-insensitively and strip common suffixes
    const normalizeFileName = (s: string) => s.toLowerCase().replace(/[-_.]/g, '')
    const normFile = normalizeFileName(fileBase)
    const normClass = normalizeFileName(exportedName)

    if (normFile && normClass && normFile !== normClass) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Filename/export name mismatch',
        `Default export \`${exportedName}\` does not match filename \`${fileBase}\`. This makes imports confusing.`,
        sourceCode,
        `Rename the file to match the export name, or rename the export to \`${fileBase}\`.`,
      )
    }
    return null
  },
}
