import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { TS_LANGUAGES } from './_helpers.js'

/**
 * Detect: Arguments to built-in functions that don't match documented types.
 * Corresponds to sonarjs S3782 (argument-type).
 * Checks first argument type against function parameter type for common built-ins.
 */
export const argumentTypeMismatchVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/argument-type-mismatch',
  languages: TS_LANGUAGES,
  nodeTypes: ['call_expression'],
  needsTypeQuery: true,
  visit(node, filePath, sourceCode, _dataFlow, typeQuery) {
    if (!typeQuery) return null

    const fn = node.childForFieldName('function')
    if (!fn) return null
    const args = node.childForFieldName('arguments')
    if (!args || args.namedChildCount === 0) return null

    // Get the function's parameter types
    const paramTypes = typeQuery.getParameterTypes(
      filePath,
      fn.startPosition.row,
      fn.startPosition.column,
    )
    if (!paramTypes || paramTypes.length === 0) return null

    // Check each argument against expected parameter type
    const argNodes = args.namedChildren
    for (let i = 0; i < Math.min(argNodes.length, paramTypes.length); i++) {
      const argNode = argNodes[i]
      const expectedParam = paramTypes[i]

      const argType = typeQuery.getTypeAtPosition(
        filePath,
        argNode.startPosition.row,
        argNode.startPosition.column,
      )
      if (!argType) continue

      // Check compatibility
      const compatible = typeQuery.areTypesCompatible(
        filePath,
        argNode.startPosition.row, argNode.startPosition.column,
        fn.startPosition.row, fn.startPosition.column,
      )

      // Only flag clear mismatches (e.g., passing string where number expected)
      if (!compatible && argType !== 'any' && expectedParam.type !== 'any') {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Argument type mismatch',
          `Argument ${i + 1} is \`${argType}\` but parameter \`${expectedParam.name}\` expects \`${expectedParam.type}\`.`,
          sourceCode,
          `Convert argument to \`${expectedParam.type}\` or pass the correct type.`,
        )
      }
    }

    return null
  },
}
