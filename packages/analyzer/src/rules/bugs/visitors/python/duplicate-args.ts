import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonDuplicateArgsVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/duplicate-args',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    const params = node.childForFieldName('parameters')
    if (!params) return null

    const seen = new Set<string>()
    for (const child of params.namedChildren) {
      let paramName: string | null = null
      if (child.type === 'identifier') {
        paramName = child.text
      } else if (child.type === 'typed_parameter' || child.type === 'default_parameter' || child.type === 'typed_default_parameter') {
        const name = child.childForFieldName('name')
        if (name) paramName = name.text
      }

      if (paramName && paramName !== 'self' && paramName !== 'cls') {
        if (seen.has(paramName)) {
          return makeViolation(
            this.ruleKey, child, filePath, 'high',
            'Duplicate function argument',
            `Parameter \`${paramName}\` is duplicated — the later parameter shadows the earlier one.`,
            sourceCode,
            'Rename one of the duplicate parameters.',
          )
        }
        seen.add(paramName)
      }
    }
    return null
  },
}
