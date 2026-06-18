import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Duplicate `using` directives in one file. The key includes the directive
 * form — `using X`, `global using X`, `using static X`, and `using A = X`
 * are different declarations and only clash with their own kind.
 */
function usingKey(directive: SyntaxNode): string | null {
  let target: string | null = null
  let alias = ''
  const aliasNode = directive.childForFieldName('name')
  for (const child of directive.namedChildren) {
    if (!child) continue
    if (aliasNode && child.id === aliasNode.id) {
      alias = child.text
      continue
    }
    if (child.type === 'qualified_name' || child.type === 'identifier' || child.type === 'generic_name') {
      target = child.text
      break
    }
  }
  if (!target) return null

  const isStatic = directive.children.some((c) => c?.type === 'static')
  const isGlobal = directive.children.some((c) => c?.type === 'global')
  return `${isGlobal ? 'global ' : ''}${isStatic ? 'static ' : ''}${alias ? alias + '=' : ''}${target}`
}

export const csharpDuplicateImportVisitor: CodeRuleVisitor = {
  ruleKey: 'architecture/deterministic/duplicate-import',
  languages: ['csharp'],
  nodeTypes: ['compilation_unit'],
  visit(node, filePath, sourceCode) {
    // Collect usings per scope (file level and each block namespace) — the
    // same directive in two different namespaces is legal and meaningful.
    const seenByScope = new Map<number, Set<string>>()

    let duplicate: { node: SyntaxNode; key: string } | null = null

    function walk(scope: SyntaxNode) {
      for (const child of scope.namedChildren) {
        if (!child || duplicate) return
        if (child.type === 'using_directive') {
          const key = usingKey(child)
          if (!key) continue
          if (!seenByScope.has(scope.id)) seenByScope.set(scope.id, new Set())
          const seen = seenByScope.get(scope.id)!
          if (seen.has(key)) {
            duplicate = { node: child, key }
            return
          }
          seen.add(key)
        } else if (child.type === 'namespace_declaration') {
          const declList = child.namedChildren.find((c) => c?.type === 'declaration_list')
          if (declList) walk(declList)
        }
      }
    }

    walk(node)
    if (!duplicate) return null

    const { node: dupNode, key } = duplicate as { node: SyntaxNode; key: string }
    return makeViolation(
      this.ruleKey, dupNode, filePath, 'low',
      'Duplicate import',
      `'using ${key}' appears more than once in this scope. Remove the duplicate.`,
      sourceCode,
      'Remove the duplicate using directive.',
    )
  },
}
