import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * A block-form namespace that declares no types is dead structure — usually a
 * leftover after the members it once held were moved or deleted. It adds a
 * level of nesting and a name that resolves to nothing.
 */
export const csharpEmptyNamespaceDeclarationVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/empty-namespace-declaration',
  languages: ['csharp'],
  nodeTypes: ['namespace_declaration'],
  visit(node, filePath, sourceCode) {
    const body = node.childForFieldName('body')
    if (!body || body.type !== 'declaration_list') return null
    if (body.namedChildCount > 0) return null

    const name = node.childForFieldName('name')?.text ?? 'namespace'
    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Empty namespace declaration',
      `Namespace \`${name}\` declares no types — it is dead structure left over after its members were moved or deleted.`,
      sourceCode,
      'Remove the empty namespace declaration.',
    )
  },
}
