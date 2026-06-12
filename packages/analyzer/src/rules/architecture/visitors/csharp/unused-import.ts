import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpRootNode } from '../../../_shared/csharp-helpers.js'

/**
 * Unused alias usings: `using Fmt = Billing.Common.Money;` where `Fmt` never
 * appears again. Exact — the alias is a referencable name.
 *
 * Plain namespace usings (`using X.Y;`) are NOT checked: deciding whether any
 * type from the namespace is referenced requires the namespace's contents,
 * which only a compiler (or the repo-wide symbol index) knows. That subset is
 * why this rule is `partial` for C#.
 */
function identifierAppearsOutside(root: SyntaxNode, name: string, excludeNode: SyntaxNode): boolean {
  if (root.id === excludeNode.id) return false
  if (root.type === 'identifier' && root.text === name) return true
  for (const child of root.namedChildren) {
    if (child && identifierAppearsOutside(child, name, excludeNode)) return true
  }
  return false
}

export const csharpUnusedImportVisitor: CodeRuleVisitor = {
  ruleKey: 'architecture/deterministic/unused-import',
  languages: ['csharp'],
  nodeTypes: ['using_directive'],
  visit(node, filePath, sourceCode) {
    // Only alias form: the `name` field is the alias
    const aliasNode = node.childForFieldName('name')
    if (!aliasNode) return null
    // `global using` aliases are visible project-wide — file-local search is
    // not sufficient evidence
    if (node.children.some((c) => c?.type === 'global')) return null

    const root = getCSharpRootNode(node)
    if (identifierAppearsOutside(root, aliasNode.text, node)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Unused import',
      `Alias '${aliasNode.text}' is never used in this file. Remove the using directive.`,
      sourceCode,
      'Remove the unused using alias.',
    )
  },
}
