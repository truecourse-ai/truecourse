import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects imports inside TYPE_CHECKING blocks that are used at runtime.
 * If an import is in `if TYPE_CHECKING:` but the name is referenced outside
 * of annotations (e.g., used in isinstance, as a base class, in function body),
 * it will cause a NameError at runtime.
 */
export const pythonRuntimeImportInTypeCheckingVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/runtime-import-in-type-checking',
  languages: ['python'],
  nodeTypes: ['if_statement'],
  visit(node, filePath, sourceCode) {
    // Check if this is `if TYPE_CHECKING:`
    const condition = node.childForFieldName('condition')
    if (!condition) return null
    if (condition.text !== 'TYPE_CHECKING') return null

    // Get the imports inside this block
    const consequence = node.childForFieldName('consequence')
    if (!consequence) return null

    const importedNames = new Set<string>()
    collectImportedNames(consequence, importedNames)

    if (importedNames.size === 0) return null

    // Now check the rest of the file for runtime usage of these names
    // (outside of type annotations and TYPE_CHECKING blocks)
    const rootNode = node.parent
    if (!rootNode) return null

    for (const name of importedNames) {
      if (isUsedAtRuntime(rootNode, name, node)) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Runtime import in TYPE_CHECKING block',
          `'${name}' is imported inside TYPE_CHECKING but used at runtime — will cause NameError.`,
          sourceCode,
          `Move the import of '${name}' outside the TYPE_CHECKING block or guard the runtime usage.`,
        )
      }
    }

    return null
  },
}

function collectImportedNames(node: SyntaxNode, names: Set<string>): void {
  if (node.type === 'import_from_statement' || node.type === 'import_statement') {
    for (const child of node.namedChildren) {
      if (child.type === 'dotted_name' || child.type === 'aliased_import') {
        const alias = child.childForFieldName('alias')
        if (alias) {
          names.add(alias.text)
        } else {
          const parts = child.text.split('.')
          names.add(parts[parts.length - 1])
        }
      }
    }
    return
  }
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (child) collectImportedNames(child, names)
  }
}

function isUsedAtRuntime(root: SyntaxNode, name: string, typeCheckingNode: SyntaxNode): boolean {
  // Look for runtime usage patterns: isinstance(x, Name), issubclass, as base class,
  // function calls, variable usage outside annotations
  const runtimePatterns = [
    `isinstance(`, `issubclass(`,
  ]

  // Simple heuristic: check if name appears in isinstance/issubclass calls
  const text = root.text
  for (const pattern of runtimePatterns) {
    const regex = new RegExp(`${pattern.replace('(', '\\(')}[^)]*\\b${name}\\b`)
    if (regex.test(text)) {
      return true
    }
  }

  // Check if used as a base class
  const baseClassRegex = new RegExp(`class\\s+\\w+\\([^)]*\\b${name}\\b`)
  if (baseClassRegex.test(text)) {
    return true
  }

  return false
}
