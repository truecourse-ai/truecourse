import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const reactReadonlyPropsVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/react-readonly-props',
  languages: ['typescript', 'tsx'],
  nodeTypes: ['interface_declaration', 'type_alias_declaration'],
  visit(node, filePath, sourceCode) {
    // Only flag interfaces/types that look like React props (end in Props, or contain React-like fields)
    const nameNode = node.childForFieldName('name')
    if (!nameNode) return null

    const typeName = nameNode.text
    if (!typeName.endsWith('Props')) return null

    // Check if any property lacks readonly modifier
    const body = node.childForFieldName('body')
    if (!body) return null

    for (const member of body.namedChildren) {
      if (member.type !== 'property_signature') continue

      // Check if 'readonly' keyword is present
      let hasReadonly = false
      for (let i = 0; i < member.childCount; i++) {
        const child = member.child(i)
        if (child?.type === 'readonly') {
          hasReadonly = true
          break
        }
      }

      if (!hasReadonly) {
        const propName = member.childForFieldName('name')
        return makeViolation(
          this.ruleKey, member, filePath, 'low',
          `React prop '${propName?.text ?? 'prop'}' not readonly`,
          `Props type \`${typeName}\` has mutable property \`${propName?.text ?? 'prop'}\` — React props should be declared as \`readonly\`.`,
          sourceCode,
          `Add \`readonly\` modifier to all properties in \`${typeName}\`.`,
        )
      }
    }

    return null
  },
}
