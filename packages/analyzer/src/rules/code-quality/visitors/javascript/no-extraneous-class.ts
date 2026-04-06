import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const noExtraneousClassVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/no-extraneous-class',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['class_declaration'],
  visit(node, filePath, sourceCode) {
    const body = node.namedChildren.find((c) => c.type === 'class_body')
    if (!body) return null

    const members = body.namedChildren.filter((c) =>
      c.type === 'method_definition' || c.type === 'field_definition' || c.type === 'public_field_definition'
    )

    if (members.length === 0) return null

    const allStatic = members.every((m) => m.children.some((c) => c.type === 'static'))
    if (!allStatic) return null

    const hasConstructor = members.some((m) => {
      const nameNode = m.childForFieldName('name')
      return nameNode?.text === 'constructor'
    })
    if (hasConstructor) return null

    const nameNode = node.childForFieldName('name')
    const name = nameNode?.text ?? 'class'

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Class used as namespace',
      `Class \`${name}\` contains only static members — use a module, plain object, or namespace instead.`,
      sourceCode,
      'Convert to a plain object `const Name = { ... }` or use ES module exports.',
    )
  },
}
