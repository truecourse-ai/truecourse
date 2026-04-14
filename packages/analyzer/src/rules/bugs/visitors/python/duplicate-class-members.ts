import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonDuplicateClassMembersVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/duplicate-class-members',
  languages: ['python'],
  nodeTypes: ['class_definition'],
  visit(node, filePath, sourceCode) {
    const body = node.childForFieldName('body')
    if (!body) return null

    const seen = new Set<string>()
    for (const child of body.namedChildren) {
      if (child.type === 'function_definition') {
        const nameNode = child.childForFieldName('name')
        if (nameNode) {
          const name = nameNode.text
          if (seen.has(name)) {
            return makeViolation(
              this.ruleKey, child, filePath, 'high',
              'Duplicate class member',
              `Method \`${name}\` is defined more than once — the later definition silently overwrites the earlier one.`,
              sourceCode,
              'Remove the duplicate method or rename one of them.',
            )
          }
          seen.add(name)
        }
      }
    }
    return null
  },
}
