import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { hasCSharpModifier } from '../../../_shared/csharp-helpers.js'

function isObjectEqualsOverride(member: SyntaxNode): boolean {
  if (member.type !== 'method_declaration') return false
  if (!hasCSharpModifier(member, 'override')) return false
  if (member.childForFieldName('name')?.text !== 'Equals') return false
  const params = member.childForFieldName('parameters')?.namedChildren.filter((c) => c?.type === 'parameter') ?? []
  if (params.length !== 1) return false
  const paramType = params[0]?.namedChildren[0]?.text ?? ''
  return paramType === 'object' || paramType === 'object?' || paramType === 'Object' || paramType === 'System.Object'
}

function isGetHashCodeOverride(member: SyntaxNode): boolean {
  if (member.type !== 'method_declaration') return false
  if (!hasCSharpModifier(member, 'override')) return false
  if (member.childForFieldName('name')?.text !== 'GetHashCode') return false
  const params = member.childForFieldName('parameters')?.namedChildren.filter((c) => c?.type === 'parameter') ?? []
  return params.length === 0
}

/**
 * `override Equals(object)` without `override GetHashCode()` — instances
 * misbehave in Dictionary/HashSet (equal objects landing in different
 * buckets). The compiler warns (CS0659) but warnings don't gate review;
 */
export const csharpEqWithoutHashVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/eq-without-hash',
  languages: ['csharp'],
  nodeTypes: ['class_declaration', 'struct_declaration'],
  visit(node, filePath, sourceCode) {
    // The pair may live in another partial-class file.
    if (hasCSharpModifier(node, 'partial')) return null
    const body = node.childForFieldName('body')
    if (!body) return null

    let equalsNode: SyntaxNode | null = null
    let hasHash = false
    for (const member of body.namedChildren) {
      if (!member) continue
      if (isObjectEqualsOverride(member)) equalsNode = member
      if (isGetHashCodeOverride(member)) hasHash = true
    }
    if (!equalsNode || hasHash) return null

    const name = node.childForFieldName('name')?.text ?? 'type'
    return makeViolation(
      this.ruleKey, equalsNode, filePath, 'medium',
      'Equals without GetHashCode',
      `\`${name}\` overrides \`Equals\` but not \`GetHashCode\` — equal instances can hash differently, breaking Dictionary/HashSet lookups (CS0659).`,
      sourceCode,
      'Override GetHashCode consistently with Equals, e.g. `public override int GetHashCode() => HashCode.Combine(…the fields Equals compares…);`.',
    )
  },
}
