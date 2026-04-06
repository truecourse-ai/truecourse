import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const booleanParameterDefaultVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/boolean-parameter-default',
  languages: ['typescript', 'tsx'],
  nodeTypes: ['function_declaration', 'function_expression', 'arrow_function', 'method_definition'],
  visit(node, filePath, sourceCode) {
    const params = node.childForFieldName('parameters')
    if (!params) return null

    for (let i = 0; i < params.namedChildCount; i++) {
      const param = params.namedChild(i)
      if (!param) continue

      if (param.type === 'optional_parameter') {
        const typeAnnotation = param.namedChildren.find((c) => c.type === 'type_annotation')
        if (!typeAnnotation) continue
        const typeNode = typeAnnotation.namedChildren[0]
        if (typeNode?.text === 'boolean') {
          const hasDefault = param.namedChildren.some((c) => c.type === 'assignment_expression' || c.type === 'assignment_pattern')
          if (!hasDefault) {
            const nameNode = param.namedChildren[0]
            return makeViolation(
              this.ruleKey, param, filePath, 'low',
              'Optional boolean parameter without default',
              `Parameter \`${nameNode?.text ?? 'param'}\` is an optional boolean without a default value. Add \`= false\` or \`= true\` to avoid \`undefined\`.`,
              sourceCode,
              'Add a default value: `param: boolean = false`.',
            )
          }
        }
      }
    }
    return null
  },
}
