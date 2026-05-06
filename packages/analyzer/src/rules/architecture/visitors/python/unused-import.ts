import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getPythonModuleNode } from '../../../_shared/python-helpers.js'

/**
 * Walk the AST rooted at `root` looking for an `identifier` node with
 * the given `name` that is NOT a descendant of `excludeNode`.
 */
function hasIdentifierOutside(root: SyntaxNode, name: string, excludeNode: SyntaxNode): boolean {
  if (root.id === excludeNode.id) return false
  if (root.type === 'identifier' && root.text === name) return true
  for (const child of root.namedChildren) {
    if (hasIdentifierOutside(child, name, excludeNode)) return true
  }
  return false
}

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

    // Skip imports with a `# noqa` comment on the same line — these are
    // intentional side-effect imports (e.g., importing a module to register
    // event handlers, signal receivers, or plugins).
    const importLine = sourceCode.split('\n')[node.startPosition.row] ?? ''
    if (/# *noqa\b/.test(importLine)) return null

    // Skip imports inside an `if TYPE_CHECKING:` block — those are
    // referenced only in string annotations (`def f(x: "MyType") → …`)
    // or in forward-reference type hints, which our identifier walk
    // can't see.
    let p = node.parent
    while (p) {
      if (p.type === 'if_statement') {
        const cond = p.childForFieldName('condition')
        if (cond && /TYPE_CHECKING/.test(cond.text)) return null
      }
      p = p.parent
    }

    // Check if names are used in the rest of the file via AST walk
    const moduleNode = getPythonModuleNode(node)

    // Forward-reference names are referenced inside string annotations
    // (`x: "MyClass"`, `Callable[..., "Result"]`). Build a regex that
    // also catches such references.
    function nameReferencedInStrings(root: SyntaxNode, name: string): boolean {
      if (root.type === 'string') {
        if (new RegExp(`\\b${name}\\b`).test(root.text)) return true
      }
      for (const child of root.namedChildren) {
        if (nameReferencedInStrings(child, name)) return true
      }
      return false
    }

    for (const name of names) {
      if (!name) continue
      if (!hasIdentifierOutside(moduleNode, name, node) && !nameReferencedInStrings(moduleNode, name)) {
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
