import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Detect: def f(x: int = None) — parameter with None default but non-Optional type hint

function isNoneDefault(node: SyntaxNode | null): boolean {
  return node?.type === 'none' || node?.text === 'None'
}

function typeIncludesNone(typeNode: SyntaxNode): boolean {
  const text = typeNode.text
  return (
    text.includes('None') ||
    text.includes('Optional') ||
    text.startsWith('None ') ||
    text.endsWith(' None') ||
    text.includes('| None') ||
    text.includes('None |')
  )
}

export const pythonImplicitOptionalVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/implicit-optional',
  languages: ['python'],
  nodeTypes: ['typed_default_parameter'],
  visit(node, filePath, sourceCode) {
    // typed_default_parameter: name: type = default
    const typeNode = node.childForFieldName('type')
    const defaultNode = node.childForFieldName('value')

    if (!typeNode || !defaultNode) return null
    if (!isNoneDefault(defaultNode)) return null
    if (typeIncludesNone(typeNode)) return null

    const nameNode = node.childForFieldName('name')
    const paramName = nameNode?.text ?? 'param'

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Implicit Optional type',
      `Parameter \`${paramName}\` has a \`None\` default but type hint \`${typeNode.text}\` doesn't include \`None\`/\`Optional\` — this is implicitly \`Optional[${typeNode.text}]\`.`,
      sourceCode,
      `Change the type hint to \`Optional[${typeNode.text}]\` or \`${typeNode.text} | None\`.`,
    )
  },
}
