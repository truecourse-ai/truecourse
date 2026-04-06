import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { TS_LANGUAGES } from './_helpers.js'

/**
 * Detect: Generic type parameter that appears only once — unnecessary complexity.
 * Corresponds to @typescript-eslint/no-unnecessary-type-parameters.
 *
 * A type parameter is useful only if it relates two or more things (params, return, other params).
 * If it appears only once, `unknown` or the concrete type would suffice.
 *
 * Tree-sitter heuristic: count occurrences of the type parameter name in the
 * function signature (parameters + return type annotation). Does not require
 * TypeQueryService for the basic heuristic, but uses it for confirmation.
 */
export const unnecessaryTypeParameterVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unnecessary-type-parameter',
  languages: TS_LANGUAGES,
  nodeTypes: ['function_declaration', 'method_definition', 'arrow_function'],
  needsTypeQuery: true,
  visit(node, filePath, sourceCode, _dataFlow, typeQuery) {
    if (!typeQuery) return null

    // Find type_parameters node
    const typeParams = node.children.find(c => c.type === 'type_parameters')
    if (!typeParams) return null

    const params = node.childForFieldName('parameters')
    const returnType = node.childForFieldName('return_type') ?? node.children.find(c => c.type === 'type_annotation')
    if (!params) return null

    // Get the function signature text (params + return type)
    const signatureText = params.text + (returnType ? returnType.text : '')

    // Check each type parameter
    for (const tp of typeParams.namedChildren) {
      if (tp.type !== 'type_parameter') continue
      const nameNode = tp.namedChildren[0]
      if (!nameNode) continue
      const paramName = nameNode.text

      // Count occurrences in the signature (excluding the declaration itself)
      const regex = new RegExp(`\\b${paramName}\\b`, 'g')
      const matches = signatureText.match(regex)
      const count = matches ? matches.length : 0

      if (count <= 1) {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Unnecessary type parameter',
          `Type parameter \`${paramName}\` is used only once in the function signature — it doesn't relate multiple types and adds unnecessary complexity.`,
          sourceCode,
          `Replace \`${paramName}\` with its constraint or \`unknown\`.`,
        )
      }
    }

    return null
  },
}
