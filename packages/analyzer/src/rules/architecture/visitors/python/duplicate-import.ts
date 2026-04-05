import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonDuplicateImportVisitor: CodeRuleVisitor = {
  ruleKey: 'architecture/deterministic/duplicate-import',
  languages: ['python'],
  nodeTypes: ['module'],
  visit(node, filePath, sourceCode) {
    const imports = node.namedChildren.filter((c) =>
      c.type === 'import_statement' || c.type === 'import_from_statement',
    )

    const moduleMap = new Map<string, SyntaxNode>()

    for (const imp of imports) {
      let moduleName = ''
      if (imp.type === 'import_from_statement') {
        const moduleNode = imp.childForFieldName('module_name')
        if (moduleNode) moduleName = moduleNode.text
      } else {
        const nameNode = imp.namedChildren.find((c) => c.type === 'dotted_name' || c.type === 'aliased_import')
        if (nameNode) moduleName = nameNode.text.split(' ')[0]
      }

      if (!moduleName) continue

      if (moduleMap.has(moduleName)) {
        return makeViolation(
          this.ruleKey, imp, filePath, 'low',
          'Duplicate import',
          `Module '${moduleName}' is imported more than once. Consolidate into a single import.`,
          sourceCode,
          `Merge the imports from '${moduleName}' into a single import statement.`,
        )
      }
      moduleMap.set(moduleName, imp)
    }

    return null
  },
}
