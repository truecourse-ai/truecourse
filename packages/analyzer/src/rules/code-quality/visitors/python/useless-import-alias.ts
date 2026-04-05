import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonUselessImportAliasVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/useless-import-alias',
  languages: ['python'],
  nodeTypes: ['import_statement', 'import_from_statement'],
  visit(node, filePath, sourceCode) {
    // Look for aliased_import nodes where alias == original name
    for (const child of node.namedChildren) {
      if (child.type === 'aliased_import') {
        const name = child.namedChildren[0]
        const alias = child.namedChildren[1]
        if (name && alias) {
          // The original name is the last component (e.g., 'os' from 'import os.path as path' — don't flag)
          // Simple case: import x as x
          const originalName = name.text.split('.').pop() ?? name.text
          if (alias.text === originalName) {
            return makeViolation(
              this.ruleKey, child, filePath, 'low',
              'Useless import alias',
              `\`import ${name.text} as ${alias.text}\` aliases the module to the same name. The alias has no effect.`,
              sourceCode,
              `Replace \`import ${name.text} as ${alias.text}\` with \`import ${name.text}\`.`,
            )
          }
        }
      }
    }

    return null
  },
}
