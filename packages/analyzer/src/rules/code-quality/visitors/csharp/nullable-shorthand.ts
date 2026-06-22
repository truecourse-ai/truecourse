import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * `Nullable<T>` is the long form of the idiomatic `T?` shorthand. The two are
 * identical to the compiler; the shorthand is the conventional spelling. The
 * check targets a `generic_name` named exactly `Nullable` with a single type
 * argument, which is the open generic `System.Nullable<T>`.
 */
export const csharpNullableShorthandVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/nullable-shorthand',
  languages: ['csharp'],
  nodeTypes: ['generic_name'],
  visit(node, filePath, sourceCode) {
    const name = node.childForFieldName('name') ?? node.namedChildren[0]
    if (name?.text !== 'Nullable') return null

    const typeArgs = node.namedChildren.find((c) => c?.type === 'type_argument_list')
    if (!typeArgs || typeArgs.namedChildCount !== 1) return null

    const arg = typeArgs.namedChildren[0]?.text ?? 'T'
    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Use nullable shorthand',
      `\`Nullable<${arg}>\` is the long form of the idiomatic \`${arg}?\` shorthand.`,
      sourceCode,
      `Replace \`Nullable<${arg}>\` with \`${arg}?\`.`,
    )
  },
}
