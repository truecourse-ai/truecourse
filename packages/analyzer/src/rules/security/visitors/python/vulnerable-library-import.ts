import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const VULNERABLE_MODULES = new Set(['httpoxy', 'pyghmi', 'pycrypto', 'telnetlib'])

export const pythonVulnerableLibraryImportVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/vulnerable-library-import',
  languages: ['python'],
  nodeTypes: ['import_statement', 'import_from_statement'],
  visit(node, filePath, sourceCode) {
    // import httpoxy / from httpoxy import ...
    for (const child of node.namedChildren) {
      if (child.type === 'dotted_name' || child.type === 'aliased_import') {
        const name = child.type === 'aliased_import' ? child.namedChildren[0]?.text : child.text
        if (name && VULNERABLE_MODULES.has(name)) {
          return makeViolation(
            this.ruleKey, node, filePath, 'high',
            'Vulnerable library import',
            `Importing "${name}" which has known security vulnerabilities.`,
            sourceCode,
            `Replace "${name}" with a maintained, secure alternative.`,
          )
        }
      }
    }

    return null
  },
}
