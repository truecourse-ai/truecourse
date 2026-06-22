import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { hasCSharpModifier } from '../../../_shared/csharp-helpers.js'

/**
 * A multidimensional array (`T[,]`) parameter on a public API is awkward to
 * construct and consume from other languages and is rarely the right
 * abstraction. The check fires on a `public` method/constructor whose parameter
 * has a rectangular-array type (`array_rank_specifier` with a comma). Jagged
 * arrays (`T[][]`) are modelled differently and are not flagged.
 */
function isMultidimensionalArray(typeNode: SyntaxNode | null): boolean {
  if (typeNode?.type !== 'array_type') return false
  const rank = typeNode.namedChildren.find((c) => c?.type === 'array_rank_specifier')
  return rank?.text.includes(',') ?? false
}

export const csharpPublicMultidimensionalArrayParamVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/public-multidimensional-array-param',
  languages: ['csharp'],
  nodeTypes: ['method_declaration', 'constructor_declaration'],
  visit(node, filePath, sourceCode) {
    if (!hasCSharpModifier(node, 'public')) return null

    const params = node.childForFieldName('parameters')
    if (!params) return null
    for (const param of params.namedChildren) {
      if (param?.type !== 'parameter') continue
      if (isMultidimensionalArray(param.childForFieldName('type'))) {
        const name = param.childForFieldName('name')?.text ?? 'parameter'
        return makeViolation(
          this.ruleKey, param, filePath, 'low',
          'Public multidimensional array parameter',
          `Public method exposes multidimensional array parameter \`${name}\`, which is awkward to construct and consume.`,
          sourceCode,
          'Accept a collection or a purpose-built type instead of a multidimensional array.',
        )
      }
    }
    return null
  },
}
