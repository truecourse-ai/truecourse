import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpAttributeNames } from '../../../_shared/csharp-helpers.js'

/**
 * A custom attribute type (one whose name ends in `Attribute` and which derives
 * from a base whose name ends in `Attribute`) should carry its own
 * `[AttributeUsage(...)]` declaration. Without it the valid targets default to
 * `All` and the attribute can be applied — and repeated — anywhere, which is
 * almost never intended. Abstract base attributes are skipped since concrete
 * subclasses inherit the usage.
 */

function derivesFromAttribute(node: SyntaxNode): boolean {
  const baseList = node.namedChildren.find((c) => c?.type === 'base_list')
  if (!baseList) return false
  return baseList.namedChildren.some((b) => {
    const name = (b?.text ?? '').split('.').pop() ?? ''
    return name === 'Attribute' || name.endsWith('Attribute')
  })
}

export const csharpAttributeMissingUsageVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/attribute-missing-usage',
  languages: ['csharp'],
  nodeTypes: ['class_declaration'],
  visit(node, filePath, sourceCode) {
    const name = node.childForFieldName('name')?.text ?? ''
    if (!name.endsWith('Attribute')) return null
    if (!derivesFromAttribute(node)) return null

    const attrs = getCSharpAttributeNames(node)
    if (attrs.includes('AttributeUsage')) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Custom attribute without [AttributeUsage]',
      `Attribute \`${name}\` declares no \`[AttributeUsage]\`, so its valid targets and multiplicity are unconstrained.`,
      sourceCode,
      'Add an `[AttributeUsage(AttributeTargets.…)]` declaration specifying the valid targets and whether the attribute may be applied more than once.',
    )
  },
}
