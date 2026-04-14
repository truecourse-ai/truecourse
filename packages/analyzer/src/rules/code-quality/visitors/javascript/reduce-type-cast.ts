import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * @typescript-eslint/prefer-reduce-type-parameter
 * Detects `array.reduce((acc, val) => ..., [] as SomeType[])` type casts
 * that should use the type parameter: `array.reduce<SomeType[]>((acc, val) => ..., [])`
 */
export const reduceTypeCastVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/reduce-type-cast',
  languages: ['typescript', 'tsx'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'member_expression') return null

    const method = fn.childForFieldName('property')
    if (method?.text !== 'reduce') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    // Look for initial value that is a type assertion: [] as SomeType[]
    const argsList = args.namedChildren
    if (argsList.length < 2) return null

    const initialValue = argsList[argsList.length - 1]

    // Check for `[] as Type` (as_expression) or `<Type>[]` (type_assertion)
    if (
      initialValue.type === 'as_expression' ||
      initialValue.type === 'type_assertion'
    ) {
      const valueNode = initialValue.namedChildren[0]
      if (valueNode?.type === 'array') {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Reduce type cast',
          'Use a type parameter on `.reduce<T>()` instead of casting the initial accumulator value.',
          sourceCode,
          'Replace `.reduce((acc, val) => ..., [] as T[])` with `.reduce<T[]>((acc, val) => ..., [])`.',
        )
      }
    }

    return null
  },
}
