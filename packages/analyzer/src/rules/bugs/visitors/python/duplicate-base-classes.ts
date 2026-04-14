import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonDuplicateBaseClassesVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/duplicate-base-classes',
  languages: ['python'],
  nodeTypes: ['class_definition'],
  visit(node, filePath, sourceCode) {
    const args = node.childForFieldName('superclasses')
    if (!args) return null

    const seen = new Set<string>()
    for (const child of args.namedChildren) {
      if (child.type === 'identifier' || child.type === 'attribute') {
        const name = child.text
        if (seen.has(name)) {
          return makeViolation(
            this.ruleKey, child, filePath, 'high',
            'Duplicate base class',
            `Base class \`${name}\` is listed more than once — this causes a TypeError.`,
            sourceCode,
            `Remove the duplicate \`${name}\` from the base class list.`,
          )
        }
        seen.add(name)
      }
    }

    return null
  },
}
