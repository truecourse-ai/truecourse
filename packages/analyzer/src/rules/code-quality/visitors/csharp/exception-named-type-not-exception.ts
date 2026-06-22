import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * A type whose name ends in `Exception` reads, at every `catch` and `throw`
 * site, as an exception type. One that does not derive (transitively, by the
 * naming convention) from `Exception` breaks that expectation — it cannot be
 * thrown or caught as an exception. The check is name-based: the base list must
 * contain a type whose own name ends in `Exception`; an empty base list (the
 * type derives only from `object`) is a violation.
 */

function baseTypeNames(node: SyntaxNode): string[] {
  const baseList = node.namedChildren.find((c) => c?.type === 'base_list')
  if (!baseList) return []
  return baseList.namedChildren
    .filter(Boolean)
    .map((b) => (b!.text.split('<')[0].split('.').pop() ?? '').trim())
}

export const csharpExceptionNamedTypeNotExceptionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/exception-named-type-not-exception',
  languages: ['csharp'],
  nodeTypes: ['class_declaration'],
  visit(node, filePath, sourceCode) {
    const name = node.childForFieldName('name')?.text
    if (!name || !name.endsWith('Exception')) return null
    // `Exception` itself is the framework base, not a user type.
    if (name === 'Exception') return null

    const bases = baseTypeNames(node)
    if (bases.some((b) => b.endsWith('Exception'))) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Exception-named type does not extend Exception',
      `Type \`${name}\` is named like an exception but does not derive from an \`Exception\` type, so it cannot be thrown or caught as one — readers will be misled.`,
      sourceCode,
      'Either derive the type from `Exception` (e.g. `Exception` or `ApplicationException`), or rename it so it does not end in `Exception`.',
    )
  },
}
