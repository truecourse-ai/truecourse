import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const barrelFileReExportAllVisitor: CodeRuleVisitor = {
  ruleKey: 'architecture/deterministic/barrel-file-re-export-all',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['export_statement'],
  visit(node, filePath, sourceCode) {
    // Only check index files
    const lowerPath = filePath.toLowerCase()
    if (!lowerPath.endsWith('/index.ts') && !lowerPath.endsWith('/index.js') && !lowerPath.endsWith('/index.tsx')) {
      return null
    }

    // Look for export * from '...'
    const text = node.text
    if (text.startsWith('export *') && text.includes('from')) {
      // Count how many export * statements in this file
      const program = node.parent
      if (!program) return null

      const reExportCount = program.namedChildren.filter((c) =>
        c.type === 'export_statement' && c.text.startsWith('export *'),
      ).length

      if (reExportCount > 5) {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Barrel file with many re-exports',
          `index file has ${reExportCount} 'export *' statements. Barrel files can slow down bundlers and TypeScript.`,
          sourceCode,
          'Use named re-exports or import directly from the source module.',
        )
      }
    }

    return null
  },
}
