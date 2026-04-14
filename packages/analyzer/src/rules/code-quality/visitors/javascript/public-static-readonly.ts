import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const publicStaticReadonlyVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/public-static-readonly',
  languages: ['typescript', 'tsx'],
  nodeTypes: ['class_body'],
  visit(node, filePath, sourceCode) {
    for (const member of node.namedChildren) {
      if (member.type !== 'public_field_definition' && member.type !== 'field_definition') continue

      const isStatic = member.children.some((c) => c.type === 'static')
      const isPublic = !member.children.some((c) => c.type === 'accessibility_modifier'
        && (c.text === 'private' || c.text === 'protected'))
      const isReadonly = member.children.some((c) => c.type === 'readonly')

      if (isStatic && isPublic && !isReadonly) {
        const nameNode = member.childForFieldName('name')
        const name = nameNode?.text ?? 'field'
        return makeViolation(
          this.ruleKey, member, filePath, 'medium',
          'Mutable public static field',
          `Public static field \`${name}\` is not \`readonly\`. Static public fields that are constants should be readonly.`,
          sourceCode,
          `Add the \`readonly\` modifier: \`public static readonly ${name}\`.`,
        )
      }
    }
    return null
  },
}
