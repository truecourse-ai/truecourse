import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const tsDeclarationStyleVisitor: CodeRuleVisitor = {
  ruleKey: 'style/deterministic/ts-declaration-style',
  languages: ['typescript', 'tsx'],
  nodeTypes: ['interface_declaration'],
  visit(node, filePath, sourceCode) {
    // Flag empty interfaces
    const body = node.childForFieldName('body')
    if (!body) return null

    const members = body.namedChildren.filter((c) => c.type !== 'comment')
    if (members.length === 0) {
      // Skip interfaces with an extends clause — `interface Foo extends Bar {}` is a valid
      // pattern for extending types without adding new members.
      const hasExtends = node.children.some(
        (c) => c.type === 'extends_type_clause' || c.type === 'extends_clause' || c.type === 'class_heritage'
      )
      if (hasExtends) return null

      const name = node.childForFieldName('name')
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Empty interface declaration',
        `Interface ${name?.text ?? ''} has no members. Use a type alias instead: type ${name?.text ?? ''} = Record<string, never>.`,
        sourceCode,
        'Replace the empty interface with a type alias or add members.',
      )
    }

    return null
  },
}
