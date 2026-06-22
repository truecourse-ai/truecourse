import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { hasCSharpModifier } from '../../../_shared/csharp-helpers.js'

/**
 * A concrete custom attribute that is not `sealed` forces every attribute
 * lookup to walk a (usually pointless) inheritance hierarchy, and attributes
 * are very rarely meant to be subclassed. Sealing them is the convention. The
 * check fires on a non-abstract `class_declaration` that derives directly from
 * a base whose name ends in `Attribute` and lacks the `sealed` modifier.
 */

function derivesFromAttribute(node: SyntaxNode): boolean {
  const baseList = node.namedChildren.find((c) => c?.type === 'base_list')
  if (!baseList) return false
  return baseList.namedChildren.some((b) => {
    const name = (b?.text ?? '').split('<')[0].split('.').pop() ?? ''
    return name === 'Attribute' || name.endsWith('Attribute')
  })
}

export const csharpUnsealedAttributeVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unsealed-attribute',
  languages: ['csharp'],
  nodeTypes: ['class_declaration'],
  visit(node, filePath, sourceCode) {
    if (hasCSharpModifier(node, 'sealed')) return null
    if (hasCSharpModifier(node, 'abstract')) return null
    if (hasCSharpModifier(node, 'static')) return null
    if (!derivesFromAttribute(node)) return null

    const name = node.childForFieldName('name')?.text ?? 'attribute'
    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Unsealed attribute class',
      `Attribute \`${name}\` is not \`sealed\`, so attribute lookups walk its inheritance hierarchy unnecessarily.`,
      sourceCode,
      'Mark the attribute class `sealed`.',
    )
  },
}
