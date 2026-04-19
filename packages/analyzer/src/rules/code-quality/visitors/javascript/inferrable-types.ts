import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const PRIMITIVE_TYPES = new Set(['number', 'string', 'boolean'])

const LITERAL_TO_TYPE: Record<string, string> = {
  number: 'number',
  string: 'string',
  template_string: 'string',
  true: 'boolean',
  false: 'boolean',
}

function getLiteralType(node: import('web-tree-sitter').Node): string | null {
  if (LITERAL_TO_TYPE[node.type]) return LITERAL_TO_TYPE[node.type]
  if (node.type === 'identifier' && (node.text === 'true' || node.text === 'false')) return 'boolean'
  return null
}

export const inferrableTypesVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/inferrable-types',
  languages: ['typescript', 'tsx'],
  nodeTypes: ['variable_declarator'],
  visit(node, filePath, sourceCode) {
    // const x: string = "hello" → type is inferrable
    const nameNode = node.childForFieldName('name')
    if (!nameNode) return null

    // The type annotation is a child of the name pattern in TS: name: type
    // In tree-sitter typescript, it's typically: identifier > type_annotation
    let typeNode: import('web-tree-sitter').Node | null = null
    for (let i = 0; i < nameNode.childCount; i++) {
      const child = nameNode.child(i)
      if (child && child.type === 'type_annotation') {
        typeNode = child
        break
      }
    }

    if (!typeNode) {
      // Also check pattern: const x: string — the type annotation might be directly on declarator
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i)
        if (child && child.type === 'type_annotation') {
          typeNode = child
          break
        }
      }
    }

    if (!typeNode) return null

    // Get the type name
    const typeChild = typeNode.namedChildren[0]
    if (!typeChild) return null
    if (!PRIMITIVE_TYPES.has(typeChild.text)) return null

    // Check the initializer
    const value = node.childForFieldName('value')
    if (!value) return null

    const inferredType = getLiteralType(value)
    if (!inferredType) return null

    if (inferredType !== typeChild.text) return null

    const varName = nameNode.text.split(':')[0].trim()

    return makeViolation(
      this.ruleKey, typeNode, filePath, 'low',
      `Inferrable type annotation: ${typeChild.text}`,
      `Type annotation \`: ${typeChild.text}\` on \`${varName}\` is redundant — TypeScript can infer it from the initializer.`,
      sourceCode,
      `Remove the \`: ${typeChild.text}\` annotation.`,
    )
  },
}
