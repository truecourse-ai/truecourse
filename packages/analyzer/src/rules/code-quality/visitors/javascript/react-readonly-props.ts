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

    // Skip interfaces that extend other types — base types (e.g. React.HTMLAttributes)
    // are not readonly, so forcing readonly on the extension is inconsistent
    if (node.type === 'interface_declaration') {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i)
        if (child?.type === 'extends_clause' || child?.type === 'extends_type_clause') return null
      }
    }

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
