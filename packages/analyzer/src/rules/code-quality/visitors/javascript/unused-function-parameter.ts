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

      // For block bodies ({...}), strip the braces. For expression bodies, use as-is.
      const bodyContent = body.type === 'statement_block' ? bodyText.slice(1, -1) : bodyText
      const re = new RegExp(`\\b${paramName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)
      if (!re.test(bodyContent)) {
        // If there are later parameters that ARE used, this param is a positional placeholder
        // (e.g., Next.js route handlers: (request, { params }) where request is required)
        let laterParamUsed = false
        for (let j = i + 1; j < params.namedChildCount; j++) {
          const laterParam = params.namedChild(j)
          if (!laterParam) continue
          // Destructured or rest params are always "used"
          if (laterParam.type === 'object_pattern' || laterParam.type === 'array_pattern' || laterParam.type === 'rest_parameter') {
            laterParamUsed = true
            break
          }
          let laterName: string | null = null
          if (laterParam.type === 'identifier') laterName = laterParam.text
          else if (laterParam.type === 'required_parameter' || laterParam.type === 'optional_parameter') {
            const nameNode = laterParam.childForFieldName('pattern') ?? laterParam.namedChildren[0]
            if (nameNode?.type === 'identifier') laterName = nameNode.text
          }
          if (laterName && !laterName.startsWith('_')) {
            const laterRe = new RegExp(`\\b${laterName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)
            if (laterRe.test(bodyContent)) {
              laterParamUsed = true
              break
            }
          }
        }
        if (laterParamUsed) continue

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
