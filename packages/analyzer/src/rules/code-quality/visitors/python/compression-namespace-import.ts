import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Legacy compression module names that should now be imported from compression namespace (Python 3.14+)
const LEGACY_COMPRESSION_MODULES = new Set([
  'bz2', 'gzip', 'lzma', 'zipfile', 'zlib', 'tarfile',
])

/**
 * Detects imports of legacy compression modules that should use the
 * new compression namespace in Python 3.14+.
 */
export const pythonCompressionNamespaceImportVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/compression-namespace-import',
  languages: ['python'],
  nodeTypes: ['import_statement', 'import_from_statement'],
  visit(node, filePath, sourceCode) {
    if (node.type === 'import_statement') {
      const names = node.namedChildren
      for (const n of names) {
        const moduleName = n.text.split('.')[0]
        if (LEGACY_COMPRESSION_MODULES.has(moduleName)) {
          return makeViolation(
            this.ruleKey, node, filePath, 'low',
            'Legacy compression module import',
            `\`import ${moduleName}\` — Python 3.14+ provides a unified \`compression\` namespace. Prefer \`from compression import ${moduleName}\`.`,
            sourceCode,
            `Update to \`from compression import ${moduleName}\` for Python 3.14+ compatibility.`,
          )
        }
      }
    }

    if (node.type === 'import_from_statement') {
      const moduleNode = node.childForFieldName('module_name')
      if (!moduleNode) return null
      const moduleName = moduleNode.text.split('.')[0]
      if (LEGACY_COMPRESSION_MODULES.has(moduleName)) {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Legacy compression module import',
          `\`from ${moduleName} import ...\` — Python 3.14+ provides a unified \`compression\` namespace. Prefer \`from compression.${moduleName} import ...\`.`,
          sourceCode,
          `Update to \`from compression.${moduleName} import ...\` for Python 3.14+ compatibility.`,
        )
      }
    }

    return null
  },
}
