import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpAttributeNames } from '../../../_shared/csharp-helpers.js'

/**
 * An enum marked `[Flags]` is a bit set whose values are combined, so its name
 * should be plural (`FileAccessRights`, not `FileAccessRight`) to convey that
 * an instance can hold several values at once. A singular name contradicts the
 * combining semantics the attribute implies (CA1714). The singular test fires
 * only when the name plainly does not end in a plural `s`, leaving genuine
 * plurals unflagged.
 */

function looksPlural(name: string): boolean {
  if (!/s$/.test(name)) return false
  if (/(ss|us|is|as|os|ius)$/.test(name)) return false
  return /[a-z]s$/.test(name)
}

export const csharpFlagsEnumSingularNameVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/flags-enum-singular-name',
  languages: ['csharp'],
  nodeTypes: ['enum_declaration'],
  visit(node, filePath, sourceCode) {
    if (!getCSharpAttributeNames(node).includes('Flags')) return null

    const nameNode = node.childForFieldName('name')
    const name = nameNode?.text
    if (!name || looksPlural(name)) return null

    return makeViolation(
      this.ruleKey, nameNode ?? node, filePath, 'low',
      'Flags enum has singular name',
      `Enum \`${name}\` is marked \`[Flags]\` but has a singular name, contradicting the multi-value semantics the attribute implies (CA1714).`,
      sourceCode,
      `Rename \`${name}\` to a plural form to reflect that values are combined.`,
    )
  },
}
