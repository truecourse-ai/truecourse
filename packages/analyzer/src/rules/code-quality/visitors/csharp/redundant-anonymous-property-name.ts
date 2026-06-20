import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * In an anonymous type, a member written `new { Name = x.Name }` repeats the
 * name the compiler would already infer from `x.Name`; the explicit `Name =`
 * is redundant and can be dropped to `new { x.Name }` (S3441). Detected by an
 * `= initializer` whose declared name equals the trailing member of the source
 * member-access. Only the member-access-with-matching-tail case is flagged, so
 * a deliberately renamed member (`{ Total = x.Amount }`) is untouched.
 */
export const csharpRedundantAnonymousPropertyNameVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/redundant-anonymous-property-name',
  languages: ['csharp'],
  nodeTypes: ['anonymous_object_creation_expression'],
  visit(node, filePath, sourceCode) {
    // Children appear as: new { <name> = <member_access> , … }.
    // A redundant member is the run `identifier = member_access_expression`
    // where the identifier equals the member-access tail.
    const children = node.children
    for (let i = 0; i < children.length; i++) {
      const nameTok = children[i]
      const eq = children[i + 1]
      const value = children[i + 2]
      if (!nameTok || nameTok.type !== 'identifier') continue
      if (!eq || eq.text !== '=') continue
      if (!value || value.type !== 'member_access_expression') continue
      const tail = value.childForFieldName('name')?.text
      if (tail && tail === nameTok.text) {
        return report(this.ruleKey, nameTok, filePath, sourceCode)
      }
    }
    return null
  },
}

function report(ruleKey: string, node: SyntaxNode, filePath: string, sourceCode: string) {
  return makeViolation(
    ruleKey, node, filePath, 'low',
    'Redundant anonymous-type property name',
    `\`${node.text} = …${node.text}\` repeats a name the compiler already infers from the source member — drop the explicit \`${node.text} =\` (S3441).`,
    sourceCode,
    'Remove the redundant explicit property name.',
  )
}
