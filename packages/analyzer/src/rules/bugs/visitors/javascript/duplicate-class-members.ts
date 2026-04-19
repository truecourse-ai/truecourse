import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const duplicateClassMembersVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/duplicate-class-members',
  languages: JS_LANGUAGES,
  nodeTypes: ['class_body'],
  visit(node, filePath, sourceCode) {
    const seen = new Map<string, SyntaxNode>()
    for (const child of node.namedChildren) {
      let name: string | null = null
      if (child.type === 'method_definition' || child.type === 'public_field_definition' || child.type === 'field_definition') {
        const nameNode = child.childForFieldName('name')
        if (nameNode) name = nameNode.text
      }
      if (name) {
        if (seen.has(name)) {
          return makeViolation(
            this.ruleKey, child, filePath, 'high',
            'Duplicate class member',
            `Member \`${name}\` is defined more than once — the later definition silently overwrites the earlier one.`,
            sourceCode,
            'Remove the duplicate member or rename one of them.',
          )
        }
        seen.set(name, child)
      }
    }
    return null
  },
}
