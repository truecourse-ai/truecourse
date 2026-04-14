import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_FUNCTION_TYPES } from './_helpers.js'

export const defaultParameterPositionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/default-parameter-position',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: JS_FUNCTION_TYPES,
  visit(node, filePath, sourceCode) {
    const params = node.childForFieldName('parameters')
    if (!params) return null

    const paramList = params.namedChildren
    let foundDefault = false

    for (const param of paramList) {
      const hasDefault = param.type === 'assignment_pattern'
        || (param.type === 'required_parameter' && param.children.some((c) => c.type === '='))
        || (param.type === 'optional_parameter' && param.children.some((c) => c.type === '='))

      const isRest = param.type === 'rest_pattern' || param.type === 'rest_element'
        || (param.type === 'required_parameter' && param.children.some((c) => c.type === '...'))
        || param.text.startsWith('...')

      if (isRest) break

      if (hasDefault) {
        foundDefault = true
      } else if (foundDefault) {
        // Skip when the non-default param after a default is optional (valid TS pattern)
        const isOptional = param.type === 'optional_parameter' || param.text.includes('?')
        if (isOptional) continue
        const nameNode = param.childForFieldName('pattern') ?? param.childForFieldName('name') ?? param.namedChildren[0]
        const name = nameNode?.text ?? 'parameter'
        return makeViolation(
          this.ruleKey, param, filePath, 'low',
          'Default parameter not last',
          `Required parameter \`${name}\` appears after a default parameter. Default parameters should come last.`,
          sourceCode,
          'Move default parameters to the end of the parameter list.',
        )
      }
    }
    return null
  },
}
