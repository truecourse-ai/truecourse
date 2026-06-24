import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * An enum's underlying storage type defaults to `int` (Int32). Declaring a
 * non-Int32 base — `long`, `byte`, `short`, `uint`, etc. — without a clear
 * interop reason can cause serialization and interop surprises and rarely buys
 * anything; Int32 is the convention. The check reads the `predefined_type` in
 * the enum's `base_list`.
 */

const INT32_BASES = new Set(['int'])

export const csharpEnumUnderlyingTypeNotInt32Visitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/enum-underlying-type-not-int32',
  languages: ['csharp'],
  nodeTypes: ['enum_declaration'],
  visit(node, filePath, sourceCode) {
    const baseList = node.namedChildren.find((c) => c?.type === 'base_list')
    if (!baseList) return null
    const baseType = baseList.namedChildren.find((c) => c?.type === 'predefined_type')
    if (!baseType || INT32_BASES.has(baseType.text)) return null

    const name = node.childForFieldName('name')?.text ?? 'enum'
    return makeViolation(
      this.ruleKey, baseType, filePath, 'low',
      'Enum underlying type is not Int32',
      `Enum \`${name}\` is declared with \`${baseType.text}\` storage; Int32 is the convention and avoids interop and serialization surprises.`,
      sourceCode,
      'Use the default `int` (Int32) underlying type unless interop requires otherwise.',
    )
  },
}
