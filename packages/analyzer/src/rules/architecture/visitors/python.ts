/**
 * Architecture domain Python code-level visitors.
 */

import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../types.js'
import { makeViolation } from '../../types.js'

// ---------------------------------------------------------------------------
// duplicate-import — Same module imported multiple times (Python)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// declarations-in-global-scope — Variables declared globally (Python)
// ---------------------------------------------------------------------------

export const pythonDeclarationsInGlobalScopeVisitor: CodeRuleVisitor = {
  ruleKey: 'architecture/deterministic/declarations-in-global-scope',
  languages: ['python'],
  nodeTypes: ['assignment'],
  visit(node, filePath, sourceCode) {
    if (node.parent?.type !== 'module') return null

    const left = node.childForFieldName('left')
    if (!left) return null

    const name = left.text

    // Skip UPPER_CASE constants (intentional module-level constants)
    if (/^[A-Z_][A-Z_0-9]*$/.test(name)) return null

    // Skip __dunder__ variables
    if (name.startsWith('__') && name.endsWith('__')) return null

    // Skip common patterns: logger, app, etc.
    if (['logger', 'log', 'app', 'api', 'router', 'blueprint'].includes(name)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Mutable variable in global scope',
      `Module-level mutable variable '${name}' creates shared state that is hard to test.`,
      sourceCode,
      'Move into a function, class, or use UPPER_CASE for intended constants.',
    )
  },
}

// ---------------------------------------------------------------------------
// unused-import — Import never referenced (Python)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Export all visitors
// ---------------------------------------------------------------------------

export const ARCHITECTURE_PYTHON_VISITORS: CodeRuleVisitor[] = [
  pythonDuplicateImportVisitor,
  pythonDeclarationsInGlobalScopeVisitor,
  pythonUnusedImportVisitor,
]
