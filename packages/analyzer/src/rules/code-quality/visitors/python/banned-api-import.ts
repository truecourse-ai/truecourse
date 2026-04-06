import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects banned/dangerous API imports in Python.
 * Flags imports of known problematic modules or specific APIs.
 */
const BANNED_IMPORTS: Array<{ module: string; name?: string; reason: string }> = [
  { module: 'pickle', reason: 'pickle is unsafe for untrusted data — arbitrary code execution risk' },
  { module: 'cPickle', reason: 'cPickle is unsafe for untrusted data — arbitrary code execution risk' },
  { module: 'shelve', reason: 'shelve uses pickle internally — unsafe for untrusted data' },
  { module: 'marshal', reason: 'marshal is not safe for untrusted data' },
  { module: 'telnetlib', reason: 'telnetlib transmits data in plaintext — use SSH instead' },
  { module: 'ftplib', reason: 'FTP transmits credentials in plaintext — use SFTP instead' },
  { module: 'xml.etree.ElementTree', name: 'parse', reason: 'xml.etree.ElementTree is vulnerable to XML bombs — use defusedxml' },
  { module: 'xml.dom.minidom', reason: 'xml.dom.minidom is vulnerable to XML attacks — use defusedxml' },
  { module: 'xml.sax', reason: 'xml.sax is vulnerable to XML attacks — use defusedxml' },
]

export const pythonBannedApiImportVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/banned-api-import',
  languages: ['python'],
  nodeTypes: ['import_statement', 'import_from_statement'],
  visit(node, filePath, sourceCode) {
    if (node.type === 'import_statement') {
      // import pickle
      for (const child of node.namedChildren) {
        const moduleName = child.type === 'aliased_import'
          ? child.namedChildren[0]?.text
          : child.text
        if (!moduleName) continue

        const banned = BANNED_IMPORTS.find((b) => !b.name && moduleName === b.module)
        if (banned) {
          return makeViolation(
            this.ruleKey, node, filePath, 'low',
            'Banned API import',
            `Import of '${moduleName}' — ${banned.reason}.`,
            sourceCode,
            'Use a safer alternative.',
          )
        }
      }
    }

    if (node.type === 'import_from_statement') {
      // from module import name
      const moduleNode = node.childForFieldName('module_name')
      if (!moduleNode) return null
      const moduleName = moduleNode.text

      // Check for full module ban
      const moduleBan = BANNED_IMPORTS.find((b) => !b.name && moduleName === b.module)
      if (moduleBan) {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Banned API import',
          `Import from '${moduleName}' — ${moduleBan.reason}.`,
          sourceCode,
          'Use a safer alternative.',
        )
      }

      // Check for specific name bans
      for (const child of node.namedChildren) {
        if (child.type !== 'dotted_name' && child.type !== 'aliased_import') continue
        const importedName = child.type === 'aliased_import'
          ? child.namedChildren[0]?.text
          : child.text
        if (!importedName) continue

        const nameBan = BANNED_IMPORTS.find(
          (b) => b.name && b.module === moduleName && b.name === importedName,
        )
        if (nameBan) {
          return makeViolation(
            this.ruleKey, node, filePath, 'low',
            'Banned API import',
            `Import of '${importedName}' from '${moduleName}' — ${nameBan.reason}.`,
            sourceCode,
            'Use a safer alternative.',
          )
        }
      }
    }

    return null
  },
}
