import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * An enum that mixes explicit and implicit member values — some members carry an
 * `= value`, others rely on their position. The implicit members take whatever
 * number follows the last explicit one, so inserting or reordering a member
 * silently renumbers them. When the enum is persisted or sent over the wire that
 * shifts the contract under existing data. A fully-implicit enum (every member
 * bare) is the ordinary case and is NOT flagged; only the mixed form, where the
 * intent is genuinely ambiguous, is reported.
 */
export const csharpEnumImplicitValuesVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/enum-implicit-values',
  languages: ['csharp'],
  nodeTypes: ['enum_declaration'],
  visit(node, filePath, sourceCode) {
    const body = node.namedChildren.find((c) => c?.type === 'enum_member_declaration_list')
    if (!body) return null

    const members = body.namedChildren.filter((c): c is SyntaxNode => c?.type === 'enum_member_declaration')
    if (members.length < 2) return null

    let explicit = 0
    let implicit = 0
    for (const m of members) {
      if (m.children.some((c) => c?.type === '=')) explicit++
      else implicit++
    }
    if (explicit === 0 || implicit === 0) return null

    const name = node.childForFieldName('name')
    const target = name ?? node
    return makeViolation(
      this.ruleKey, target, filePath, 'medium',
      'Enum mixes explicit and implicit values',
      `Enum '${name?.text ?? ''}' mixes explicit and implicit member values — the implicit members renumber if a member is inserted or reordered. Give every member an explicit value to pin the contract.`,
      sourceCode,
      'Declare an explicit value for every enum member.',
    )
  },
}
