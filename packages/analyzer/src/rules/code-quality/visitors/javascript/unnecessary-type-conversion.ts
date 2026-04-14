import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { TS_LANGUAGES } from './_helpers.js'

/**
 * Detect: Type conversion that doesn't change the type (e.g., String(alreadyAString)).
 * Corresponds to @typescript-eslint/no-unnecessary-type-conversion.
 */
export const unnecessaryTypeConversionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unnecessary-type-conversion',
  languages: TS_LANGUAGES,
  nodeTypes: ['call_expression'],
  needsTypeQuery: true,
  visit(node, filePath, sourceCode, _dataFlow, typeQuery) {
    if (!typeQuery) return null

    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'identifier') return null

    const args = node.childForFieldName('arguments')
    if (!args || args.namedChildCount !== 1) return null
    const arg = args.namedChildren[0]

    const conversionMap: Record<string, string> = {
      String: 'string',
      Number: 'number',
      Boolean: 'boolean',
      BigInt: 'bigint',
    }

    const expectedType = conversionMap[fn.text]
    if (!expectedType) return null

    const argType = typeQuery.getTypeAtPosition(
      filePath,
      arg.startPosition.row,
      arg.startPosition.column,
    )
    if (!argType) return null

    if (argType === expectedType) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Unnecessary type conversion',
        `\`${fn.text}(${arg.text})\` is unnecessary — the argument is already a \`${argType}\`.`,
        sourceCode,
        `Remove the \`${fn.text}()\` wrapper.`,
      )
    }

    return null
  },
}
