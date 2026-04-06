import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { TS_LANGUAGES } from './_helpers.js'

/**
 * Detect: Returning a non-void value from a void function, or using the return
 * value of a void function.
 * Corresponds to strict-void-return concept from @typescript-eslint.
 */
export const tsVoidReturnValueVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/void-return-value',
  languages: TS_LANGUAGES,
  nodeTypes: ['variable_declarator'],
  needsTypeQuery: true,
  visit(node, filePath, sourceCode, _dataFlow, typeQuery) {
    if (!typeQuery) return null

    const value = node.childForFieldName('value')
    if (!value || value.type !== 'call_expression') return null

    const fn = value.childForFieldName('function')
    if (!fn) return null

    const returnType = typeQuery.getReturnType(
      filePath,
      fn.startPosition.row,
      fn.startPosition.column,
    )
    if (!returnType) return null

    if (returnType === 'void') {
      const nameNode = node.childForFieldName('name')
      const varName = nameNode?.text ?? 'variable'
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Void return value assigned',
        `Assigning the return value of a void function to \`${varName}\` — void functions return \`undefined\`, so this variable is useless.`,
        sourceCode,
        'Call the function without assigning its return value, or fix the function to return a value.',
      )
    }

    return null
  },
}
