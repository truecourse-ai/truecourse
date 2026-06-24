import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpAttributeNames } from '../../../_shared/csharp-helpers.js'

/**
 * An enum without `[Flags]` models a single choice from a set, so its name
 * should be singular (`OrderStatus`, not `OrderStatuses`). A plural name
 * falsely signals that members can be combined, which only `[Flags]` enums
 * support (CA1717). The plural test is intentionally conservative: it fires
 * only on the unambiguous English plural endings (`s` after a consonant, but
 * not `ss`/`us`/`is`/`as`/`os`) to avoid flagging singular words that happen
 * to end in `s` (`Status`, `Bus`).
 */

function looksPlural(name: string): boolean {
  if (!/s$/.test(name)) return false
  // Common singular endings that are not plurals.
  if (/(ss|us|is|as|os|ius)$/.test(name)) return false
  // Require a letter before the trailing `s` (so a bare `S` is not "plural").
  return /[a-z]s$/.test(name)
}

export const csharpNonFlagsEnumPluralNameVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/non-flags-enum-plural-name',
  languages: ['csharp'],
  nodeTypes: ['enum_declaration'],
  visit(node, filePath, sourceCode) {
    if (getCSharpAttributeNames(node).includes('Flags')) return null

    const nameNode = node.childForFieldName('name')
    const name = nameNode?.text
    if (!name || !looksPlural(name)) return null

    return makeViolation(
      this.ruleKey, nameNode ?? node, filePath, 'low',
      'Non-flags enum has plural name',
      `Enum \`${name}\` has no \`[Flags]\` attribute but a plural name, which falsely signals that multiple values can be combined (CA1717).`,
      sourceCode,
      `Rename \`${name}\` to a singular form, or add \`[Flags]\` if combining values is intended.`,
    )
  },
}
