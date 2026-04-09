import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects imports used only in type annotations that should be inside
 * TYPE_CHECKING block to reduce runtime overhead.
 * Checks if an imported name only appears in type annotation contexts.
 */
export const pythonTypingOnlyImportVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/typing-only-import',
  languages: ['python'],
  nodeTypes: ['import_from_statement'],
  visit(node, filePath, sourceCode) {
    // Skip imports already inside TYPE_CHECKING blocks
    if (isInsideTypeCheckingBlock(node)) return null

    // Get imported names
    const importedNames: Array<{ name: string; alias: string }> = []
    for (const child of node.namedChildren) {
      if (child.type === 'dotted_name') {
        const text = child.text
        const parts = text.split('.')
        importedNames.push({ name: text, alias: parts[parts.length - 1] })
      } else if (child.type === 'aliased_import') {
        const nameNode = child.namedChildren[0]
        const aliasNode = child.childForFieldName('alias')
        if (nameNode) {
          importedNames.push({
            name: nameNode.text,
            alias: aliasNode ? aliasNode.text : nameNode.text,
          })
        }
      }
    }

    if (importedNames.length === 0) return null

    const root = findRoot(node)

    for (const { alias } of importedNames) {
      // Check if name is only used in annotations
      const usages = findUsages(root, alias, node)
      if (usages.total === 0) continue // unused — different rule
      if (usages.annotationOnly) {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Import used only for type checking',
          `'${alias}' is imported at runtime but only used in type annotations — move to TYPE_CHECKING block to reduce import overhead.`,
          sourceCode,
          `Move the import of '${alias}' inside an 'if TYPE_CHECKING:' block.`,
        )
      }
    }

    return null
  },
}

function isInsideTypeCheckingBlock(node: SyntaxNode): boolean {
  let current = node.parent
  while (current) {
    if (current.type === 'if_statement') {
      const cond = current.childForFieldName('condition')
      if (cond && cond.text === 'TYPE_CHECKING') return true
    }
    current = current.parent
  }
  return false
}

function findRoot(node: SyntaxNode): SyntaxNode {
  let current = node
  while (current.parent) current = current.parent
  return current
}

interface UsageInfo {
  total: number
  annotationOnly: boolean
}

function findUsages(root: SyntaxNode, name: string, importNode: SyntaxNode): UsageInfo {
  let totalUses = 0
  let runtimeUses = 0

  function walk(node: SyntaxNode): void {
    if (node === importNode) return
    if (node.type === 'import_from_statement' || node.type === 'import_statement') return

    if (node.type === 'identifier' && node.text === name) {
      totalUses++
      // Check if in type annotation context
      if (!isInAnnotation(node)) {
        runtimeUses++
      }
      return
    }

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (child) walk(child)
    }
  }

  walk(root)
  return { total: totalUses, annotationOnly: totalUses > 0 && runtimeUses === 0 }
}

function isInAnnotation(node: SyntaxNode): boolean {
  let current = node.parent
  while (current) {
    if (current.type === 'type') return true
    // Function return type annotation
    if (current.type === 'function_definition' && current.childForFieldName('return_type')?.id === node.id) return true
    current = current.parent
  }
  return false
}
