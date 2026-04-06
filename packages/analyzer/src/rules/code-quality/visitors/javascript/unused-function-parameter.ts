import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const unusedFunctionParameterVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unused-function-parameter',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['function_declaration', 'function_expression', 'arrow_function', 'method_definition'],
  visit(node, filePath, sourceCode) {
    const params = node.childForFieldName('parameters')
    if (!params || params.namedChildCount === 0) return null

    const body = node.childForFieldName('body')
    if (!body) return null
    const bodyText = body.text

    for (let i = 0; i < params.namedChildCount; i++) {
      const param = params.namedChild(i)
      if (!param) continue

      if (param.type === 'rest_parameter' || param.type === 'object_pattern'
        || param.type === 'array_pattern' || param.type === 'assignment_pattern') continue

      let paramName: string | null = null
      if (param.type === 'identifier') {
        paramName = param.text
      } else if (param.type === 'required_parameter' || param.type === 'optional_parameter') {
        const nameNode = param.childForFieldName('pattern') ?? param.namedChildren[0]
        if (nameNode?.type === 'identifier') paramName = nameNode.text
      }

      if (!paramName) continue
      if (paramName.startsWith('_')) continue

      const bodyContent = bodyText.slice(1, -1)
      const re = new RegExp(`\\b${paramName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)
      if (!re.test(bodyContent)) {
        return makeViolation(
          this.ruleKey, param, filePath, 'low',
          `Unused parameter \`${paramName}\``,
          `Parameter \`${paramName}\` is never used in the function body. Remove it or prefix with \`_\` if intentional.`,
          sourceCode,
          `Remove unused parameter \`${paramName}\` or rename to \`_${paramName}\`.`,
        )
      }
    }
    return null
  },
}
