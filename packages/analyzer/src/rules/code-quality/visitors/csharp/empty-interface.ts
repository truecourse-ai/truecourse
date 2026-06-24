import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * A marker interface with no members and no base interfaces declares no
 * contract. Such interfaces were a pre-attribute idiom for tagging types;
 * modern C# expresses the same intent with a custom attribute, which carries
 * metadata and does not pollute the type's interface list. An interface that
 * composes other interfaces (`interface IFoo : IBar, IBaz {}`) is a legitimate
 * union and is not flagged.
 */
export const csharpEmptyInterfaceVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/empty-interface',
  languages: ['csharp'],
  nodeTypes: ['interface_declaration'],
  visit(node, filePath, sourceCode) {
    if (node.namedChildren.some((c) => c?.type === 'base_list')) return null

    const body = node.childForFieldName('body')
    if (!body || body.type !== 'declaration_list') return null
    if (body.namedChildCount > 0) return null

    const name = node.childForFieldName('name')?.text ?? 'interface'
    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Empty marker interface',
      `Interface \`${name}\` has no members and adds no contract; a custom attribute is the modern way to tag types.`,
      sourceCode,
      'Replace the marker interface with a custom attribute, or give the interface members.',
    )
  },
}
