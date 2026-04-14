import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Extract imported symbol names from an import statement.
 *
 * - `import foo`                     → ['foo']
 * - `import foo as bar`              → ['foo']
 * - `from foo import bar`            → ['bar']
 * - `from foo import bar, baz`       → ['bar', 'baz']
 * - `from foo import bar as b`       → ['bar']
 * - `from foo import *`              → ['*']
 */
function getImportedNames(imp: SyntaxNode): string[] {
  const names: string[] = []

  if (imp.type === 'import_statement') {
    for (const child of imp.namedChildren) {
      if (child.type === 'dotted_name') {
        names.push(child.text)
      } else if (child.type === 'aliased_import') {
        const nameNode = child.childForFieldName('name')
        if (nameNode) names.push(nameNode.text)
      }
    }
  } else if (imp.type === 'import_from_statement') {
    // Collect names after the module: `from X import A, B as C`
    for (const child of imp.namedChildren) {
      if (child.type === 'dotted_name') {
        // The first dotted_name is the module, subsequent ones are imported names
        const moduleNode = imp.childForFieldName('module_name')
        if (moduleNode && child.id === moduleNode.id) continue
        names.push(child.text)
      } else if (child.type === 'aliased_import') {
        const nameNode = child.childForFieldName('name')
        if (nameNode) names.push(nameNode.text)
      } else if (child.type === 'wildcard_import') {
        names.push('*')
      }
    }
  }

  return names
}

export const pythonDuplicateImportVisitor: CodeRuleVisitor = {
  ruleKey: 'architecture/deterministic/duplicate-import',
  languages: ['python'],
  nodeTypes: ['module'],
  visit(node, filePath, sourceCode) {
    const imports = node.namedChildren.filter((c) =>
      c.type === 'import_statement' || c.type === 'import_from_statement',
    )

    // Track every imported NAME (not module) to detect true duplicates.
    // Key: "module::name" for from-imports, "name" for plain imports.
    const seenNames = new Map<string, SyntaxNode>()

    for (const imp of imports) {
      let modulePrefix = ''
      if (imp.type === 'import_from_statement') {
        const moduleNode = imp.childForFieldName('module_name')
        if (moduleNode) modulePrefix = moduleNode.text + '::'
      }

      const names = getImportedNames(imp)
      for (const name of names) {
        const key = modulePrefix + name
        if (seenNames.has(key)) {
          return makeViolation(
            this.ruleKey, imp, filePath, 'low',
            'Duplicate import',
            `'${name}' is imported more than once${modulePrefix ? ` from '${modulePrefix.slice(0, -2)}'` : ''}. Remove the duplicate.`,
            sourceCode,
            'Remove the duplicate import statement.',
          )
        }
        seenNames.set(key, imp)
      }
    }

    return null
  },
}
