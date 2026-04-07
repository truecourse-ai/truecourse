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

    // Use the TS compiler's own diagnostics to detect argument type mismatches.
    // This is the only reliable way — our own type comparison fails on generics,
    // overloads, and complex type inference that TypeScript handles correctly.
    const startLine = node.startPosition.row
    const endLine = node.endPosition.row
    const hasError = typeQuery.hasTypeErrorInRange(filePath, startLine, endLine)
    if (!hasError) return null

    // There's a real TS type error at this call site — get details for the message
    const fn = node.childForFieldName('function')
    const args = node.childForFieldName('arguments')
    if (!fn || !args || args.namedChildCount === 0) return null

    const paramTypes = typeQuery.getParameterTypes(
      filePath,
      fn.startPosition.row,
      fn.startPosition.column,
    )

    const argNodes = args.namedChildren
    // Find the first mismatched argument for the message
    for (let i = 0; i < argNodes.length; i++) {
      const argNode = argNodes[i]
      const argType = typeQuery.getTypeAtPosition(
        filePath,
        argNode.startPosition.row,
        argNode.startPosition.column,
        argNode.endPosition.row,
        argNode.endPosition.column,
      )
      if (!argType || argType === 'any') continue

      const expectedType = paramTypes?.[i]?.type
      const expectedName = paramTypes?.[i]?.name ?? `param ${i + 1}`
      if (expectedType && expectedType !== 'any') {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Argument type mismatch',
          `Argument ${i + 1} is \`${argType}\` but parameter \`${expectedName}\` expects \`${expectedType}\`.`,
          sourceCode,
          `Convert argument to \`${expectedType}\` or pass the correct type.`,
        )
      }
    }

    // Fallback: TS reports error but we can't pinpoint the argument
    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Argument type mismatch',
      'TypeScript reports a type error at this call expression.',
      sourceCode,
      'Check the argument types against the function signature.',
    )
  },
}
