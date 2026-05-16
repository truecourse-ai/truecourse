import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { TS_LANGUAGES } from './_helpers.js'

/**
 * Detect: Type conversion that doesn't change the type (e.g., String(alreadyAString)).
 * Corresponds to @typescript-eslint/no-unnecessary-type-conversion.
 *
 * Restricted to simple identifier arguments. Compound expressions
 * (member access like `field.positionX`, binary operations like `a || b`,
 * `a ?? b`, ternaries, calls, etc.) are skipped: the tree-sitter position
 * resolves to the leftmost identifier under positional lookup, and the
 * type-checker's narrowed type for a compound expression often differs
 * from the developer-facing type (e.g. `team && row.team?.url === team.url`
 * narrows to `boolean` when `team` is an always-defined object type, hiding
 * the original union that justified the coercion). Identifier-only checks
 * match the high-confidence case from the negative fixture
 * (`String(x)` where `x: string`) without firing on these patterns.
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

    // Only flag identifier arguments. Compound expressions (member access,
    // binary operations, calls, etc.) frequently produce narrowed types that
    // differ from the developer-facing union — flagging them yields FPs.
    if (arg.type !== 'identifier') return null

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
      arg.endPosition.row,
      arg.endPosition.column,
    )
    if (!argType) return null

    // Additionally compare against the declared (non-narrowed) type of the
    // identifier's symbol. If the declared type is wider than the conversion
    // target (e.g. `string | number`, `Team | undefined`), the conversion is
    // defensive and necessary even when local control flow narrowed it.
    const declaredType = typeQuery.getDeclaredTypeAtPosition(
      filePath,
      arg.startPosition.row,
      arg.startPosition.column,
      arg.endPosition.row,
      arg.endPosition.column,
    )
    if (declaredType && declaredType !== expectedType) return null

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
