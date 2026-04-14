import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonImportPrivateNameVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/import-private-name',
  languages: ['python'],
  nodeTypes: ['import_from_statement'],
  visit(node, filePath, sourceCode) {
    // from module import _private_name
    const names = node.namedChildren.filter((c) =>
      c.type === 'dotted_name' || c.type === 'identifier' || c.type === 'aliased_import',
    )

    // Skip module name (first child)
    const moduleName = node.childForFieldName('module_name')
    const moduleText = moduleName?.text || ''

    // Check imported names
    for (const child of node.namedChildren) {
      if (child === moduleName) continue
      if (child.type === 'identifier' && child.text.startsWith('_') && !child.text.startsWith('__')) {
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Import of private name',
          `Importing \`${child.text}\` from \`${moduleText}\` — names starting with \`_\` are not part of the public API.`,
          sourceCode,
          'Use only public APIs. If you need this functionality, consider filing an issue with the library maintainers.',
        )
      }
      if (child.type === 'aliased_import') {
        const name = child.childForFieldName('name')
        if (name?.text.startsWith('_') && !name.text.startsWith('__')) {
          return makeViolation(
            this.ruleKey, node, filePath, 'medium',
            'Import of private name',
            `Importing \`${name.text}\` from \`${moduleText}\` — names starting with \`_\` are not part of the public API.`,
            sourceCode,
            'Use only public APIs.',
          )
        }
      }
    }
    return null
  },
}
